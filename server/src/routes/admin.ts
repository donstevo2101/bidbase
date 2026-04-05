import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { sendEmail } from '../lib/resend.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import type { Request, Response, NextFunction } from 'express';

export const adminRouter = Router();

// All admin routes require auth + super_admin role
adminRouter.use(authMiddleware, requireRole('super_admin'));

// ---- Helpers ----

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

const CLIENT_URL = process.env['CLIENT_URL'] ?? 'http://localhost:5173';

// ---- Schemas ----

const createOrgSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  plan: z.literal('enterprise'),
  ownerEmail: z.string().email(),
  ownerName: z.string().min(1).max(255),
  onboardingType: z.literal('manual'),
});

const updateOrgSchema = z.object({
  plan: z.enum(['starter', 'professional', 'enterprise']).optional(),
  suspended: z.boolean().optional(),
  suspended_reason: z.string().optional(),
  white_label_domain: z.string().nullable().optional(),
  branding: z.record(z.unknown()).optional(),
  settings: z.object({
    max_active_clients: z.number().int().positive().optional(),
    max_stage_c_clients: z.number().int().positive().optional(),
    max_team_members: z.number().int().positive().optional(),
    max_storage_gb: z.number().positive().optional(),
  }).passthrough().optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' });

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255).optional(),
  role: z.enum(['org_admin', 'org_member']).default('org_admin'),
});

// ---- Routes ----

/**
 * GET /organisations
 * List all organisations with pagination, filtering, and search.
 */
adminRouter.get(
  '/organisations',
  asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 20));
    const offset = (page - 1) * limit;
    const plan = req.query['plan'] as string | undefined;
    const status = req.query['status'] as string | undefined;
    const search = req.query['search'] as string | undefined;

    let query = supabase
      .from('organisations')
      .select('*, plan_usage(*)', { count: 'exact' });

    if (plan) {
      query = query.eq('plan', plan);
    }

    if (status === 'active') {
      query = query.eq('active', true).eq('suspended', false);
    } else if (status === 'suspended') {
      query = query.eq('suspended', true);
    }

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      });
      return;
    }

    res.json({
      success: true,
      data,
      pagination: { page, limit, total: count ?? 0 },
    });
  }),
);

/**
 * POST /organisations
 * Create organisation for enterprise manual onboarding.
 */
adminRouter.post(
  '/organisations',
  validate(createOrgSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, slug, plan, ownerEmail, ownerName, onboardingType } = req.body;

    // Create the organisation
    const { data: org, error: orgError } = await supabase
      .from('organisations')
      .insert({
        name,
        slug,
        plan,
        onboarding_type: onboardingType,
        onboarding_complete: false,
        active: false,
        settings: {},
        branding: {},
      })
      .select()
      .single();

    if (orgError) {
      res.status(422).json({
        success: false,
        error: { code: 'ORG_CREATE_FAILED', message: orgError.message },
      });
      return;
    }

    // Create user via admin API
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: ownerEmail,
      email_confirm: false,
      user_metadata: { full_name: ownerName },
    });

    if (authError) {
      // Clean up the org if user creation failed
      await supabase.from('organisations').delete().eq('id', org.id);
      res.status(422).json({
        success: false,
        error: { code: 'USER_CREATE_FAILED', message: authError.message },
      });
      return;
    }

    const userId = authData.user.id;

    // Update org with owner_id
    await supabase
      .from('organisations')
      .update({ owner_id: userId })
      .eq('id', org.id);

    // Create profile
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        organisation_id: org.id,
        role: 'org_admin',
        full_name: ownerName,
      });

    if (profileError) {
      console.error('[Admin] Failed to create profile:', profileError.message);
    }

    // Create plan_usage record
    await supabase.from('plan_usage').insert({ organisation_id: org.id });

    // Generate invite link
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'invite',
      email: ownerEmail,
    });

    const inviteUrl = linkData?.properties?.action_link
      ? `${CLIENT_URL}/auth/verify?token=${encodeURIComponent(linkData.properties.action_link)}`
      : `${CLIENT_URL}/auth/login`;

    // Send invite email
    await sendEmail({
      to: ownerEmail,
      subject: `You've been invited to BidBase`,
      html: `
        <h2>Welcome to BidBase, ${ownerName}!</h2>
        <p>An enterprise account has been created for <strong>${name}</strong>.</p>
        <p>Click the link below to set up your password and get started:</p>
        <p><a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Set Up Your Account</a></p>
        <p>If you have any questions, reply to this email.</p>
        <p>— The BidBase Team</p>
      `,
    });

    if (linkError) {
      console.error('[Admin] Failed to generate invite link:', linkError.message);
    }

    res.status(201).json({
      success: true,
      data: {
        organisation: org,
        userId,
        inviteSent: true,
      },
    });
  }),
);

/**
 * GET /organisations/:id
 * Full organisation detail with usage, subscription status, team count.
 */
adminRouter.get(
  '/organisations/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const [orgResult, usageResult, teamResult] = await Promise.all([
      supabase
        .from('organisations')
        .select('*')
        .eq('id', id)
        .single(),
      supabase
        .from('plan_usage')
        .select('*')
        .eq('organisation_id', id)
        .single(),
      supabase
        .from('profiles')
        .select('id, full_name, role, created_at')
        .eq('organisation_id', id),
    ]);

    if (orgResult.error) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organisation not found' },
      });
      return;
    }

    res.json({
      success: true,
      data: {
        ...orgResult.data,
        usage: usageResult.data,
        team: teamResult.data ?? [],
        team_count: teamResult.data?.length ?? 0,
      },
    });
  }),
);

/**
 * PATCH /organisations/:id
 * Update org: plan, suspend/unsuspend, capacity overrides, white-label, branding.
 */
adminRouter.patch(
  '/organisations/:id',
  validate(updateOrgSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { plan, suspended, suspended_reason, white_label_domain, branding, settings } = req.body;

    // Build update object — only include provided fields
    const update: Record<string, unknown> = {};
    if (plan !== undefined) update['plan'] = plan;
    if (suspended !== undefined) update['suspended'] = suspended;
    if (suspended_reason !== undefined) update['suspended_reason'] = suspended_reason;
    if (white_label_domain !== undefined) update['white_label_domain'] = white_label_domain;
    if (branding !== undefined) update['branding'] = branding;

    // For settings, merge with existing rather than replacing
    if (settings !== undefined) {
      const { data: existing } = await supabase
        .from('organisations')
        .select('settings')
        .eq('id', id)
        .single();

      const currentSettings = (existing?.settings as Record<string, unknown>) ?? {};
      update['settings'] = { ...currentSettings, ...settings };
    }

    const { data, error } = await supabase
      .from('organisations')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(404).json({
        success: false,
        error: { code: 'UPDATE_FAILED', message: error.message },
      });
      return;
    }

    res.json({ success: true, data });
  }),
);

/**
 * POST /organisations/:id/invite
 * Send invite link to an email. Creates user if needed.
 */
adminRouter.post(
  '/organisations/:id/invite',
  validate(inviteSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { email, name, role } = req.body;

    // Verify org exists
    const { data: org, error: orgError } = await supabase
      .from('organisations')
      .select('id, name')
      .eq('id', id)
      .single();

    if (orgError || !org) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organisation not found' },
      });
      return;
    }

    // Check if user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find((u) => u.email === email);

    let userId: string;

    if (existingUser) {
      userId = existingUser.id;

      // Ensure profile exists and is linked to this org
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .single();

      if (!existingProfile) {
        await supabase.from('profiles').insert({
          id: userId,
          organisation_id: id,
          role,
          full_name: name ?? null,
        });
      }
    } else {
      // Create new user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: false,
        user_metadata: { full_name: name ?? '' },
      });

      if (authError) {
        res.status(422).json({
          success: false,
          error: { code: 'USER_CREATE_FAILED', message: authError.message },
        });
        return;
      }

      userId = authData.user.id;

      await supabase.from('profiles').insert({
        id: userId,
        organisation_id: id,
        role,
        full_name: name ?? null,
      });
    }

    // Generate magic link for login
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });

    const loginUrl = linkData?.properties?.action_link
      ? `${CLIENT_URL}/auth/verify?token=${encodeURIComponent(linkData.properties.action_link)}`
      : `${CLIENT_URL}/auth/login`;

    await sendEmail({
      to: email,
      subject: `You've been invited to ${org.name} on BidBase`,
      html: `
        <h2>You've been invited to BidBase</h2>
        <p>You've been invited to join <strong>${org.name}</strong> on BidBase.</p>
        <p>Click the link below to log in:</p>
        <p><a href="${loginUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Log In to BidBase</a></p>
        <p>— The BidBase Team</p>
      `,
    });

    res.json({
      success: true,
      data: { userId, inviteSent: true },
    });
  }),
);

/**
 * POST /organisations/:id/activate
 * Activate org after manual onboarding.
 */
adminRouter.post(
  '/organisations/:id/activate',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('organisations')
      .update({
        active: true,
        onboarding_complete: true,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organisation not found' },
      });
      return;
    }

    res.json({ success: true, data });
  }),
);

/**
 * GET /metrics
 * Platform-wide metrics: total orgs, users, clients, applications, documents.
 */
adminRouter.get(
  '/metrics',
  asyncHandler(async (_req: Request, res: Response) => {
    const [orgsResult, usersResult, clientsResult, applicationsResult, documentsResult] =
      await Promise.all([
        supabase.from('organisations').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('clients').select('id', { count: 'exact', head: true }),
        supabase.from('applications').select('id', { count: 'exact', head: true }),
        supabase.from('documents').select('id', { count: 'exact', head: true }),
      ]);

    res.json({
      success: true,
      data: {
        total_organisations: orgsResult.count ?? 0,
        total_users: usersResult.count ?? 0,
        total_clients: clientsResult.count ?? 0,
        total_applications: applicationsResult.count ?? 0,
        total_documents: documentsResult.count ?? 0,
      },
    });
  }),
);

/**
 * GET /metrics/revenue
 * MRR calculation: count orgs by plan, multiply by price. Total active subscriptions.
 */
adminRouter.get(
  '/metrics/revenue',
  asyncHandler(async (_req: Request, res: Response) => {
    // Fetch plan pricing
    const { data: plans } = await supabase
      .from('plans')
      .select('name, monthly_price_gbp')
      .eq('active', true);

    const priceMap: Record<string, number> = {};
    for (const p of plans ?? []) {
      priceMap[p.name] = Number(p.monthly_price_gbp) || 0;
    }

    // Count active (non-suspended) orgs by plan
    const { data: orgs } = await supabase
      .from('organisations')
      .select('plan')
      .eq('active', true)
      .eq('suspended', false);

    const planCounts: Record<string, number> = {};
    let totalActiveSubscriptions = 0;

    for (const org of orgs ?? []) {
      const plan = org.plan ?? 'starter';
      planCounts[plan] = (planCounts[plan] ?? 0) + 1;
      totalActiveSubscriptions++;
    }

    let mrr = 0;
    const breakdown: Array<{ plan: string; count: number; price: number; revenue: number }> = [];

    for (const [plan, count] of Object.entries(planCounts)) {
      const price = priceMap[plan] ?? 0;
      const revenue = price * count;
      mrr += revenue;
      breakdown.push({ plan, count, price, revenue });
    }

    res.json({
      success: true,
      data: {
        mrr,
        arr: mrr * 12,
        total_active_subscriptions: totalActiveSubscriptions,
        breakdown,
      },
    });
  }),
);

/**
 * GET /metrics/usage
 * Agent calls this month, total storage used, active orgs count.
 */
adminRouter.get(
  '/metrics/usage',
  asyncHandler(async (_req: Request, res: Response) => {
    const { data: usageData } = await supabase
      .from('plan_usage')
      .select('agent_calls_month, storage_used_gb');

    let totalAgentCalls = 0;
    let totalStorageUsedGb = 0;

    for (const row of usageData ?? []) {
      totalAgentCalls += row.agent_calls_month ?? 0;
      totalStorageUsedGb += Number(row.storage_used_gb) || 0;
    }

    const { count: activeOrgs } = await supabase
      .from('organisations')
      .select('id', { count: 'exact', head: true })
      .eq('active', true)
      .eq('suspended', false);

    res.json({
      success: true,
      data: {
        agent_calls_this_month: totalAgentCalls,
        total_storage_used_gb: Math.round(totalStorageUsedGb * 100) / 100,
        active_organisations: activeOrgs ?? 0,
      },
    });
  }),
);

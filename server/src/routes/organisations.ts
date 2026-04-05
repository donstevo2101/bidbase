import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { orgScopeMiddleware } from '../middleware/orgScope.js';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const organisationsRouter = Router();

// ---- Helpers ----

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

// ---- Schemas ----

const createOrgSchema = z.object({
  name: z.string().min(1, 'Organisation name is required').max(255),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Slug must be lowercase alphanumeric with hyphens, cannot start or end with a hyphen'),
});

const updateOrgSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  branding: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
});

// ---- Routes ----

// POST /api/organisations — create new org during signup
organisationsRouter.post(
  '/',
  authMiddleware,
  validate(createOrgSchema),
  asyncHandler(async (req, res) => {
    const { name, slug } = req.body as z.infer<typeof createOrgSchema>;
    const userId = req.user.id;

    // Check slug uniqueness
    const { data: existingOrg } = await supabase
      .from('organisations')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (existingOrg) {
      res.status(409).json({
        success: false,
        error: { code: 'SLUG_TAKEN', message: 'This slug is already in use' },
      });
      return;
    }

    // Create organisation
    const { data: org, error: orgError } = await supabase
      .from('organisations')
      .insert({
        name,
        slug,
        owner_id: userId,
        active: true,
        onboarding_complete: true,
      })
      .select()
      .single();

    if (orgError || !org) {
      console.error('[Org Create]', orgError?.message, orgError?.details, orgError?.hint);
      res.status(500).json({
        success: false,
        error: { code: 'ORG_CREATE_FAILED', message: orgError?.message ?? 'Failed to create organisation' },
      });
      return;
    }

    // Create plan_usage record for the new org
    const { error: usageError } = await supabase
      .from('plan_usage')
      .insert({ organisation_id: org.id });

    if (usageError) {
      // Rollback org creation on failure
      await supabase.from('organisations').delete().eq('id', org.id);
      res.status(500).json({
        success: false,
        error: { code: 'ORG_CREATE_FAILED', message: 'Failed to initialise plan usage' },
      });
      return;
    }

    // Update user's profile with the new org and promote to org_admin
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ organisation_id: org.id, role: 'org_admin' })
      .eq('id', userId);

    if (profileError) {
      // Rollback
      await supabase.from('plan_usage').delete().eq('organisation_id', org.id);
      await supabase.from('organisations').delete().eq('id', org.id);
      res.status(500).json({
        success: false,
        error: { code: 'ORG_CREATE_FAILED', message: 'Failed to link profile to organisation' },
      });
      return;
    }

    res.status(201).json({
      success: true,
      data: org,
    });
  })
);

// GET /api/organisations/me — current org details
organisationsRouter.get(
  '/me',
  authMiddleware,
  orgScopeMiddleware,
  asyncHandler(async (req, res) => {
    const { data: org, error } = await supabase
      .from('organisations')
      .select('*')
      .eq('id', req.user.org_id)
      .single();

    if (error || !org) {
      res.status(404).json({
        success: false,
        error: { code: 'ORG_NOT_FOUND', message: 'Organisation not found' },
      });
      return;
    }

    res.json({ success: true, data: org });
  })
);

// PATCH /api/organisations/me — update org settings (org_admin only)
organisationsRouter.patch(
  '/me',
  authMiddleware,
  orgScopeMiddleware,
  requireRole('org_admin', 'super_admin'),
  validate(updateOrgSchema),
  asyncHandler(async (req, res) => {
    const updates = req.body as z.infer<typeof updateOrgSchema>;

    // Build update payload — only include provided fields
    const payload: Record<string, unknown> = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.branding !== undefined) payload.branding = updates.branding;
    if (updates.settings !== undefined) payload.settings = updates.settings;

    if (Object.keys(payload).length === 0) {
      res.status(422).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'No fields to update' },
      });
      return;
    }

    const { data: org, error } = await supabase
      .from('organisations')
      .update(payload)
      .eq('id', req.user.org_id)
      .select()
      .single();

    if (error || !org) {
      res.status(500).json({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update organisation' },
      });
      return;
    }

    res.json({ success: true, data: org });
  })
);

// GET /api/organisations/me/usage — plan usage stats
organisationsRouter.get(
  '/me/usage',
  authMiddleware,
  orgScopeMiddleware,
  asyncHandler(async (req, res) => {
    const { data: usage, error } = await supabase
      .from('plan_usage')
      .select('*')
      .eq('organisation_id', req.user.org_id)
      .single();

    if (error || !usage) {
      res.status(404).json({
        success: false,
        error: { code: 'USAGE_NOT_FOUND', message: 'Plan usage data not found' },
      });
      return;
    }

    // Also fetch the plan limits for context
    const { data: org } = await supabase
      .from('organisations')
      .select('plan')
      .eq('id', req.user.org_id)
      .single();

    let plan = null;
    if (org) {
      const { data: planData } = await supabase
        .from('plans')
        .select('*')
        .eq('name', org.plan)
        .single();
      plan = planData;
    }

    res.json({
      success: true,
      data: {
        usage,
        plan,
      },
    });
  })
);

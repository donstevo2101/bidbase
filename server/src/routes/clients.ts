import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { orgScopeMiddleware } from '../middleware/orgScope.js';
import { validate } from '../middleware/validate.js';
import { checkPlanLimit } from '../middleware/planLimits.js';
import type { Request, Response, NextFunction } from 'express';

export const clientsRouter = Router();

// ---- Helpers ----

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/** Verify a client belongs to the authenticated user's org. Returns the client row or null. */
async function getClientForOrg(clientId: string, orgId: string) {
  const { data } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .eq('organisation_id', orgId)
    .single();
  return data;
}

/** Parse pagination query params with sensible defaults and bounds. */
function parsePagination(query: Record<string, unknown>, defaultLimit = 25) {
  const page = Math.max(1, parseInt(query['page'] as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query['limit'] as string, 10) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// ---- Schemas ----

const clientTypeEnum = z.enum(['CIC', 'charity', 'social_enterprise', 'unincorporated', 'other']);
const clientStageEnum = z.enum(['A', 'B', 'C']);
const clientStatusEnum = z.enum(['lead', 'active', 'paused', 'offboarded']);

const createClientSchema = z.object({
  name: z.string().min(1, 'Client name is required').max(255),
  type: clientTypeEnum.optional(),
  stage: clientStageEnum.optional(),
  status: clientStatusEnum.optional(),
  primaryContactName: z.string().max(255).optional(),
  primaryContactEmail: z.string().email().optional().or(z.literal('')),
  primaryContactPhone: z.string().max(50).optional(),
  annualIncome: z.number().nonnegative().optional(),
  registeredNumber: z.string().max(50).optional(),
  address: z.record(z.unknown()).optional(),
  policiesHeld: z.array(z.string()).optional(),
  existingGrants: z
    .array(
      z.object({
        funder: z.string(),
        amount: z.number(),
        open_until: z.string(),
      })
    )
    .optional(),
  notes: z.string().optional(),
  assignedTo: z.string().uuid().optional(),
  portalEnabled: z.boolean().optional(),
});

const updateClientSchema = createClientSchema.partial();

// ---- Middleware applied to all routes ----

clientsRouter.use(authMiddleware, orgScopeMiddleware);

// ---- Routes ----

// GET / — list clients (paginated, filterable, searchable)
clientsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const { stage, status, search } = req.query;

    let query = supabase
      .from('clients')
      .select('*', { count: 'exact' })
      .eq('organisation_id', req.user.org_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (stage && stage !== 'all') query = query.eq('stage', stage as string);
    if (status && status !== 'all') query = query.eq('status', status as string);
    if (search) {
      query = query.or(
        `name.ilike.%${search}%,primary_contact_name.ilike.%${search}%,primary_contact_email.ilike.%${search}%`
      );
    }

    const { data, error, count } = await query;

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'QUERY_FAILED', message: 'Failed to fetch clients' },
      });
      return;
    }

    res.json({
      success: true,
      data: data ?? [],
      pagination: { page, limit, total: count ?? 0 },
    });
  })
);

// POST / — create client
clientsRouter.post(
  '/',
  requireRole('org_admin', 'org_member', 'super_admin'),
  checkPlanLimit('active_clients'),
  validate(createClientSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createClientSchema>;

    const { data, error } = await supabase
      .from('clients')
      .insert({
        organisation_id: req.user.org_id,
        name: body.name,
        type: body.type ?? null,
        stage: body.stage ?? 'A',
        status: body.status ?? 'lead',
        primary_contact_name: body.primaryContactName ?? null,
        primary_contact_email: body.primaryContactEmail || null,
        primary_contact_phone: body.primaryContactPhone ?? null,
        annual_income: body.annualIncome ?? null,
        registered_number: body.registeredNumber ?? null,
        address: body.address ?? null,
        policies_held: body.policiesHeld ?? null,
        existing_grants: body.existingGrants ?? [],
        notes: body.notes ?? null,
        assigned_to: body.assignedTo ?? null,
        portal_enabled: body.portalEnabled ?? false,
      })
      .select()
      .single();

    if (error || !data) {
      res.status(500).json({
        success: false,
        error: { code: 'CREATE_FAILED', message: 'Failed to create client' },
      });
      return;
    }

    // Plan usage counter — non-critical, skip if fails
    try {
      const { data: usage } = await supabase.from('plan_usage').select('active_clients').eq('organisation_id', req.user.org_id).single();
      if (usage) {
        await supabase.from('plan_usage').update({ active_clients: (usage.active_clients ?? 0) + 1 }).eq('organisation_id', req.user.org_id);
      }
    } catch { /* non-critical */ }

    // Log activity
    await supabase.from('activity_log').insert({
      organisation_id: req.user.org_id,
      client_id: data.id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'client_created',
      details: { name: body.name, stage: body.stage ?? 'A' },
    });

    res.status(201).json({ success: true, data });
  })
);

// GET /:id — client detail
clientsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const client = await getClientForOrg(req.params['id'], req.user.org_id);

    if (!client) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Client not found' },
      });
      return;
    }

    res.json({ success: true, data: client });
  })
);

// PATCH /:id — update client (including stage changes)
clientsRouter.patch(
  '/:id',
  requireRole('org_admin', 'org_member', 'super_admin'),
  validate(updateClientSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.user.org_id;
    const clientId = req.params['id'];
    const body = req.body as z.infer<typeof updateClientSchema>;

    // Fetch existing client to check current stage
    const existing = await getClientForOrg(clientId, orgId);
    if (!existing) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Client not found' },
      });
      return;
    }

    // If stage is changing to C, enforce plan limit (Constraint 7)
    if (body.stage === 'C' && existing.stage !== 'C') {
      const { data: usage } = await supabase
        .from('plan_usage')
        .select('stage_c_clients')
        .eq('organisation_id', orgId)
        .single();

      const { data: org } = await supabase
        .from('organisations')
        .select('plan')
        .eq('id', orgId)
        .single();

      if (org) {
        const { data: plan } = await supabase
          .from('plans')
          .select('max_stage_c_clients')
          .eq('name', org.plan)
          .single();

        if (
          plan &&
          usage &&
          plan.max_stage_c_clients !== null &&
          usage.stage_c_clients >= plan.max_stage_c_clients
        ) {
          res.status(429).json({
            success: false,
            error: {
              code: 'PLAN_LIMIT_REACHED',
              message: `You have reached the Stage C client limit for your ${org.plan} plan. Please upgrade to continue.`,
            },
          });
          return;
        }
      }
    }

    // Build snake_case update payload from camelCase input
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.name !== undefined) updateData['name'] = body.name;
    if (body.type !== undefined) updateData['type'] = body.type;
    if (body.stage !== undefined) updateData['stage'] = body.stage;
    if (body.status !== undefined) updateData['status'] = body.status;
    if (body.primaryContactName !== undefined) updateData['primary_contact_name'] = body.primaryContactName;
    if (body.primaryContactEmail !== undefined) updateData['primary_contact_email'] = body.primaryContactEmail || null;
    if (body.primaryContactPhone !== undefined) updateData['primary_contact_phone'] = body.primaryContactPhone;
    if (body.annualIncome !== undefined) updateData['annual_income'] = body.annualIncome;
    if (body.registeredNumber !== undefined) updateData['registered_number'] = body.registeredNumber;
    if (body.address !== undefined) updateData['address'] = body.address;
    if (body.policiesHeld !== undefined) updateData['policies_held'] = body.policiesHeld;
    if (body.existingGrants !== undefined) updateData['existing_grants'] = body.existingGrants;
    if (body.notes !== undefined) updateData['notes'] = body.notes;
    if (body.assignedTo !== undefined) updateData['assigned_to'] = body.assignedTo;
    if (body.portalEnabled !== undefined) updateData['portal_enabled'] = body.portalEnabled;

    const { data, error } = await supabase
      .from('clients')
      .update(updateData)
      .eq('id', clientId)
      .eq('organisation_id', orgId)
      .select()
      .single();

    if (error || !data) {
      res.status(500).json({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update client' },
      });
      return;
    }

    // Update stage C usage counter if stage changed
    if (body.stage === 'C' && existing.stage !== 'C') {
      await supabase
        .rpc('increment_usage', { org: orgId, field: 'stage_c_clients' })
        .catch(() => {});
    } else if (body.stage !== undefined && body.stage !== 'C' && existing.stage === 'C') {
      await supabase
        .rpc('decrement_usage', { org: orgId, field: 'stage_c_clients' })
        .catch(() => {});
    }

    // Log activity
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      client_id: data.id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'client_updated',
      details: updateData,
    });

    res.json({ success: true, data });
  })
);

// DELETE /:id — soft delete (set status to 'offboarded'). org_admin only.
clientsRouter.delete(
  '/:id',
  requireRole('org_admin', 'super_admin'),
  asyncHandler(async (req, res) => {
    const orgId = req.user.org_id;
    const clientId = req.params['id'];

    // Fetch existing to check current status/stage for counter adjustments
    const existing = await getClientForOrg(clientId, orgId);
    if (!existing) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Client not found' },
      });
      return;
    }

    if (existing.status === 'offboarded') {
      res.status(409).json({
        success: false,
        error: { code: 'ALREADY_OFFBOARDED', message: 'Client is already offboarded' },
      });
      return;
    }

    const { data, error } = await supabase
      .from('clients')
      .update({ status: 'offboarded', updated_at: new Date().toISOString() })
      .eq('id', clientId)
      .eq('organisation_id', orgId)
      .select()
      .single();

    if (error || !data) {
      res.status(500).json({
        success: false,
        error: { code: 'DELETE_FAILED', message: 'Failed to offboard client' },
      });
      return;
    }

    // Decrement active_clients counter
    if (existing.status !== 'offboarded' && existing.status !== 'paused') {
      await supabase
        .rpc('decrement_usage', { org: orgId, field: 'active_clients' })
        .catch(() => {});
    }

    // Decrement stage C counter if applicable
    if (existing.stage === 'C') {
      await supabase
        .rpc('decrement_usage', { org: orgId, field: 'stage_c_clients' })
        .catch(() => {});
    }

    // Log activity
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      client_id: data.id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'client_offboarded',
    });

    res.json({ success: true, data });
  })
);

// GET /:id/timeline — activity log entries for this client
clientsRouter.get(
  '/:id/timeline',
  asyncHandler(async (req, res) => {
    const orgId = req.user.org_id;
    const clientId = req.params['id'];

    // Verify client belongs to org
    const existing = await getClientForOrg(clientId, orgId);
    if (!existing) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Client not found' },
      });
      return;
    }

    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>, 50);

    const { data, count, error } = await supabase
      .from('activity_log')
      .select('*', { count: 'exact' })
      .eq('client_id', clientId)
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'QUERY_FAILED', message: 'Failed to fetch timeline' },
      });
      return;
    }

    res.json({
      success: true,
      data: data ?? [],
      pagination: { page, limit, total: count ?? 0 },
    });
  })
);

// GET /:id/documents — documents for this client
clientsRouter.get(
  '/:id/documents',
  asyncHandler(async (req, res) => {
    const orgId = req.user.org_id;
    const clientId = req.params['id'];

    const existing = await getClientForOrg(clientId, orgId);
    if (!existing) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Client not found' },
      });
      return;
    }

    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);

    const { data, count, error } = await supabase
      .from('documents')
      .select('*', { count: 'exact' })
      .eq('client_id', clientId)
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'QUERY_FAILED', message: 'Failed to fetch documents' },
      });
      return;
    }

    res.json({
      success: true,
      data: data ?? [],
      pagination: { page, limit, total: count ?? 0 },
    });
  })
);

// GET /:id/applications — applications for this client
clientsRouter.get(
  '/:id/applications',
  asyncHandler(async (req, res) => {
    const orgId = req.user.org_id;
    const clientId = req.params['id'];

    const existing = await getClientForOrg(clientId, orgId);
    if (!existing) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Client not found' },
      });
      return;
    }

    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);

    const { data, count, error } = await supabase
      .from('applications')
      .select('*', { count: 'exact' })
      .eq('client_id', clientId)
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'QUERY_FAILED', message: 'Failed to fetch applications' },
      });
      return;
    }

    res.json({
      success: true,
      data: data ?? [],
      pagination: { page, limit, total: count ?? 0 },
    });
  })
);

// GET /:id/invoices — invoices for this client
clientsRouter.get(
  '/:id/invoices',
  asyncHandler(async (req, res) => {
    const orgId = req.user.org_id;
    const clientId = req.params['id'];

    const existing = await getClientForOrg(clientId, orgId);
    if (!existing) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Client not found' },
      });
      return;
    }

    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);

    const { data, count, error } = await supabase
      .from('invoices')
      .select('*', { count: 'exact' })
      .eq('client_id', clientId)
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'QUERY_FAILED', message: 'Failed to fetch invoices' },
      });
      return;
    }

    res.json({
      success: true,
      data: data ?? [],
      pagination: { page, limit, total: count ?? 0 },
    });
  })
);

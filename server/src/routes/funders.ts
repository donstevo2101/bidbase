import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import type { Request, Response, NextFunction } from 'express';

export const fundersRouter = Router();

// All funder routes require authentication
fundersRouter.use(authMiddleware);

// ---- Helpers ----

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

function parsePagination(query: Record<string, unknown>, defaultLimit = 25) {
  const page = Math.max(1, parseInt(query['page'] as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query['limit'] as string, 10) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// ---- Schemas ----

const createFunderSchema = z.object({
  name: z.string().min(1, 'Funder name is required').max(255),
  website: z.string().url().optional().nullable(),
  grantRangeMin: z.number().nonnegative().optional().nullable(),
  grantRangeMax: z.number().nonnegative().optional().nullable(),
  eligibleStructures: z.array(z.string()).optional().nullable(),
  eligibleGeographies: z.array(z.string()).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  requiresPreregistration: z.boolean().optional(),
  preregistrationLeadWeeks: z.number().int().nonnegative().optional().nullable(),
  rejectionGapMonths: z.number().int().nonnegative().optional().nullable(),
});

const updateFunderSchema = createFunderSchema.partial();

// ---- Routes ----

/**
 * GET / — List funders (org-specific + platform-wide).
 * Paginated. Filterable by ?search=name.
 */
fundersRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
    const search = (req.query['search'] as string) || '';

    // Count query — org funders + platform-wide (organisation_id IS NULL)
    let countQuery = supabase
      .from('funders')
      .select('id', { count: 'exact', head: true })
      .or(`organisation_id.eq.${orgId},organisation_id.is.null`);

    if (search) {
      countQuery = countQuery.ilike('name', `%${search}%`);
    }

    // Data query
    let dataQuery = supabase
      .from('funders')
      .select('*')
      .or(`organisation_id.eq.${orgId},organisation_id.is.null`)
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (search) {
      dataQuery = dataQuery.ilike('name', `%${search}%`);
    }

    const [countResult, dataResult] = await Promise.all([countQuery, dataQuery]);

    if (dataResult.error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch funders' },
      });
      return;
    }

    res.json({
      success: true,
      data: dataResult.data ?? [],
      pagination: {
        page,
        limit,
        total: countResult.count ?? 0,
      },
    });
  })
);

/**
 * GET /search — Search funders filtered by eligibility criteria.
 * Query params: structure, geography, minGrant, maxGrant.
 */
fundersRouter.get(
  '/search',
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;
    const structure = req.query['structure'] as string | undefined;
    const geography = req.query['geography'] as string | undefined;
    const minGrant = req.query['minGrant'] ? parseFloat(req.query['minGrant'] as string) : undefined;
    const maxGrant = req.query['maxGrant'] ? parseFloat(req.query['maxGrant'] as string) : undefined;

    let query = supabase
      .from('funders')
      .select('*')
      .or(`organisation_id.eq.${orgId},organisation_id.is.null`)
      .order('name', { ascending: true });

    if (structure) {
      query = query.contains('eligible_structures', [structure]);
    }

    if (geography) {
      query = query.contains('eligible_geographies', [geography]);
    }

    if (minGrant !== undefined && !isNaN(minGrant)) {
      query = query.gte('grant_range_max', minGrant);
    }

    if (maxGrant !== undefined && !isNaN(maxGrant)) {
      query = query.lte('grant_range_min', maxGrant);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to search funders' },
      });
      return;
    }

    res.json({
      success: true,
      data: data ?? [],
    });
  })
);

/**
 * POST / — Create a new funder scoped to the authenticated user's organisation.
 * Requires org_admin or org_member role.
 */
fundersRouter.post(
  '/',
  requireRole('org_admin', 'org_member'),
  validate(createFunderSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;
    const body = req.body as z.infer<typeof createFunderSchema>;

    const { data, error } = await supabase
      .from('funders')
      .insert({
        organisation_id: orgId,
        name: body.name,
        website: body.website ?? null,
        grant_range_min: body.grantRangeMin ?? null,
        grant_range_max: body.grantRangeMax ?? null,
        eligible_structures: body.eligibleStructures ?? [],
        eligible_geographies: body.eligibleGeographies ?? [],
        notes: body.notes ?? null,
        requires_preregistration: body.requiresPreregistration ?? false,
        preregistration_lead_weeks: body.preregistrationLeadWeeks ?? null,
        rejection_gap_months: body.rejectionGapMonths ?? null,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to create funder' },
      });
      return;
    }

    res.status(201).json({ success: true, data });
  })
);

/**
 * PATCH /:id — Update an org-owned funder. Cannot update platform-wide funders.
 */
fundersRouter.patch(
  '/:id',
  requireRole('org_admin', 'org_member'),
  validate(updateFunderSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;
    const funderId = req.params['id'];
    const body = req.body as z.infer<typeof updateFunderSchema>;

    // Verify funder belongs to this org (not platform-wide)
    const { data: existing } = await supabase
      .from('funders')
      .select('id, organisation_id')
      .eq('id', funderId)
      .eq('organisation_id', orgId)
      .single();

    if (!existing) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Funder not found or is a platform-wide funder' },
      });
      return;
    }

    // Build update payload — only include fields that were provided
    const updatePayload: Record<string, unknown> = {
      last_updated: new Date().toISOString(),
    };

    if (body.name !== undefined) updatePayload['name'] = body.name;
    if (body.website !== undefined) updatePayload['website'] = body.website;
    if (body.grantRangeMin !== undefined) updatePayload['grant_range_min'] = body.grantRangeMin;
    if (body.grantRangeMax !== undefined) updatePayload['grant_range_max'] = body.grantRangeMax;
    if (body.eligibleStructures !== undefined) updatePayload['eligible_structures'] = body.eligibleStructures;
    if (body.eligibleGeographies !== undefined) updatePayload['eligible_geographies'] = body.eligibleGeographies;
    if (body.notes !== undefined) updatePayload['notes'] = body.notes;
    if (body.requiresPreregistration !== undefined) updatePayload['requires_preregistration'] = body.requiresPreregistration;
    if (body.preregistrationLeadWeeks !== undefined) updatePayload['preregistration_lead_weeks'] = body.preregistrationLeadWeeks;
    if (body.rejectionGapMonths !== undefined) updatePayload['rejection_gap_months'] = body.rejectionGapMonths;

    const { data, error } = await supabase
      .from('funders')
      .update(updatePayload)
      .eq('id', funderId)
      .eq('organisation_id', orgId)
      .select()
      .single();

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to update funder' },
      });
      return;
    }

    res.json({ success: true, data });
  })
);

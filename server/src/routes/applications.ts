import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const applicationsRouter = Router();

// All routes require authentication
applicationsRouter.use(authMiddleware);

// ---- Schemas ----

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(20),
  client_id: z.string().uuid().optional(),
  status: z.string().optional(),
});

const createSchema = z.object({
  clientId: z.string().uuid(),
  funderName: z.string().min(1).max(500),
  funderId: z.string().uuid().optional(),
  projectName: z.string().max(500).optional(),
  projectDescription: z.string().max(5000).optional(),
  amountRequested: z.number().positive().optional(),
  deadline: z.string().datetime().optional(),
});

const updateSchema = z.object({
  funderName: z.string().min(1).max(500).optional(),
  funderId: z.string().uuid().nullable().optional(),
  projectName: z.string().max(500).nullable().optional(),
  projectDescription: z.string().max(5000).nullable().optional(),
  amountRequested: z.number().positive().nullable().optional(),
  deadline: z.string().datetime().nullable().optional(),
});

// ---- Helpers ----

function asyncHandler(fn: (req: Express.Request & import('express').Request, res: import('express').Response) => Promise<void>) {
  return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    fn(req, res).catch(next);
  };
}

/** Fetch an application scoped to org, returning null if not found */
async function getOrgApplication(id: string, orgId: string) {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('id', id)
    .eq('organisation_id', orgId)
    .single();

  if (error || !data) return null;
  return data;
}

// ---- Routes ----

// GET / — list applications, paginated, filterable by client_id and status
applicationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(422).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters' },
      });
      return;
    }

    const { page, limit, client_id, status } = parsed.data;
    const offset = (page - 1) * limit;
    const orgId = req.user.org_id;

    let query = supabase
      .from('applications')
      .select('*', { count: 'exact' })
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (client_id) {
      query = query.eq('client_id', client_id);
    }
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'QUERY_FAILED', message: 'Failed to fetch applications' },
      });
      return;
    }

    res.json({
      success: true,
      data,
      pagination: { page, limit, total: count ?? 0 },
    });
  })
);

// POST / — create application
applicationsRouter.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { clientId, funderName, funderId, projectName, projectDescription, amountRequested, deadline } = req.body;
    const orgId = req.user.org_id;

    // Verify the client belongs to this org
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .eq('organisation_id', orgId)
      .single();

    if (clientError || !client) {
      res.status(404).json({
        success: false,
        error: { code: 'CLIENT_NOT_FOUND', message: 'Client not found' },
      });
      return;
    }

    // If funderId provided, verify it belongs to this org or is platform-wide
    if (funderId) {
      const { data: funder, error: funderError } = await supabase
        .from('funders')
        .select('id')
        .eq('id', funderId)
        .or(`organisation_id.eq.${orgId},organisation_id.is.null`)
        .single();

      if (funderError || !funder) {
        res.status(404).json({
          success: false,
          error: { code: 'FUNDER_NOT_FOUND', message: 'Funder not found' },
        });
        return;
      }
    }

    const { data: application, error: insertError } = await supabase
      .from('applications')
      .insert({
        organisation_id: orgId,
        client_id: clientId,
        funder_name: funderName,
        funder_id: funderId ?? null,
        project_name: projectName ?? null,
        project_description: projectDescription ?? null,
        amount_requested: amountRequested ?? null,
        deadline: deadline ?? null,
        status: 'researching',
      })
      .select()
      .single();

    if (insertError) {
      res.status(500).json({
        success: false,
        error: { code: 'INSERT_FAILED', message: 'Failed to create application' },
      });
      return;
    }

    // Log creation
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      client_id: clientId,
      application_id: application.id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'application_created',
      details: { funderName, projectName },
      ip_address: req.ip,
    });

    res.status(201).json({ success: true, data: application });
  })
);

// GET /:id — application detail
applicationsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const application = await getOrgApplication(req.params.id, req.user.org_id);

    if (!application) {
      res.status(404).json({
        success: false,
        error: { code: 'APPLICATION_NOT_FOUND', message: 'Application not found' },
      });
      return;
    }

    res.json({ success: true, data: application });
  })
);

// PATCH /:id — update application fields (not gate or approval fields)
applicationsRouter.patch(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const orgId = req.user.org_id;

    const application = await getOrgApplication(id, orgId);
    if (!application) {
      res.status(404).json({
        success: false,
        error: { code: 'APPLICATION_NOT_FOUND', message: 'Application not found' },
      });
      return;
    }

    // Map camelCase body to snake_case DB columns
    const updates: Record<string, unknown> = {};
    if (req.body.funderName !== undefined) updates.funder_name = req.body.funderName;
    if (req.body.funderId !== undefined) updates.funder_id = req.body.funderId;
    if (req.body.projectName !== undefined) updates.project_name = req.body.projectName;
    if (req.body.projectDescription !== undefined) updates.project_description = req.body.projectDescription;
    if (req.body.amountRequested !== undefined) updates.amount_requested = req.body.amountRequested;
    if (req.body.deadline !== undefined) updates.deadline = req.body.deadline;
    updates.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from('applications')
      .update(updates)
      .eq('id', id)
      .eq('organisation_id', orgId)
      .select()
      .single();

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update application' },
      });
      return;
    }

    // Log update
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      client_id: application.client_id,
      application_id: id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'application_updated',
      details: { fields: Object.keys(updates).filter((k) => k !== 'updated_at') },
      ip_address: req.ip,
    });

    res.json({ success: true, data: updated });
  })
);

// POST /:id/gate1 — trigger gate 1 check (placeholder — actual agent logic in Phase 2b)
applicationsRouter.post(
  '/:id/gate1',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const orgId = req.user.org_id;

    const application = await getOrgApplication(id, orgId);
    if (!application) {
      res.status(404).json({
        success: false,
        error: { code: 'APPLICATION_NOT_FOUND', message: 'Application not found' },
      });
      return;
    }

    // Set status to gate1_pending
    const { data: updated, error } = await supabase
      .from('applications')
      .update({
        status: 'gate1_pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('organisation_id', orgId)
      .select()
      .single();

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to trigger gate 1 check' },
      });
      return;
    }

    // Log gate 1 trigger
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      client_id: application.client_id,
      application_id: id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'gate1_triggered',
      ip_address: req.ip,
    });

    // TODO: Phase 2b — dispatch to eligibility agent via agent task queue

    res.json({ success: true, data: updated });
  })
);

// POST /:id/gate2 — trigger gate 2 check. Requires gate1_passed.
applicationsRouter.post(
  '/:id/gate2',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const orgId = req.user.org_id;

    const application = await getOrgApplication(id, orgId);
    if (!application) {
      res.status(404).json({
        success: false,
        error: { code: 'APPLICATION_NOT_FOUND', message: 'Application not found' },
      });
      return;
    }

    // Enforce: gate 1 must have passed
    if (!application.gate1_passed) {
      res.status(422).json({
        success: false,
        error: { code: 'GATE1_NOT_PASSED', message: 'Gate 1 must be passed before triggering gate 2' },
      });
      return;
    }

    // Set status to gate2_pending
    const { data: updated, error } = await supabase
      .from('applications')
      .update({
        status: 'gate2_pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('organisation_id', orgId)
      .select()
      .single();

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to trigger gate 2 check' },
      });
      return;
    }

    // Log gate 2 trigger
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      client_id: application.client_id,
      application_id: id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'gate2_triggered',
      ip_address: req.ip,
    });

    // TODO: Phase 2b — dispatch to eligibility agent via agent task queue

    res.json({ success: true, data: updated });
  })
);

// POST /:id/approve — operator approval. org_admin only.
applicationsRouter.post(
  '/:id/approve',
  requireRole('org_admin', 'super_admin'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const orgId = req.user.org_id;

    const application = await getOrgApplication(id, orgId);
    if (!application) {
      res.status(404).json({
        success: false,
        error: { code: 'APPLICATION_NOT_FOUND', message: 'Application not found' },
      });
      return;
    }

    const now = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from('applications')
      .update({
        operator_approval: true,
        operator_approved_by: req.user.id,
        operator_approved_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('organisation_id', orgId)
      .select()
      .single();

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to approve application' },
      });
      return;
    }

    // Log approval
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      client_id: application.client_id,
      application_id: id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'application_approved',
      ip_address: req.ip,
    });

    res.json({ success: true, data: updated });
  })
);

// POST /:id/submit — mark as submitted. Enforces gate3_passed AND operator_approval.
applicationsRouter.post(
  '/:id/submit',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const orgId = req.user.org_id;

    const application = await getOrgApplication(id, orgId);
    if (!application) {
      res.status(404).json({
        success: false,
        error: { code: 'APPLICATION_NOT_FOUND', message: 'Application not found' },
      });
      return;
    }

    // HARD CONSTRAINT: gate3_passed AND operator_approval must both be true
    if (!application.gate3_passed) {
      res.status(422).json({
        success: false,
        error: { code: 'GATE3_NOT_PASSED', message: 'Gate 3 quality review must be completed before submission' },
      });
      return;
    }

    if (!application.operator_approval) {
      res.status(422).json({
        success: false,
        error: { code: 'APPROVAL_REQUIRED', message: 'Operator explicit approval is required before submission. This cannot be bypassed.' },
      });
      return;
    }

    const now = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from('applications')
      .update({
        status: 'submitted',
        submitted_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('organisation_id', orgId)
      .select()
      .single();

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to submit application' },
      });
      return;
    }

    // Log submission
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      client_id: application.client_id,
      application_id: id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'application_submitted',
      ip_address: req.ip,
    });

    res.json({ success: true, data: updated });
  })
);

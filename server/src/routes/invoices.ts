import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { orgScopeMiddleware } from '../middleware/orgScope.js';
import { validate } from '../middleware/validate.js';
import type { Request, Response, NextFunction } from 'express';

export const invoicesRouter = Router();

// All invoice routes require auth and org scope
invoicesRouter.use(authMiddleware, orgScopeMiddleware);

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

const createInvoiceSchema = z.object({
  clientId: z.string().uuid('Invalid client ID'),
  amount: z.number().positive('Amount must be positive'),
  invoiceType: z.enum(['onboarding', 'monthly', 'success_fee', 'ad_hoc']).optional(),
  dueDate: z.string().optional(), // ISO date string
  reference: z.string().max(255).optional(),
  notes: z.string().max(2000).optional(),
});

const updateInvoiceStatusSchema = z.object({
  status: z.enum(['sent', 'paid', 'overdue', 'cancelled']),
});

const resolveSuccessFeeSchema = z.object({
  outcome: z.enum(['awarded', 'expired']),
  awardAmount: z.number().positive().optional(),
});

// ---- Routes ----

/**
 * GET /
 * List invoices. Paginated, filterable by client_id, status, invoice_type.
 * Scoped to org.
 */
invoicesRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);

    let query = supabase
      .from('invoices')
      .select('*, clients!inner(name)', { count: 'exact' })
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Optional filters
    const clientId = req.query['client_id'] as string | undefined;
    if (clientId) {
      query = query.eq('client_id', clientId);
    }

    const status = req.query['status'] as string | undefined;
    if (status) {
      query = query.eq('status', status);
    }

    const invoiceType = req.query['invoice_type'] as string | undefined;
    if (invoiceType) {
      query = query.eq('invoice_type', invoiceType);
    }

    const { data, error, count } = await query;

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch invoices' },
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

/**
 * POST /
 * Create invoice.
 * Sets org_id from JWT.
 */
invoicesRouter.post(
  '/',
  validate(createInvoiceSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;
    const body = req.body as z.infer<typeof createInvoiceSchema>;

    // Verify client belongs to this org
    const { data: client } = await supabase
      .from('clients')
      .select('id, name')
      .eq('id', body.clientId)
      .eq('organisation_id', orgId)
      .single();

    if (!client) {
      res.status(404).json({
        success: false,
        error: { code: 'CLIENT_NOT_FOUND', message: 'Client not found in your organisation' },
      });
      return;
    }

    const { data: invoice, error } = await supabase
      .from('invoices')
      .insert({
        organisation_id: orgId,
        client_id: body.clientId,
        amount: body.amount,
        invoice_type: body.invoiceType ?? null,
        due_date: body.dueDate ?? null,
        reference: body.reference ?? null,
        notes: body.notes ?? null,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to create invoice' },
      });
      return;
    }

    // Log activity
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      client_id: body.clientId,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'invoice_created',
      details: {
        invoice_id: invoice.id,
        amount: body.amount,
        invoice_type: body.invoiceType,
      },
    });

    res.status(201).json({
      success: true,
      data: invoice,
    });
  })
);

/**
 * GET /:id
 * Invoice detail.
 */
invoicesRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;
    const invoiceId = req.params['id'];

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('*, clients!inner(id, name, primary_contact_name, primary_contact_email)')
      .eq('id', invoiceId)
      .eq('organisation_id', orgId)
      .single();

    if (error || !invoice) {
      res.status(404).json({
        success: false,
        error: { code: 'INVOICE_NOT_FOUND', message: 'Invoice not found' },
      });
      return;
    }

    res.json({
      success: true,
      data: invoice,
    });
  })
);

/**
 * PATCH /:id
 * Update invoice status (sent, paid, overdue, cancelled).
 * Logs status change to activity_log.
 */
invoicesRouter.patch(
  '/:id',
  validate(updateInvoiceStatusSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;
    const invoiceId = req.params['id'];
    const { status } = req.body as z.infer<typeof updateInvoiceStatusSchema>;

    // Verify invoice belongs to this org
    const { data: existing } = await supabase
      .from('invoices')
      .select('id, status, client_id')
      .eq('id', invoiceId)
      .eq('organisation_id', orgId)
      .single();

    if (!existing) {
      res.status(404).json({
        success: false,
        error: { code: 'INVOICE_NOT_FOUND', message: 'Invoice not found' },
      });
      return;
    }

    const previousStatus = existing.status;

    const updateData: Record<string, unknown> = { status };

    // Set timestamps based on status
    if (status === 'sent') {
      updateData.sent_at = new Date().toISOString();
    } else if (status === 'paid') {
      updateData.paid_at = new Date().toISOString();
    }

    const { data: updated, error } = await supabase
      .from('invoices')
      .update(updateData)
      .eq('id', invoiceId)
      .eq('organisation_id', orgId)
      .select()
      .single();

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to update invoice' },
      });
      return;
    }

    // Log activity
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      client_id: existing.client_id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'invoice_status_updated',
      details: {
        invoice_id: invoiceId,
        previous_status: previousStatus,
        new_status: status,
      },
    });

    res.json({
      success: true,
      data: updated,
    });
  })
);

/**
 * GET /success-fees
 * List active success fee windows with client and application details.
 */
invoicesRouter.get(
  '/success-fees',
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;

    const { data, error } = await supabase
      .from('success_fee_windows')
      .select(`
        *,
        clients!inner(id, name, primary_contact_name),
        applications!inner(id, funder_name, project_name, amount_requested)
      `)
      .eq('organisation_id', orgId)
      .order('window_expires_at', { ascending: true });

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch success fee windows' },
      });
      return;
    }

    res.json({
      success: true,
      data,
    });
  })
);

/**
 * POST /success-fees/:id/resolve
 * Resolve a success fee window (awarded or expired).
 * If awarded, auto-create an invoice.
 */
invoicesRouter.post(
  '/success-fees/:id/resolve',
  validate(resolveSuccessFeeSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;
    const windowId = req.params['id'];
    const { outcome, awardAmount } = req.body as z.infer<typeof resolveSuccessFeeSchema>;

    // Verify window belongs to this org and is pending
    const { data: window } = await supabase
      .from('success_fee_windows')
      .select('*')
      .eq('id', windowId)
      .eq('organisation_id', orgId)
      .eq('outcome', 'pending')
      .single();

    if (!window) {
      res.status(404).json({
        success: false,
        error: { code: 'WINDOW_NOT_FOUND', message: 'Success fee window not found or already resolved' },
      });
      return;
    }

    if (outcome === 'awarded' && !awardAmount) {
      res.status(422).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Award amount is required when outcome is awarded' },
      });
      return;
    }

    let invoiceId: string | null = null;

    // If awarded, auto-create a success fee invoice
    if (outcome === 'awarded' && awardAmount) {
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          organisation_id: orgId,
          client_id: window.client_id,
          amount: awardAmount,
          invoice_type: 'success_fee',
          reference: `Success fee — Window ${windowId}`,
          notes: `Auto-generated success fee invoice for application ${window.application_id}`,
        })
        .select()
        .single();

      if (invoiceError) {
        res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: 'Failed to create success fee invoice' },
        });
        return;
      }

      invoiceId = invoice.id;
    }

    // Update the window
    const { data: updated, error: updateError } = await supabase
      .from('success_fee_windows')
      .update({
        outcome,
        award_amount: awardAmount ?? null,
        invoice_id: invoiceId,
      })
      .eq('id', windowId)
      .select()
      .single();

    if (updateError) {
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to resolve success fee window' },
      });
      return;
    }

    // Log activity
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      client_id: window.client_id,
      application_id: window.application_id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'success_fee_resolved',
      details: {
        window_id: windowId,
        outcome,
        award_amount: awardAmount,
        invoice_id: invoiceId,
      },
    });

    res.json({
      success: true,
      data: {
        window: updated,
        invoiceId,
      },
    });
  })
);

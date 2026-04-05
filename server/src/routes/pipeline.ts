import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
// Re-exported for pipeline-to-agent integration consumers
export type { AgentContext } from '../../../shared/types/agents.js';

export const pipelineRouter = Router();

// All pipeline routes require authentication
pipelineRouter.use(authMiddleware);

// ---- Helpers ----

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    fn(req, res).catch(next);
  };
}

// ---- Routes ----

/**
 * GET / — Full pipeline grouped by stage (A, B, C).
 * Returns clients with their active application count and total pipeline value.
 */
pipelineRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;

    // Fetch all clients for the org
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, type, stage, status, primary_contact_name, annual_income, created_at')
      .eq('organisation_id', orgId)
      .neq('status', 'offboarded')
      .order('name', { ascending: true });

    if (clientsError) {
      res.status(500).json({
        success: false,
        error: { code: 'QUERY_FAILED', message: 'Failed to fetch pipeline data' },
      });
      return;
    }

    // Fetch active applications for all clients in one query
    const clientIds = (clients ?? []).map((c) => c.id);

    let applications: Array<{
      client_id: string;
      amount_requested: number | null;
      status: string;
    }> = [];

    if (clientIds.length > 0) {
      const { data: apps } = await supabase
        .from('applications')
        .select('client_id, amount_requested, status, deadline')
        .eq('organisation_id', orgId)
        .in('client_id', clientIds)
        .not('status', 'in', '("withdrawn","unsuccessful")');

      applications = apps ?? [];
    }

    // Group by stage
    const stages: Record<string, Array<{
      id: string;
      name: string;
      type: string | null;
      stage: string;
      status: string;
      primary_contact_name: string | null;
      annual_income: number | null;
      created_at: string;
      active_applications: number;
      pipeline_value: number;
    }>> = { A: [], B: [], C: [] };

    for (const client of clients ?? []) {
      const clientApps = applications.filter((a) => a.client_id === client.id);
      const pipelineValue = clientApps.reduce(
        (sum, a) => sum + (a.amount_requested ?? 0),
        0
      );

      const entry = {
        ...client,
        activeApps: clientApps.length,
        pipelineValue,
        nextDeadline: null as string | null,
      };

      // Find nearest deadline
      const deadlines = clientApps
        .filter((a) => a.deadline)
        .map((a) => a.deadline as string)
        .sort();
      if (deadlines.length > 0) {
        entry.nextDeadline = deadlines[0] ?? null;
      }

      const stage = client.stage as string;
      if (stage in stages) {
        stages[stage]!.push(entry);
      }
    }

    res.json({ success: true, data: stages });
  })
);

/**
 * GET /summary — Monday summary data.
 * Total clients per stage, active applications, upcoming deadlines (next 14 days),
 * and Stage C capacity.
 */
pipelineRouter.get(
  '/summary',
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;

    const now = new Date();
    const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const [clientsResult, appsResult, deadlinesResult, usageResult, planResult] = await Promise.all([
      // Client counts by stage
      supabase
        .from('clients')
        .select('stage')
        .eq('organisation_id', orgId)
        .neq('status', 'offboarded'),

      // Active applications count
      supabase
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .eq('organisation_id', orgId)
        .not('status', 'in', '("withdrawn","unsuccessful","submitted","successful")'),

      // Upcoming deadlines (next 14 days)
      supabase
        .from('applications')
        .select('id, client_id, funder_name, deadline, status, amount_requested')
        .eq('organisation_id', orgId)
        .not('status', 'in', '("withdrawn","unsuccessful","submitted","successful")')
        .gte('deadline', now.toISOString())
        .lte('deadline', fourteenDaysFromNow.toISOString())
        .order('deadline', { ascending: true }),

      // Stage C usage
      supabase
        .from('plan_usage')
        .select('stage_c_clients')
        .eq('organisation_id', orgId)
        .single(),

      // Plan limit for Stage C
      supabase
        .from('organisations')
        .select('plan')
        .eq('id', orgId)
        .single(),
    ]);

    // Count clients per stage
    const stageCounts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const client of clientsResult.data ?? []) {
      const stage = client.stage as string;
      if (stage in stageCounts) {
        stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
      }
    }

    // Look up Stage C limit from the plans table
    let stageCLimit: number | null = null;
    if (planResult.data) {
      const { data: planDetails } = await supabase
        .from('plans')
        .select('max_stage_c_clients')
        .eq('name', planResult.data.plan)
        .eq('active', true)
        .single();

      stageCLimit = planDetails?.max_stage_c_clients ?? null;
    }

    res.json({
      success: true,
      data: {
        clientsByStage: stageCounts,
        totalActive: appsResult.count ?? 0,
        upcomingDeadlines: (deadlinesResult.data ?? []).map((d) => ({
          applicationId: d.id,
          clientId: d.client_id,
          funderName: d.funder_name,
          deadline: d.deadline,
          status: d.status,
          amountRequested: d.amount_requested,
        })),
        stageC: {
          current: usageResult.data?.stage_c_clients ?? 0,
          limit: stageCLimit ?? 4,
        },
      },
    });
  })
);

/**
 * GET /deadlines — Applications with deadlines in the next 30 days, sorted by date.
 */
pipelineRouter.get(
  '/deadlines',
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('applications')
      .select(
        'id, client_id, funder_name, project_name, deadline, status, amount_requested, gate1_passed, gate2_passed, gate3_passed, operator_approval'
      )
      .eq('organisation_id', orgId)
      .not('status', 'in', '("withdrawn","unsuccessful","submitted","successful")')
      .gte('deadline', now.toISOString())
      .lte('deadline', thirtyDaysFromNow.toISOString())
      .order('deadline', { ascending: true });

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'QUERY_FAILED', message: 'Failed to fetch deadlines' },
      });
      return;
    }

    res.json({ success: true, data: data ?? [] });
  })
);

/**
 * GET /capacity — Stage C client count vs plan limit.
 */
pipelineRouter.get(
  '/capacity',
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;

    const [usageResult, orgResult] = await Promise.all([
      supabase
        .from('plan_usage')
        .select('stage_c_clients')
        .eq('organisation_id', orgId)
        .single(),

      supabase
        .from('organisations')
        .select('plan')
        .eq('id', orgId)
        .single(),
    ]);

    let limit: number | null = null;
    if (orgResult.data) {
      const { data: planDetails } = await supabase
        .from('plans')
        .select('max_stage_c_clients')
        .eq('name', orgResult.data.plan)
        .eq('active', true)
        .single();

      limit = planDetails?.max_stage_c_clients ?? null;
    }

    const current = usageResult.data?.stage_c_clients ?? 0;

    res.json({
      success: true,
      data: {
        current,
        limit,
        available: limit != null ? Math.max(0, limit - current) : null,
        at_capacity: limit != null ? current >= limit : false,
      },
    });
  })
);

/**
 * GET /success-fees — Active 60-day success fee windows.
 */
pipelineRouter.get(
  '/success-fees',
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;

    const { data, error } = await supabase
      .from('success_fee_windows')
      .select(
        'id, client_id, application_id, offboarded_at, window_expires_at, outcome, award_amount, alerted, created_at'
      )
      .eq('organisation_id', orgId)
      .eq('outcome', 'pending')
      .gte('window_expires_at', new Date().toISOString())
      .order('window_expires_at', { ascending: true });

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'QUERY_FAILED', message: 'Failed to fetch success fee windows' },
      });
      return;
    }

    res.json({ success: true, data: data ?? [] });
  })
);

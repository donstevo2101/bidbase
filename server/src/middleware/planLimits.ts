import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase.js';

/**
 * Plan limits middleware.
 * Checks the org's current usage against their plan limits
 * before allowing operations that count against limits.
 *
 * Usage: router.post('/clients', authMiddleware, checkPlanLimit('active_clients'), ...)
 */
export function checkPlanLimit(limitType: 'active_clients' | 'stage_c_clients' | 'team_members' | 'storage' | 'agent_calls') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Super admins bypass plan limits
    if (req.user.role === 'super_admin') {
      next();
      return;
    }

    const orgId = req.user.org_id;

    // Fetch org's plan
    const { data: org } = await supabase
      .from('organisations')
      .select('plan')
      .eq('id', orgId)
      .single();

    if (!org) {
      res.status(404).json({
        success: false,
        error: { code: 'ORG_NOT_FOUND', message: 'Organisation not found' },
      });
      return;
    }

    // Fetch plan limits
    const { data: plan } = await supabase
      .from('plans')
      .select('*')
      .eq('name', org.plan)
      .single();

    if (!plan) {
      next(); // No plan config — allow (defensive)
      return;
    }

    // Fetch current usage
    const { data: usage } = await supabase
      .from('plan_usage')
      .select('*')
      .eq('organisation_id', orgId)
      .single();

    if (!usage) {
      next(); // No usage record yet — allow
      return;
    }

    const limitMap: Record<string, { current: number; max: number | null }> = {
      active_clients: { current: usage.active_clients, max: plan.max_active_clients },
      stage_c_clients: { current: usage.stage_c_clients, max: plan.max_stage_c_clients },
      team_members: { current: usage.team_members, max: plan.max_team_members },
      storage: { current: usage.storage_used_gb, max: plan.max_storage_gb },
      agent_calls: { current: usage.agent_calls_month, max: null }, // No hard cap — metered
    };

    const check = limitMap[limitType];
    if (check && check.max !== null && check.current >= check.max) {
      res.status(429).json({
        success: false,
        error: {
          code: 'PLAN_LIMIT_REACHED',
          message: `You have reached the ${limitType.replace('_', ' ')} limit for your ${org.plan} plan. Please upgrade to continue.`,
        },
      });
      return;
    }

    next();
  };
}

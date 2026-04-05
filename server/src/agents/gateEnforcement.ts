import { supabase } from '../lib/supabase.js';

interface GateResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Fetches an application record scoped to the organisation.
 * Throws if the application does not exist or does not belong to the org.
 */
async function getApplication(applicationId: string, orgId: string) {
  const { data, error } = await supabase
    .from('applications')
    .select(
      'id, gate1_passed, gate2_passed, gate2_risk_level, gate3_passed, operator_approval'
    )
    .eq('id', applicationId)
    .eq('organisation_id', orgId)
    .single();

  if (error || !data) {
    throw new Error(`Application ${applicationId} not found for organisation ${orgId}`);
  }

  return data;
}

/**
 * Gate enforcement: can drafting begin for this application?
 *
 * Returns false if:
 * - Gate 1 has not passed
 * - Gate 2 has not passed
 * - Gate 2 flagged HIGH RISK and operator has not approved
 *
 * This is enforced server-side and cannot be bypassed by the frontend.
 * (Constraints 1, 2 from CLAUDE.md)
 */
export async function canBeginDrafting(
  applicationId: string,
  orgId: string
): Promise<GateResult> {
  const app = await getApplication(applicationId, orgId);

  if (!app.gate1_passed) {
    return { allowed: false, reason: 'Gate 1 not cleared for this application.' };
  }

  if (!app.gate2_passed) {
    return { allowed: false, reason: 'Gate 2 not completed.' };
  }

  if (app.gate2_risk_level === 'high_risk' && !app.operator_approval) {
    return {
      allowed: false,
      reason: 'Gate 2 flagged HIGH RISK. Operator approval required before drafting.',
    };
  }

  return { allowed: true };
}

/**
 * Gate enforcement: can this application be submitted?
 *
 * Returns false if:
 * - Operator has not given explicit approval
 * - Gate 3 quality review has not passed
 *
 * No application is ever submitted without operator explicit written approval.
 * This is enforced server-side and cannot be bypassed. (Constraint 1 from CLAUDE.md)
 */
export async function canSubmitApplication(
  applicationId: string,
  orgId: string
): Promise<GateResult> {
  const app = await getApplication(applicationId, orgId);

  if (!app.operator_approval) {
    return {
      allowed: false,
      reason: 'Operator explicit approval required. This cannot be bypassed.',
    };
  }

  if (!app.gate3_passed) {
    return { allowed: false, reason: 'Gate 3 quality review not completed.' };
  }

  return { allowed: true };
}

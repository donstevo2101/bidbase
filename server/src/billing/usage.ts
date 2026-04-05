import { supabase } from '../lib/supabase.js';
import { PLAN_FEATURES } from './plans.js';

// ---- Usage counter operations ----

/**
 * Increment a usage counter for an organisation.
 * Creates the plan_usage row if it does not exist.
 */
export async function incrementUsage(
  orgId: string,
  counter: 'active_clients' | 'stage_c_clients' | 'team_members' | 'agent_calls_month',
  amount = 1
): Promise<void> {
  // Ensure usage row exists
  await ensureUsageRow(orgId);

  // Use RPC or manual update — Supabase JS doesn't support increment natively
  // so we read-then-write within a short window. For production, an RPC is better.
  const { data: current } = await supabase
    .from('plan_usage')
    .select(counter)
    .eq('organisation_id', orgId)
    .single();

  if (!current) return;

  const currentValue = (current as Record<string, number>)[counter] ?? 0;

  await supabase
    .from('plan_usage')
    .update({
      [counter]: currentValue + amount,
      updated_at: new Date().toISOString(),
    })
    .eq('organisation_id', orgId);
}

/**
 * Decrement a usage counter for an organisation.
 * Will not go below zero.
 */
export async function decrementUsage(
  orgId: string,
  counter: 'active_clients' | 'stage_c_clients' | 'team_members',
  amount = 1
): Promise<void> {
  await ensureUsageRow(orgId);

  const { data: current } = await supabase
    .from('plan_usage')
    .select(counter)
    .eq('organisation_id', orgId)
    .single();

  if (!current) return;

  const currentValue = (current as Record<string, number>)[counter] ?? 0;
  const newValue = Math.max(0, currentValue - amount);

  await supabase
    .from('plan_usage')
    .update({
      [counter]: newValue,
      updated_at: new Date().toISOString(),
    })
    .eq('organisation_id', orgId);
}

/**
 * Increment storage usage in GB.
 */
export async function incrementStorageUsage(
  orgId: string,
  sizeGb: number
): Promise<void> {
  await ensureUsageRow(orgId);

  const { data: current } = await supabase
    .from('plan_usage')
    .select('storage_used_gb')
    .eq('organisation_id', orgId)
    .single();

  if (!current) return;

  await supabase
    .from('plan_usage')
    .update({
      storage_used_gb: (current.storage_used_gb ?? 0) + sizeGb,
      updated_at: new Date().toISOString(),
    })
    .eq('organisation_id', orgId);
}

/**
 * Reconcile usage counters by recounting from actual data.
 * Should be run periodically (e.g. daily) to correct any drift.
 */
export async function reconcileUsage(orgId: string): Promise<void> {
  await ensureUsageRow(orgId);

  // Count active clients
  const { count: activeClients } = await supabase
    .from('clients')
    .select('*', { count: 'exact', head: true })
    .eq('organisation_id', orgId)
    .in('status', ['lead', 'active', 'paused']);

  // Count Stage C clients
  const { count: stageCClients } = await supabase
    .from('clients')
    .select('*', { count: 'exact', head: true })
    .eq('organisation_id', orgId)
    .eq('stage', 'C')
    .in('status', ['lead', 'active', 'paused']);

  // Count team members (org_admin + org_member roles)
  const { count: teamMembers } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('organisation_id', orgId)
    .in('role', ['org_admin', 'org_member']);

  await supabase
    .from('plan_usage')
    .update({
      active_clients: activeClients ?? 0,
      stage_c_clients: stageCClients ?? 0,
      team_members: teamMembers ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq('organisation_id', orgId);
}

/**
 * Check if an organisation is within plan limits for a given resource.
 * Returns { withinLimit: true } or { withinLimit: false, current, max }.
 */
export async function checkWithinPlanLimits(
  orgId: string,
  resource: 'active_clients' | 'stage_c_clients' | 'team_members' | 'storage_used_gb'
): Promise<{ withinLimit: boolean; current: number; max: number | null }> {
  // Fetch org plan
  const { data: org } = await supabase
    .from('organisations')
    .select('plan')
    .eq('id', orgId)
    .single();

  if (!org) {
    return { withinLimit: false, current: 0, max: 0 };
  }

  const planDef = PLAN_FEATURES[org.plan];
  if (!planDef) {
    return { withinLimit: true, current: 0, max: null };
  }

  // Map resource to plan limit key
  const limitMap: Record<string, keyof typeof planDef> = {
    active_clients: 'maxActiveClients',
    stage_c_clients: 'maxStageCClients',
    team_members: 'maxTeamMembers',
    storage_used_gb: 'maxStorageGb',
  };

  const limitKey = limitMap[resource];
  const max = planDef[limitKey] as number | null;

  // null = unlimited
  if (max === null) {
    return { withinLimit: true, current: 0, max: null };
  }

  // Fetch current usage
  const { data: usage } = await supabase
    .from('plan_usage')
    .select(resource)
    .eq('organisation_id', orgId)
    .single();

  const current = usage ? (usage as Record<string, number>)[resource] ?? 0 : 0;

  return {
    withinLimit: current < max,
    current,
    max,
  };
}

// ---- Internal helpers ----

async function ensureUsageRow(orgId: string): Promise<void> {
  const { data } = await supabase
    .from('plan_usage')
    .select('id')
    .eq('organisation_id', orgId)
    .single();

  if (!data) {
    await supabase
      .from('plan_usage')
      .insert({ organisation_id: orgId });
  }
}

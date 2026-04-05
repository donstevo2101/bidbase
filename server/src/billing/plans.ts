// ---- Plan definitions ----

export interface PlanFeatures {
  maxActiveClients: number | null; // null = unlimited
  maxStageCClients: number;
  maxTeamMembers: number | null;
  maxStorageGb: number | null;
  coreAgents: boolean;
  advancedAgents: boolean;
  clientPortal: 'basic' | 'full' | 'full_whitelabel';
  whiteLabelDomain: boolean;
  customBranding: 'none' | 'limited' | 'full';
  prioritySupport: 'none' | 'email' | 'dedicated';
}

export const PLAN_FEATURES: Record<string, PlanFeatures> = {
  starter: {
    maxActiveClients: 10,
    maxStageCClients: 4,
    maxTeamMembers: 2,
    maxStorageGb: 10,
    coreAgents: true,
    advancedAgents: false,
    clientPortal: 'basic',
    whiteLabelDomain: false,
    customBranding: 'none',
    prioritySupport: 'none',
  },
  professional: {
    maxActiveClients: 50,
    maxStageCClients: 4,
    maxTeamMembers: 10,
    maxStorageGb: 50,
    coreAgents: true,
    advancedAgents: true,
    clientPortal: 'full',
    whiteLabelDomain: false,
    customBranding: 'limited',
    prioritySupport: 'email',
  },
  enterprise: {
    maxActiveClients: null,
    maxStageCClients: 4, // configurable per org via settings override
    maxTeamMembers: null,
    maxStorageGb: null,
    coreAgents: true,
    advancedAgents: true,
    clientPortal: 'full_whitelabel',
    whiteLabelDomain: true,
    customBranding: 'full',
    prioritySupport: 'dedicated',
  },
};

// Advanced agents only available on professional and enterprise plans
const ADVANCED_AGENT_TYPES = [
  'social_value',
  'funder_intelligence',
  'impact_measurement',
] as const;

/**
 * Check if a specific feature is available on a given plan.
 */
export function isFeatureAvailable(
  plan: string,
  feature: keyof PlanFeatures
): boolean {
  const planDef = PLAN_FEATURES[plan];
  if (!planDef) return false;

  const value = planDef[feature];
  // Boolean features
  if (typeof value === 'boolean') return value;
  // String features — available if not 'none'
  if (typeof value === 'string') return value !== 'none';
  // Numeric features — available if not 0
  if (typeof value === 'number') return value > 0;
  // null means unlimited — always available
  return true;
}

/**
 * Check if a specific agent type is available on a given plan.
 */
export function isAgentAvailableOnPlan(
  plan: string,
  agentType: string
): boolean {
  const planDef = PLAN_FEATURES[plan];
  if (!planDef) return false;

  // Core agents available on all plans
  if (!ADVANCED_AGENT_TYPES.includes(agentType as (typeof ADVANCED_AGENT_TYPES)[number])) {
    return planDef.coreAgents;
  }

  // Advanced agents require advancedAgents flag
  return planDef.advancedAgents;
}

/**
 * Get the limit value for a specific resource on a plan.
 * Returns null for unlimited.
 */
export function getPlanLimit(
  plan: string,
  resource: 'maxActiveClients' | 'maxStageCClients' | 'maxTeamMembers' | 'maxStorageGb'
): number | null {
  const planDef = PLAN_FEATURES[plan];
  if (!planDef) return 0;
  return planDef[resource];
}

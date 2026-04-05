// Database types — mirrors Supabase schema
// In production, generate with: supabase gen types typescript

export type UserRole = 'super_admin' | 'org_admin' | 'org_member' | 'client_admin' | 'client_member';
export type PlanName = 'starter' | 'professional' | 'enterprise';
export type OnboardingType = 'self_serve' | 'manual';
export type ClientType = 'CIC' | 'charity' | 'social_enterprise' | 'unincorporated' | 'other';
export type ClientStage = 'A' | 'B' | 'C';
export type ClientStatus = 'lead' | 'active' | 'paused' | 'offboarded';

export type ApplicationStatus =
  | 'researching' | 'gate1_pending' | 'gate1_failed'
  | 'gate2_pending' | 'gate2_high_risk'
  | 'drafting' | 'gate3_pending' | 'draft_ready'
  | 'awaiting_approval' | 'submitted'
  | 'successful' | 'unsuccessful' | 'withdrawn';

export type GateRiskLevel = 'pass' | 'high_risk';
export type ApplicationOutcome = 'successful' | 'unsuccessful' | 'pending';

export type DocumentType =
  | 'governance' | 'financial' | 'policy' | 'evidence'
  | 'questionnaire' | 'transcript' | 'correspondence'
  | 'draft' | 'impact_data' | 'other';

export type DocumentProcessingStatus = 'pending' | 'processed' | 'failed';

export type AgentType =
  | 'head_coach' | 'va' | 'eligibility' | 'grant_writer'
  | 'ops_manager' | 'social_media' | 'social_value'
  | 'funder_intelligence' | 'impact_measurement';

export type TaskType =
  | 'gate1_check' | 'gate2_check' | 'gate3_check' | 'funder_shortlist'
  | 'draft_application' | 'monday_summary' | 'create_content'
  | 'onboarding_sequence' | 'social_value_report' | 'impact_report'
  | 'funder_intelligence_update';

export type TaskStatus = 'pending' | 'in_progress' | 'complete' | 'failed' | 'escalated' | 'awaiting_approval';
export type ActorType = 'user' | 'agent' | 'system';
export type InvoiceStatus = 'pending' | 'sent' | 'paid' | 'overdue' | 'cancelled';
export type InvoiceType = 'onboarding' | 'monthly' | 'success_fee' | 'ad_hoc';
export type SuccessFeeOutcome = 'pending' | 'awarded' | 'expired';

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  owner_id: string | null;
  plan: PlanName;
  plan_started_at: string | null;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  onboarding_type: OnboardingType;
  onboarding_complete: boolean;
  onboarding_state: Record<string, unknown>;
  white_label_domain: string | null;
  branding: Record<string, unknown>;
  settings: Record<string, unknown>;
  active: boolean;
  suspended: boolean;
  suspended_reason: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  organisation_id: string | null;
  role: UserRole;
  full_name: string | null;
  avatar_url: string | null;
  preferences: Record<string, unknown>;
  created_at: string;
}

export interface Client {
  id: string;
  organisation_id: string;
  name: string;
  type: ClientType | null;
  stage: ClientStage;
  status: ClientStatus;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  annual_income: number | null;
  registered_number: string | null;
  address: Record<string, unknown> | null;
  policies_held: string[] | null;
  existing_grants: Array<{ funder: string; amount: number; open_until: string }>;
  notes: string | null;
  assigned_to: string | null;
  portal_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Application {
  id: string;
  organisation_id: string;
  client_id: string;
  funder_name: string;
  funder_id: string | null;
  project_name: string | null;
  project_description: string | null;
  amount_requested: number | null;
  deadline: string | null;
  status: ApplicationStatus;
  gate1_passed: boolean | null;
  gate1_report: Record<string, unknown> | null;
  gate1_checked_at: string | null;
  gate2_passed: boolean | null;
  gate2_report: Record<string, unknown> | null;
  gate2_risk_level: GateRiskLevel | null;
  gate2_checked_at: string | null;
  gate3_passed: boolean | null;
  gate3_report: Record<string, unknown> | null;
  gate3_checked_at: string | null;
  draft_content: Array<{ question: string; answer: string }> | null;
  budget_reconciliation: Record<string, unknown> | null;
  operator_approval: boolean;
  operator_approved_by: string | null;
  operator_approved_at: string | null;
  submitted_at: string | null;
  outcome: ApplicationOutcome | null;
  outcome_amount: number | null;
  outcome_date: string | null;
  outcome_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Funder {
  id: string;
  organisation_id: string | null;
  name: string;
  website: string | null;
  grant_range_min: number | null;
  grant_range_max: number | null;
  eligible_structures: string[] | null;
  eligible_geographies: string[] | null;
  open_rounds: Array<{
    name: string;
    opens: string;
    closes: string;
    priorities: string[];
    notes: string;
  }>;
  notes: string | null;
  requires_preregistration: boolean;
  preregistration_lead_weeks: number | null;
  rejection_gap_months: number | null;
  verified: boolean;
  last_updated: string;
  created_at: string;
}

export interface Document {
  id: string;
  organisation_id: string;
  client_id: string;
  application_id: string | null;
  name: string;
  type: DocumentType;
  storage_path: string;
  storage_bucket: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  processing_status: DocumentProcessingStatus;
  extracted_text: string | null;
  notes: string | null;
  created_at: string;
}

export interface AgentConversation {
  id: string;
  organisation_id: string;
  client_id: string | null;
  application_id: string | null;
  agent_type: AgentType;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
  context_pack: Record<string, unknown>;
  status: 'active' | 'archived';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentTask {
  id: string;
  organisation_id: string;
  conversation_id: string | null;
  client_id: string | null;
  application_id: string | null;
  assigned_to: AgentType;
  task_type: TaskType;
  status: TaskStatus;
  brief: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  escalated_to: 'operator' | 'head_coach' | null;
  escalation_reason: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ActivityLogEntry {
  id: string;
  organisation_id: string;
  client_id: string | null;
  application_id: string | null;
  document_id: string | null;
  actor_id: string | null;
  actor_type: ActorType;
  action: string;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface Invoice {
  id: string;
  organisation_id: string;
  client_id: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  due_date: string | null;
  sent_at: string | null;
  paid_at: string | null;
  invoice_type: InvoiceType | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

export interface Plan {
  id: string;
  name: PlanName;
  stripe_price_id: string | null;
  monthly_price_gbp: number | null;
  max_active_clients: number | null;
  max_stage_c_clients: number;
  max_team_members: number | null;
  max_storage_gb: number | null;
  agents_enabled: AgentType[];
  features: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

export interface PlanUsage {
  id: string;
  organisation_id: string;
  active_clients: number;
  stage_c_clients: number;
  team_members: number;
  storage_used_gb: number;
  agent_calls_month: number;
  updated_at: string;
}

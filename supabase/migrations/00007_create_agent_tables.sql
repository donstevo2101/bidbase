-- Agent conversations
CREATE TABLE agent_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
  client_id       uuid REFERENCES clients ON DELETE SET NULL,
  application_id  uuid REFERENCES applications ON DELETE SET NULL,
  agent_type      text NOT NULL
                  CHECK (agent_type IN (
                    'head_coach', 'va', 'eligibility', 'grant_writer',
                    'ops_manager', 'social_media', 'social_value',
                    'funder_intelligence', 'impact_measurement'
                  )),
  messages        jsonb NOT NULL DEFAULT '[]',
  context_pack    jsonb DEFAULT '{}',
  status          text DEFAULT 'active'
                  CHECK (status IN ('active', 'archived')),
  created_by      uuid REFERENCES profiles,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_agent_conversations_org ON agent_conversations (organisation_id);
CREATE INDEX idx_agent_conversations_client ON agent_conversations (client_id);

CREATE TRIGGER agent_conversations_updated_at
  BEFORE UPDATE ON agent_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Agent tasks (discrete tasks assigned by Head Coach to sub-agents)
CREATE TABLE agent_tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
  conversation_id   uuid REFERENCES agent_conversations ON DELETE SET NULL,
  client_id         uuid REFERENCES clients ON DELETE SET NULL,
  application_id    uuid REFERENCES applications ON DELETE SET NULL,
  assigned_to       text NOT NULL
                    CHECK (assigned_to IN (
                      'head_coach', 'va', 'eligibility', 'grant_writer',
                      'ops_manager', 'social_media', 'social_value',
                      'funder_intelligence', 'impact_measurement'
                    )),
  task_type         text NOT NULL
                    CHECK (task_type IN (
                      'gate1_check', 'gate2_check', 'gate3_check', 'funder_shortlist',
                      'draft_application', 'monday_summary', 'create_content',
                      'onboarding_sequence', 'social_value_report', 'impact_report',
                      'funder_intelligence_update'
                    )),
  status            text DEFAULT 'pending'
                    CHECK (status IN (
                      'pending', 'in_progress', 'complete', 'failed',
                      'escalated', 'awaiting_approval'
                    )),
  brief             jsonb,
  output            jsonb,
  escalated_to      text CHECK (escalated_to IN ('operator', 'head_coach')),
  escalation_reason text,
  created_at        timestamptz DEFAULT now(),
  started_at        timestamptz,
  completed_at      timestamptz
);

CREATE INDEX idx_agent_tasks_org ON agent_tasks (organisation_id);
CREATE INDEX idx_agent_tasks_status ON agent_tasks (organisation_id, status);

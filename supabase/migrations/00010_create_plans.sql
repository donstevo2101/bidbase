-- Platform plans (defines feature limits per plan)
CREATE TABLE plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL UNIQUE
                      CHECK (name IN ('starter', 'professional', 'enterprise')),
  stripe_price_id     text,
  monthly_price_gbp   numeric,
  max_active_clients  integer,
  max_stage_c_clients integer DEFAULT 4,
  max_team_members    integer,
  max_storage_gb      integer,
  agents_enabled      text[],
  features            jsonb DEFAULT '{}',
  active              boolean DEFAULT true,
  created_at          timestamptz DEFAULT now()
);

-- Plan usage (metered per organisation)
CREATE TABLE plan_usage (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE UNIQUE,
  active_clients  integer DEFAULT 0,
  stage_c_clients integer DEFAULT 0,
  team_members    integer DEFAULT 0,
  storage_used_gb numeric DEFAULT 0,
  agent_calls_month integer DEFAULT 0,
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_plan_usage_org ON plan_usage (organisation_id);

-- Seed default plans
INSERT INTO plans (name, monthly_price_gbp, max_active_clients, max_stage_c_clients, max_team_members, max_storage_gb, agents_enabled) VALUES
  ('starter', 49, 10, 4, 2, 10,
    ARRAY['head_coach', 'va', 'eligibility', 'grant_writer', 'ops_manager', 'social_media']),
  ('professional', 149, 50, 4, 10, 50,
    ARRAY['head_coach', 'va', 'eligibility', 'grant_writer', 'ops_manager', 'social_media',
          'social_value', 'funder_intelligence', 'impact_measurement']),
  ('enterprise', NULL, NULL, NULL, NULL, NULL,
    ARRAY['head_coach', 'va', 'eligibility', 'grant_writer', 'ops_manager', 'social_media',
          'social_value', 'funder_intelligence', 'impact_measurement']);

-- Create organisations table (one per bid writing business)
CREATE TABLE organisations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  slug                    text UNIQUE NOT NULL,
  owner_id                uuid REFERENCES auth.users,
  plan                    text DEFAULT 'starter'
                          CHECK (plan IN ('starter', 'professional', 'enterprise')),
  plan_started_at         timestamptz,
  trial_ends_at           timestamptz,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  onboarding_type         text DEFAULT 'self_serve'
                          CHECK (onboarding_type IN ('self_serve', 'manual')),
  onboarding_complete     boolean DEFAULT false,
  onboarding_state        jsonb DEFAULT '{}',
  white_label_domain      text,
  branding                jsonb DEFAULT '{}',
  settings                jsonb DEFAULT '{}',
  active                  boolean DEFAULT false,
  suspended               boolean DEFAULT false,
  suspended_reason        text,
  created_at              timestamptz DEFAULT now()
);

-- Index for slug lookups and owner lookups
CREATE INDEX idx_organisations_slug ON organisations (slug);
CREATE INDEX idx_organisations_owner_id ON organisations (owner_id);
CREATE INDEX idx_organisations_active ON organisations (active) WHERE active = true;

-- Applications (grant applications)
CREATE TABLE applications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
  client_id             uuid NOT NULL REFERENCES clients ON DELETE CASCADE,
  funder_name           text NOT NULL,
  funder_id             uuid REFERENCES funders,
  project_name          text,
  project_description   text,
  amount_requested      numeric,
  deadline              timestamptz,
  status                text DEFAULT 'researching'
                        CHECK (status IN (
                          'researching', 'gate1_pending', 'gate1_failed',
                          'gate2_pending', 'gate2_high_risk',
                          'drafting', 'gate3_pending', 'draft_ready',
                          'awaiting_approval', 'submitted',
                          'successful', 'unsuccessful', 'withdrawn'
                        )),
  gate1_passed          boolean,
  gate1_report          jsonb,
  gate1_checked_at      timestamptz,
  gate2_passed          boolean,
  gate2_report          jsonb,
  gate2_risk_level      text CHECK (gate2_risk_level IN ('pass', 'high_risk')),
  gate2_checked_at      timestamptz,
  gate3_passed          boolean,
  gate3_report          jsonb,
  gate3_checked_at      timestamptz,
  draft_content         jsonb,
  budget_reconciliation jsonb,
  operator_approval     boolean DEFAULT false,
  operator_approved_by  uuid REFERENCES profiles,
  operator_approved_at  timestamptz,
  submitted_at          timestamptz,
  outcome               text CHECK (outcome IN ('successful', 'unsuccessful', 'pending')),
  outcome_amount        numeric,
  outcome_date          date,
  outcome_notes         text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE INDEX idx_applications_organisation_id ON applications (organisation_id);
CREATE INDEX idx_applications_client_id ON applications (client_id);
CREATE INDEX idx_applications_status ON applications (organisation_id, status);
CREATE INDEX idx_applications_deadline ON applications (deadline) WHERE deadline IS NOT NULL;

CREATE TRIGGER applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

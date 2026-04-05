-- Clients (CICs, charities, social enterprises)
CREATE TABLE clients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
  name                  text NOT NULL,
  type                  text
                        CHECK (type IN ('CIC', 'charity', 'social_enterprise', 'unincorporated', 'other')),
  stage                 text NOT NULL DEFAULT 'A'
                        CHECK (stage IN ('A', 'B', 'C')),
  status                text NOT NULL DEFAULT 'lead'
                        CHECK (status IN ('lead', 'active', 'paused', 'offboarded')),
  primary_contact_name  text,
  primary_contact_email text,
  primary_contact_phone text,
  annual_income         numeric,
  registered_number     text,
  address               jsonb,
  policies_held         text[],
  existing_grants       jsonb DEFAULT '[]',
  notes                 text,
  assigned_to           uuid REFERENCES profiles,
  portal_enabled        boolean DEFAULT false,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE INDEX idx_clients_organisation_id ON clients (organisation_id);
CREATE INDEX idx_clients_stage ON clients (organisation_id, stage);
CREATE INDEX idx_clients_status ON clients (organisation_id, status);
CREATE INDEX idx_clients_assigned_to ON clients (assigned_to);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

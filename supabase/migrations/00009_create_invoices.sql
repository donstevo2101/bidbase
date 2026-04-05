-- Invoices
CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES clients ON DELETE CASCADE,
  amount          numeric NOT NULL,
  currency        text DEFAULT 'GBP',
  status          text DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'paid', 'overdue', 'cancelled')),
  due_date        date,
  sent_at         timestamptz,
  paid_at         timestamptz,
  invoice_type    text
                  CHECK (invoice_type IN ('onboarding', 'monthly', 'success_fee', 'ad_hoc')),
  reference       text,
  notes           text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_invoices_org ON invoices (organisation_id);
CREATE INDEX idx_invoices_client ON invoices (client_id);
CREATE INDEX idx_invoices_status ON invoices (organisation_id, status);

-- Success fee windows
CREATE TABLE success_fee_windows (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
  client_id         uuid NOT NULL REFERENCES clients ON DELETE CASCADE,
  application_id    uuid NOT NULL REFERENCES applications ON DELETE CASCADE,
  offboarded_at     timestamptz NOT NULL,
  window_expires_at timestamptz NOT NULL,
  outcome           text DEFAULT 'pending'
                    CHECK (outcome IN ('pending', 'awarded', 'expired')),
  award_amount      numeric,
  invoice_id        uuid REFERENCES invoices,
  alerted           boolean DEFAULT false,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_success_fee_windows_org ON success_fee_windows (organisation_id);
CREATE INDEX idx_success_fee_windows_expiry ON success_fee_windows (window_expires_at)
  WHERE outcome = 'pending';

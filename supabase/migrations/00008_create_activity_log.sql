-- Activity log (full audit trail)
CREATE TABLE activity_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
  client_id       uuid REFERENCES clients ON DELETE SET NULL,
  application_id  uuid REFERENCES applications ON DELETE SET NULL,
  document_id     uuid REFERENCES documents ON DELETE SET NULL,
  actor_id        uuid REFERENCES profiles ON DELETE SET NULL,
  actor_type      text DEFAULT 'user'
                  CHECK (actor_type IN ('user', 'agent', 'system')),
  action          text NOT NULL,
  details         jsonb,
  ip_address      inet,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_activity_log_org ON activity_log (organisation_id);
CREATE INDEX idx_activity_log_client ON activity_log (client_id);
CREATE INDEX idx_activity_log_created ON activity_log (organisation_id, created_at DESC);

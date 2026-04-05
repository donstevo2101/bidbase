-- Documents
CREATE TABLE documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
  client_id         uuid NOT NULL REFERENCES clients ON DELETE CASCADE,
  application_id    uuid REFERENCES applications ON DELETE SET NULL,
  name              text NOT NULL,
  type              text NOT NULL
                    CHECK (type IN (
                      'governance', 'financial', 'policy', 'evidence',
                      'questionnaire', 'transcript', 'correspondence',
                      'draft', 'impact_data', 'other'
                    )),
  storage_path      text NOT NULL,
  storage_bucket    text NOT NULL,
  file_size         integer,
  mime_type         text,
  uploaded_by       uuid REFERENCES profiles,
  processing_status text DEFAULT 'pending'
                    CHECK (processing_status IN ('pending', 'processed', 'failed')),
  extracted_text    text,
  notes             text,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_documents_organisation_id ON documents (organisation_id);
CREATE INDEX idx_documents_client_id ON documents (client_id);
CREATE INDEX idx_documents_application_id ON documents (application_id);
CREATE INDEX idx_documents_type ON documents (organisation_id, type);

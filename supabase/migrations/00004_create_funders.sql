-- Funders
CREATE TABLE funders (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id             uuid REFERENCES organisations ON DELETE CASCADE,
  name                        text NOT NULL,
  website                     text,
  grant_range_min             numeric,
  grant_range_max             numeric,
  eligible_structures         text[],
  eligible_geographies        text[],
  open_rounds                 jsonb DEFAULT '[]',
  notes                       text,
  requires_preregistration    boolean DEFAULT false,
  preregistration_lead_weeks  integer,
  rejection_gap_months        integer,
  verified                    boolean DEFAULT false,
  last_updated                timestamptz DEFAULT now(),
  created_at                  timestamptz DEFAULT now()
);

-- organisation_id can be NULL for platform-wide shared funders
CREATE INDEX idx_funders_organisation_id ON funders (organisation_id);
CREATE INDEX idx_funders_name ON funders USING gin (name gin_trgm_ops);

-- Enable trigram extension for funder name search
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

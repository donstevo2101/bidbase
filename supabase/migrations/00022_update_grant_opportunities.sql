ALTER TABLE grant_opportunities ADD COLUMN IF NOT EXISTS open_date text;
ALTER TABLE grant_opportunities ADD COLUMN IF NOT EXISTS close_date text;
ALTER TABLE grant_opportunities ADD COLUMN IF NOT EXISTS status text DEFAULT 'open';
ALTER TABLE grant_opportunities ADD COLUMN IF NOT EXISTS previous_awards integer;
ALTER TABLE grant_opportunities ADD COLUMN IF NOT EXISTS total_applicants integer;
ALTER TABLE grant_opportunities ADD COLUMN IF NOT EXISTS average_award text;
ALTER TABLE grant_opportunities ADD COLUMN IF NOT EXISTS sectors text[];

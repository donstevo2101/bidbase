CREATE TABLE grant_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  funder text NOT NULL,
  url text,
  amount text,
  deadline text,
  eligibility text,
  description text,
  source text NOT NULL,
  scraped_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE grant_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_read_grants" ON grant_opportunities FOR SELECT USING (true);
CREATE POLICY "super_admin_manage_grants" ON grant_opportunities FOR ALL USING (public.get_user_role() = 'super_admin');

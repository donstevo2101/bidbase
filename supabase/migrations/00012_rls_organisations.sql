-- =============================================================
-- RLS policies: organisations
-- =============================================================

-- Helper function: extract org_id from JWT
CREATE OR REPLACE FUNCTION auth.org_id() RETURNS uuid AS $$
  SELECT (auth.jwt() ->> 'org_id')::uuid;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper function: extract user role from JWT
CREATE OR REPLACE FUNCTION auth.user_role() RETURNS text AS $$
  SELECT auth.jwt() ->> 'user_role';
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Super admins can see all organisations
CREATE POLICY "super_admin_all_orgs" ON organisations
  FOR ALL
  USING (auth.user_role() = 'super_admin');

-- Org members can read their own organisation
CREATE POLICY "org_members_read_own_org" ON organisations
  FOR SELECT
  USING (id = auth.org_id());

-- Org admins can update their own organisation
CREATE POLICY "org_admin_update_own_org" ON organisations
  FOR UPDATE
  USING (id = auth.org_id() AND auth.user_role() = 'org_admin')
  WITH CHECK (id = auth.org_id() AND auth.user_role() = 'org_admin');

-- Allow insert during signup (service role handles this, but policy needed)
CREATE POLICY "allow_org_creation" ON organisations
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());

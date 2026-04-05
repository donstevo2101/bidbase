-- =============================================================
-- RLS policies: clients
-- =============================================================

-- Org members can read clients in their org
CREATE POLICY "org_read_clients" ON clients
  FOR SELECT
  USING (organisation_id = auth.org_id());

-- Org admins and members can create clients
CREATE POLICY "org_create_clients" ON clients
  FOR INSERT
  WITH CHECK (
    organisation_id = auth.org_id()
    AND auth.user_role() IN ('org_admin', 'org_member')
  );

-- Org admins and members can update clients in their org
CREATE POLICY "org_update_clients" ON clients
  FOR UPDATE
  USING (
    organisation_id = auth.org_id()
    AND auth.user_role() IN ('org_admin', 'org_member')
  )
  WITH CHECK (organisation_id = auth.org_id());

-- Only org admins can delete clients
CREATE POLICY "org_admin_delete_clients" ON clients
  FOR DELETE
  USING (
    organisation_id = auth.org_id()
    AND auth.user_role() = 'org_admin'
  );

-- Client users can read their own client record
-- (client_admin/client_member see their org's data via portal)
CREATE POLICY "client_users_read_own" ON clients
  FOR SELECT
  USING (
    auth.user_role() IN ('client_admin', 'client_member')
    AND organisation_id = auth.org_id()
  );

-- Super admins see all
CREATE POLICY "super_admin_all_clients" ON clients
  FOR ALL
  USING (auth.user_role() = 'super_admin');

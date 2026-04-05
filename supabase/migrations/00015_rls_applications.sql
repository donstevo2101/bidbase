-- =============================================================
-- RLS policies: applications
-- =============================================================

-- Org members can read applications in their org
CREATE POLICY "org_read_applications" ON applications
  FOR SELECT
  USING (organisation_id = auth.org_id());

-- Org admins and members can create applications
CREATE POLICY "org_create_applications" ON applications
  FOR INSERT
  WITH CHECK (
    organisation_id = auth.org_id()
    AND auth.user_role() IN ('org_admin', 'org_member')
  );

-- Org admins and members can update applications
CREATE POLICY "org_update_applications" ON applications
  FOR UPDATE
  USING (
    organisation_id = auth.org_id()
    AND auth.user_role() IN ('org_admin', 'org_member')
  )
  WITH CHECK (organisation_id = auth.org_id());

-- Only org admins can delete applications
CREATE POLICY "org_admin_delete_applications" ON applications
  FOR DELETE
  USING (
    organisation_id = auth.org_id()
    AND auth.user_role() = 'org_admin'
  );

-- Client admins can read their client's applications
CREATE POLICY "client_read_applications" ON applications
  FOR SELECT
  USING (
    auth.user_role() IN ('client_admin', 'client_member')
    AND organisation_id = auth.org_id()
  );

-- Super admins see all
CREATE POLICY "super_admin_all_applications" ON applications
  FOR ALL
  USING (auth.user_role() = 'super_admin');

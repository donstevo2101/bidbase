-- =============================================================
-- RLS policies: documents
-- =============================================================

-- Org members can read documents in their org
CREATE POLICY "org_read_documents" ON documents
  FOR SELECT
  USING (organisation_id = auth.org_id());

-- Org admins and members can upload documents
CREATE POLICY "org_create_documents" ON documents
  FOR INSERT
  WITH CHECK (
    organisation_id = auth.org_id()
    AND auth.user_role() IN ('org_admin', 'org_member')
  );

-- Org admins and members can update document metadata
CREATE POLICY "org_update_documents" ON documents
  FOR UPDATE
  USING (
    organisation_id = auth.org_id()
    AND auth.user_role() IN ('org_admin', 'org_member')
  )
  WITH CHECK (organisation_id = auth.org_id());

-- Only org admins can delete documents
CREATE POLICY "org_admin_delete_documents" ON documents
  FOR DELETE
  USING (
    organisation_id = auth.org_id()
    AND auth.user_role() = 'org_admin'
  );

-- Client admins can upload documents for their client
CREATE POLICY "client_admin_create_documents" ON documents
  FOR INSERT
  WITH CHECK (
    auth.user_role() = 'client_admin'
    AND organisation_id = auth.org_id()
  );

-- Client users can read their client's documents
CREATE POLICY "client_read_documents" ON documents
  FOR SELECT
  USING (
    auth.user_role() IN ('client_admin', 'client_member')
    AND organisation_id = auth.org_id()
  );

-- Super admins see all
CREATE POLICY "super_admin_all_documents" ON documents
  FOR ALL
  USING (auth.user_role() = 'super_admin');

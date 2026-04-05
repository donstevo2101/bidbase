-- =============================================
-- Run this in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run)
-- =============================================

-- 1. Auth helper functions (need auth schema access)
CREATE OR REPLACE FUNCTION auth.org_id() RETURNS uuid AS $$
  SELECT (auth.jwt() ->> 'org_id')::uuid;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth.user_role() RETURNS text AS $$
  SELECT auth.jwt() ->> 'user_role';
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 2. Custom JWT claims hook
CREATE OR REPLACE FUNCTION auth.custom_access_token_hook(event jsonb)
RETURNS jsonb AS $$
DECLARE
  claims jsonb;
  user_org_id uuid;
  user_role text;
BEGIN
  SELECT p.organisation_id, p.role INTO user_org_id, user_role
  FROM public.profiles p WHERE p.id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';

  IF user_org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{org_id}', to_jsonb(user_org_id::text));
  END IF;
  IF user_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
  END IF;

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION auth.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION auth.custom_access_token_hook FROM public;
REVOKE EXECUTE ON FUNCTION auth.custom_access_token_hook FROM anon;
REVOKE EXECUTE ON FUNCTION auth.custom_access_token_hook FROM authenticated;

-- 3. RLS policies: organisations
CREATE POLICY "super_admin_all_orgs" ON organisations FOR ALL
  USING (auth.user_role() = 'super_admin');
CREATE POLICY "org_members_read_own_org" ON organisations FOR SELECT
  USING (id = auth.org_id());
CREATE POLICY "org_admin_update_own_org" ON organisations FOR UPDATE
  USING (id = auth.org_id() AND auth.user_role() = 'org_admin')
  WITH CHECK (id = auth.org_id() AND auth.user_role() = 'org_admin');
CREATE POLICY "allow_org_creation" ON organisations FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- 4. RLS policies: profiles
CREATE POLICY "users_read_own_profile" ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "org_members_read_org_profiles" ON profiles FOR SELECT USING (organisation_id = auth.org_id());
CREATE POLICY "users_update_own_profile" ON profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "org_admin_update_org_profiles" ON profiles FOR UPDATE
  USING (organisation_id = auth.org_id() AND auth.user_role() = 'org_admin')
  WITH CHECK (organisation_id = auth.org_id() AND auth.user_role() = 'org_admin');
CREATE POLICY "super_admin_all_profiles" ON profiles FOR ALL USING (auth.user_role() = 'super_admin');

-- 5. RLS policies: clients
CREATE POLICY "org_read_clients" ON clients FOR SELECT USING (organisation_id = auth.org_id());
CREATE POLICY "org_create_clients" ON clients FOR INSERT
  WITH CHECK (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'));
CREATE POLICY "org_update_clients" ON clients FOR UPDATE
  USING (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'))
  WITH CHECK (organisation_id = auth.org_id());
CREATE POLICY "org_admin_delete_clients" ON clients FOR DELETE
  USING (organisation_id = auth.org_id() AND auth.user_role() = 'org_admin');
CREATE POLICY "client_users_read_own" ON clients FOR SELECT
  USING (auth.user_role() IN ('client_admin', 'client_member') AND organisation_id = auth.org_id());
CREATE POLICY "super_admin_all_clients" ON clients FOR ALL USING (auth.user_role() = 'super_admin');

-- 6. RLS policies: applications
CREATE POLICY "org_read_applications" ON applications FOR SELECT USING (organisation_id = auth.org_id());
CREATE POLICY "org_create_applications" ON applications FOR INSERT
  WITH CHECK (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'));
CREATE POLICY "org_update_applications" ON applications FOR UPDATE
  USING (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'))
  WITH CHECK (organisation_id = auth.org_id());
CREATE POLICY "org_admin_delete_applications" ON applications FOR DELETE
  USING (organisation_id = auth.org_id() AND auth.user_role() = 'org_admin');
CREATE POLICY "client_read_applications" ON applications FOR SELECT
  USING (auth.user_role() IN ('client_admin', 'client_member') AND organisation_id = auth.org_id());
CREATE POLICY "super_admin_all_applications" ON applications FOR ALL USING (auth.user_role() = 'super_admin');

-- 7. RLS policies: documents
CREATE POLICY "org_read_documents" ON documents FOR SELECT USING (organisation_id = auth.org_id());
CREATE POLICY "org_create_documents" ON documents FOR INSERT
  WITH CHECK (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'));
CREATE POLICY "org_update_documents" ON documents FOR UPDATE
  USING (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'))
  WITH CHECK (organisation_id = auth.org_id());
CREATE POLICY "org_admin_delete_documents" ON documents FOR DELETE
  USING (organisation_id = auth.org_id() AND auth.user_role() = 'org_admin');
CREATE POLICY "client_admin_create_documents" ON documents FOR INSERT
  WITH CHECK (auth.user_role() = 'client_admin' AND organisation_id = auth.org_id());
CREATE POLICY "client_read_documents" ON documents FOR SELECT
  USING (auth.user_role() IN ('client_admin', 'client_member') AND organisation_id = auth.org_id());
CREATE POLICY "super_admin_all_documents" ON documents FOR ALL USING (auth.user_role() = 'super_admin');

-- 8. RLS policies: funders
CREATE POLICY "org_read_funders" ON funders FOR SELECT USING (organisation_id = auth.org_id() OR organisation_id IS NULL);
CREATE POLICY "org_create_funders" ON funders FOR INSERT
  WITH CHECK (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'));
CREATE POLICY "org_update_funders" ON funders FOR UPDATE
  USING (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'))
  WITH CHECK (organisation_id = auth.org_id());
CREATE POLICY "super_admin_all_funders" ON funders FOR ALL USING (auth.user_role() = 'super_admin');

-- 9. RLS policies: agent_conversations
CREATE POLICY "org_read_conversations" ON agent_conversations FOR SELECT USING (organisation_id = auth.org_id());
CREATE POLICY "org_create_conversations" ON agent_conversations FOR INSERT
  WITH CHECK (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'));
CREATE POLICY "org_update_conversations" ON agent_conversations FOR UPDATE
  USING (organisation_id = auth.org_id()) WITH CHECK (organisation_id = auth.org_id());
CREATE POLICY "super_admin_all_conversations" ON agent_conversations FOR ALL USING (auth.user_role() = 'super_admin');

-- 10. RLS policies: agent_tasks
CREATE POLICY "org_read_tasks" ON agent_tasks FOR SELECT USING (organisation_id = auth.org_id());
CREATE POLICY "org_manage_tasks" ON agent_tasks FOR ALL
  USING (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'));
CREATE POLICY "super_admin_all_tasks" ON agent_tasks FOR ALL USING (auth.user_role() = 'super_admin');

-- 11. RLS policies: activity_log
CREATE POLICY "org_read_activity_log" ON activity_log FOR SELECT USING (organisation_id = auth.org_id());
CREATE POLICY "org_insert_activity_log" ON activity_log FOR INSERT WITH CHECK (organisation_id = auth.org_id());
CREATE POLICY "super_admin_all_activity_log" ON activity_log FOR ALL USING (auth.user_role() = 'super_admin');

-- 12. RLS policies: invoices
CREATE POLICY "org_read_invoices" ON invoices FOR SELECT USING (organisation_id = auth.org_id());
CREATE POLICY "org_manage_invoices" ON invoices FOR ALL
  USING (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'));
CREATE POLICY "super_admin_all_invoices" ON invoices FOR ALL USING (auth.user_role() = 'super_admin');

-- 13. RLS policies: success_fee_windows
CREATE POLICY "org_read_success_fees" ON success_fee_windows FOR SELECT USING (organisation_id = auth.org_id());
CREATE POLICY "org_manage_success_fees" ON success_fee_windows FOR ALL
  USING (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'));
CREATE POLICY "super_admin_all_success_fees" ON success_fee_windows FOR ALL USING (auth.user_role() = 'super_admin');

-- 14. RLS policies: plans (read-only for all)
CREATE POLICY "anyone_read_plans" ON plans FOR SELECT USING (true);
CREATE POLICY "super_admin_manage_plans" ON plans FOR ALL USING (auth.user_role() = 'super_admin');

-- 15. RLS policies: plan_usage
CREATE POLICY "org_read_own_usage" ON plan_usage FOR SELECT USING (organisation_id = auth.org_id());
CREATE POLICY "org_update_own_usage" ON plan_usage FOR UPDATE
  USING (organisation_id = auth.org_id()) WITH CHECK (organisation_id = auth.org_id());
CREATE POLICY "super_admin_all_usage" ON plan_usage FOR ALL USING (auth.user_role() = 'super_admin');

-- 16. Storage RLS policies
CREATE POLICY "org_upload_client_docs" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'client-documents' AND (storage.foldername(name))[1] = auth.org_id()::text AND auth.user_role() IN ('org_admin', 'org_member', 'client_admin'));
CREATE POLICY "org_read_client_docs" ON storage.objects FOR SELECT
  USING (bucket_id = 'client-documents' AND (storage.foldername(name))[1] = auth.org_id()::text);
CREATE POLICY "org_delete_client_docs" ON storage.objects FOR DELETE
  USING (bucket_id = 'client-documents' AND (storage.foldername(name))[1] = auth.org_id()::text AND auth.user_role() = 'org_admin');
CREATE POLICY "org_upload_drafts" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'application-drafts' AND (storage.foldername(name))[1] = auth.org_id()::text AND auth.user_role() IN ('org_admin', 'org_member'));
CREATE POLICY "org_read_drafts" ON storage.objects FOR SELECT
  USING (bucket_id = 'application-drafts' AND (storage.foldername(name))[1] = auth.org_id()::text);
CREATE POLICY "org_delete_drafts" ON storage.objects FOR DELETE
  USING (bucket_id = 'application-drafts' AND (storage.foldername(name))[1] = auth.org_id()::text AND auth.user_role() IN ('org_admin', 'org_member'));
CREATE POLICY "org_upload_assets" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'org-assets' AND (storage.foldername(name))[1] = auth.org_id()::text AND auth.user_role() = 'org_admin');
CREATE POLICY "org_read_assets" ON storage.objects FOR SELECT
  USING (bucket_id = 'org-assets' AND (storage.foldername(name))[1] = auth.org_id()::text);
CREATE POLICY "org_delete_assets" ON storage.objects FOR DELETE
  USING (bucket_id = 'org-assets' AND (storage.foldername(name))[1] = auth.org_id()::text AND auth.user_role() = 'org_admin');

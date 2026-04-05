-- =============================================================
-- RLS policies: funders
-- =============================================================

-- Org members can read funders (their org's + platform-wide where org_id IS NULL)
CREATE POLICY "org_read_funders" ON funders
  FOR SELECT
  USING (
    organisation_id = auth.org_id()
    OR organisation_id IS NULL
  );

-- Org admins and members can create org-specific funders
CREATE POLICY "org_create_funders" ON funders
  FOR INSERT
  WITH CHECK (
    organisation_id = auth.org_id()
    AND auth.user_role() IN ('org_admin', 'org_member')
  );

-- Org admins can update their org's funders
CREATE POLICY "org_update_funders" ON funders
  FOR UPDATE
  USING (
    organisation_id = auth.org_id()
    AND auth.user_role() IN ('org_admin', 'org_member')
  )
  WITH CHECK (organisation_id = auth.org_id());

-- Super admins manage all funders (including platform-wide)
CREATE POLICY "super_admin_all_funders" ON funders
  FOR ALL
  USING (auth.user_role() = 'super_admin');

-- =============================================================
-- RLS policies: agent_conversations
-- =============================================================

CREATE POLICY "org_read_conversations" ON agent_conversations
  FOR SELECT
  USING (organisation_id = auth.org_id());

CREATE POLICY "org_create_conversations" ON agent_conversations
  FOR INSERT
  WITH CHECK (
    organisation_id = auth.org_id()
    AND auth.user_role() IN ('org_admin', 'org_member')
  );

CREATE POLICY "org_update_conversations" ON agent_conversations
  FOR UPDATE
  USING (organisation_id = auth.org_id())
  WITH CHECK (organisation_id = auth.org_id());

CREATE POLICY "super_admin_all_conversations" ON agent_conversations
  FOR ALL
  USING (auth.user_role() = 'super_admin');

-- =============================================================
-- RLS policies: agent_tasks
-- =============================================================

CREATE POLICY "org_read_tasks" ON agent_tasks
  FOR SELECT
  USING (organisation_id = auth.org_id());

CREATE POLICY "org_manage_tasks" ON agent_tasks
  FOR ALL
  USING (
    organisation_id = auth.org_id()
    AND auth.user_role() IN ('org_admin', 'org_member')
  );

CREATE POLICY "super_admin_all_tasks" ON agent_tasks
  FOR ALL
  USING (auth.user_role() = 'super_admin');

-- =============================================================
-- RLS policies: activity_log
-- =============================================================

-- Org members can read their activity log
CREATE POLICY "org_read_activity_log" ON activity_log
  FOR SELECT
  USING (organisation_id = auth.org_id());

-- Insert allowed for org members and system (service role)
CREATE POLICY "org_insert_activity_log" ON activity_log
  FOR INSERT
  WITH CHECK (organisation_id = auth.org_id());

-- Super admins see all
CREATE POLICY "super_admin_all_activity_log" ON activity_log
  FOR ALL
  USING (auth.user_role() = 'super_admin');

-- =============================================================
-- RLS policies: invoices
-- =============================================================

CREATE POLICY "org_read_invoices" ON invoices
  FOR SELECT
  USING (organisation_id = auth.org_id());

CREATE POLICY "org_manage_invoices" ON invoices
  FOR ALL
  USING (
    organisation_id = auth.org_id()
    AND auth.user_role() IN ('org_admin', 'org_member')
  );

CREATE POLICY "super_admin_all_invoices" ON invoices
  FOR ALL
  USING (auth.user_role() = 'super_admin');

-- =============================================================
-- RLS policies: success_fee_windows
-- =============================================================

CREATE POLICY "org_read_success_fees" ON success_fee_windows
  FOR SELECT
  USING (organisation_id = auth.org_id());

CREATE POLICY "org_manage_success_fees" ON success_fee_windows
  FOR ALL
  USING (
    organisation_id = auth.org_id()
    AND auth.user_role() IN ('org_admin', 'org_member')
  );

CREATE POLICY "super_admin_all_success_fees" ON success_fee_windows
  FOR ALL
  USING (auth.user_role() = 'super_admin');

-- =============================================================
-- RLS policies: plans (read-only for all authenticated users)
-- =============================================================

CREATE POLICY "anyone_read_plans" ON plans
  FOR SELECT
  USING (true);

-- Only super admins can modify plans
CREATE POLICY "super_admin_manage_plans" ON plans
  FOR ALL
  USING (auth.user_role() = 'super_admin');

-- =============================================================
-- RLS policies: plan_usage
-- =============================================================

CREATE POLICY "org_read_own_usage" ON plan_usage
  FOR SELECT
  USING (organisation_id = auth.org_id());

-- Usage updated by service role (server-side), but policy needed
CREATE POLICY "org_update_own_usage" ON plan_usage
  FOR UPDATE
  USING (organisation_id = auth.org_id())
  WITH CHECK (organisation_id = auth.org_id());

CREATE POLICY "super_admin_all_usage" ON plan_usage
  FOR ALL
  USING (auth.user_role() = 'super_admin');

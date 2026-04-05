-- =============================================================
-- RLS policies: profiles
-- =============================================================

-- Users can read their own profile
CREATE POLICY "users_read_own_profile" ON profiles
  FOR SELECT
  USING (id = auth.uid());

-- Users can read profiles in their org (for team views)
CREATE POLICY "org_members_read_org_profiles" ON profiles
  FOR SELECT
  USING (organisation_id = auth.org_id());

-- Users can update their own profile
CREATE POLICY "users_update_own_profile" ON profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Org admins can update profiles in their org (role changes, assignments)
CREATE POLICY "org_admin_update_org_profiles" ON profiles
  FOR UPDATE
  USING (
    organisation_id = auth.org_id()
    AND auth.user_role() = 'org_admin'
  )
  WITH CHECK (
    organisation_id = auth.org_id()
    AND auth.user_role() = 'org_admin'
  );

-- Super admins can see and manage all profiles
CREATE POLICY "super_admin_all_profiles" ON profiles
  FOR ALL
  USING (auth.user_role() = 'super_admin');

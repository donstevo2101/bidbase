-- User profiles (extends Supabase auth.users)
CREATE TABLE profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  organisation_id uuid REFERENCES organisations ON DELETE SET NULL,
  role            text NOT NULL
                  CHECK (role IN ('super_admin', 'org_admin', 'org_member', 'client_admin', 'client_member')),
  full_name       text,
  avatar_url      text,
  preferences     jsonb DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_profiles_organisation_id ON profiles (organisation_id);
CREATE INDEX idx_profiles_role ON profiles (role);

-- Trigger: auto-create profile on auth.users insert
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, role)
  VALUES (NEW.id, 'org_admin');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

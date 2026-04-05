CREATE TABLE enterprise_enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  company text NOT NULL,
  phone text,
  expected_clients integer,
  message text,
  status text DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'closed')),
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE enterprise_enquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_enquiries" ON enterprise_enquiries FOR ALL USING (public.get_user_role() = 'super_admin');

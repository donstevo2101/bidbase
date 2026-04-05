import pg from 'pg';

const client = new pg.Client({
  host: 'db.fdkugdcnrpoggtqgoghq.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Farahabdallah@2026',
  ssl: { rejectUnauthorized: false },
});

const steps = [
  {
    name: 'Enable pg_trgm extension',
    sql: `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
  },
  {
    name: 'Create funders table',
    sql: `
      CREATE TABLE IF NOT EXISTS funders (
        id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organisation_id             uuid REFERENCES organisations ON DELETE CASCADE,
        name                        text NOT NULL,
        website                     text,
        grant_range_min             numeric,
        grant_range_max             numeric,
        eligible_structures         text[],
        eligible_geographies        text[],
        open_rounds                 jsonb DEFAULT '[]',
        notes                       text,
        requires_preregistration    boolean DEFAULT false,
        preregistration_lead_weeks  integer,
        rejection_gap_months        integer,
        verified                    boolean DEFAULT false,
        last_updated                timestamptz DEFAULT now(),
        created_at                  timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_funders_organisation_id ON funders (organisation_id);
      CREATE INDEX IF NOT EXISTS idx_funders_name ON funders USING gin (name gin_trgm_ops);
    `
  },
  {
    name: 'Create applications table',
    sql: `
      CREATE TABLE IF NOT EXISTS applications (
        id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organisation_id       uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
        client_id             uuid NOT NULL REFERENCES clients ON DELETE CASCADE,
        funder_name           text NOT NULL,
        funder_id             uuid REFERENCES funders,
        project_name          text,
        project_description   text,
        amount_requested      numeric,
        deadline              timestamptz,
        status                text DEFAULT 'researching'
                              CHECK (status IN (
                                'researching', 'gate1_pending', 'gate1_failed',
                                'gate2_pending', 'gate2_high_risk',
                                'drafting', 'gate3_pending', 'draft_ready',
                                'awaiting_approval', 'submitted',
                                'successful', 'unsuccessful', 'withdrawn'
                              )),
        gate1_passed          boolean,
        gate1_report          jsonb,
        gate1_checked_at      timestamptz,
        gate2_passed          boolean,
        gate2_report          jsonb,
        gate2_risk_level      text CHECK (gate2_risk_level IN ('pass', 'high_risk')),
        gate2_checked_at      timestamptz,
        gate3_passed          boolean,
        gate3_report          jsonb,
        gate3_checked_at      timestamptz,
        draft_content         jsonb,
        budget_reconciliation jsonb,
        operator_approval     boolean DEFAULT false,
        operator_approved_by  uuid REFERENCES profiles,
        operator_approved_at  timestamptz,
        submitted_at          timestamptz,
        outcome               text CHECK (outcome IN ('successful', 'unsuccessful', 'pending')),
        outcome_amount        numeric,
        outcome_date          date,
        outcome_notes         text,
        created_at            timestamptz DEFAULT now(),
        updated_at            timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_applications_organisation_id ON applications (organisation_id);
      CREATE INDEX IF NOT EXISTS idx_applications_client_id ON applications (client_id);
      CREATE INDEX IF NOT EXISTS idx_applications_status ON applications (organisation_id, status);
      CREATE INDEX IF NOT EXISTS idx_applications_deadline ON applications (deadline) WHERE deadline IS NOT NULL;
      CREATE TRIGGER applications_updated_at
        BEFORE UPDATE ON applications
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    `
  },
  {
    name: 'Create documents table',
    sql: `
      CREATE TABLE IF NOT EXISTS documents (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organisation_id   uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
        client_id         uuid NOT NULL REFERENCES clients ON DELETE CASCADE,
        application_id    uuid REFERENCES applications ON DELETE SET NULL,
        name              text NOT NULL,
        type              text NOT NULL CHECK (type IN (
          'governance', 'financial', 'policy', 'evidence',
          'questionnaire', 'transcript', 'correspondence',
          'draft', 'impact_data', 'other'
        )),
        storage_path      text NOT NULL,
        storage_bucket    text NOT NULL,
        file_size         integer,
        mime_type         text,
        uploaded_by       uuid REFERENCES profiles,
        processing_status text DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processed', 'failed')),
        extracted_text    text,
        notes             text,
        created_at        timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_documents_organisation_id ON documents (organisation_id);
      CREATE INDEX IF NOT EXISTS idx_documents_client_id ON documents (client_id);
      CREATE INDEX IF NOT EXISTS idx_documents_application_id ON documents (application_id);
      CREATE INDEX IF NOT EXISTS idx_documents_type ON documents (organisation_id, type);
    `
  },
  {
    name: 'Create agent tables',
    sql: `
      CREATE TABLE IF NOT EXISTS agent_conversations (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organisation_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
        client_id       uuid REFERENCES clients ON DELETE SET NULL,
        application_id  uuid REFERENCES applications ON DELETE SET NULL,
        agent_type      text NOT NULL CHECK (agent_type IN (
          'head_coach', 'va', 'eligibility', 'grant_writer',
          'ops_manager', 'social_media', 'social_value',
          'funder_intelligence', 'impact_measurement'
        )),
        messages        jsonb NOT NULL DEFAULT '[]',
        context_pack    jsonb DEFAULT '{}',
        status          text DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        created_by      uuid REFERENCES profiles,
        created_at      timestamptz DEFAULT now(),
        updated_at      timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_agent_conversations_org ON agent_conversations (organisation_id);
      CREATE INDEX IF NOT EXISTS idx_agent_conversations_client ON agent_conversations (client_id);
      CREATE TRIGGER agent_conversations_updated_at
        BEFORE UPDATE ON agent_conversations
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();

      CREATE TABLE IF NOT EXISTS agent_tasks (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organisation_id   uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
        conversation_id   uuid REFERENCES agent_conversations ON DELETE SET NULL,
        client_id         uuid REFERENCES clients ON DELETE SET NULL,
        application_id    uuid REFERENCES applications ON DELETE SET NULL,
        assigned_to       text NOT NULL CHECK (assigned_to IN (
          'head_coach', 'va', 'eligibility', 'grant_writer',
          'ops_manager', 'social_media', 'social_value',
          'funder_intelligence', 'impact_measurement'
        )),
        task_type         text NOT NULL CHECK (task_type IN (
          'gate1_check', 'gate2_check', 'gate3_check', 'funder_shortlist',
          'draft_application', 'monday_summary', 'create_content',
          'onboarding_sequence', 'social_value_report', 'impact_report',
          'funder_intelligence_update'
        )),
        status            text DEFAULT 'pending' CHECK (status IN (
          'pending', 'in_progress', 'complete', 'failed', 'escalated', 'awaiting_approval'
        )),
        brief             jsonb,
        output            jsonb,
        escalated_to      text CHECK (escalated_to IN ('operator', 'head_coach')),
        escalation_reason text,
        created_at        timestamptz DEFAULT now(),
        started_at        timestamptz,
        completed_at      timestamptz
      );
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_org ON agent_tasks (organisation_id);
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks (organisation_id, status);
    `
  },
  {
    name: 'Create activity_log table',
    sql: `
      CREATE TABLE IF NOT EXISTS activity_log (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organisation_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
        client_id       uuid REFERENCES clients ON DELETE SET NULL,
        application_id  uuid REFERENCES applications ON DELETE SET NULL,
        document_id     uuid REFERENCES documents ON DELETE SET NULL,
        actor_id        uuid REFERENCES profiles ON DELETE SET NULL,
        actor_type      text DEFAULT 'user' CHECK (actor_type IN ('user', 'agent', 'system')),
        action          text NOT NULL,
        details         jsonb,
        ip_address      inet,
        created_at      timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_activity_log_org ON activity_log (organisation_id);
      CREATE INDEX IF NOT EXISTS idx_activity_log_client ON activity_log (client_id);
      CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log (organisation_id, created_at DESC);
    `
  },
  {
    name: 'Create invoices and success_fee_windows tables',
    sql: `
      CREATE TABLE IF NOT EXISTS invoices (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organisation_id uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
        client_id       uuid NOT NULL REFERENCES clients ON DELETE CASCADE,
        amount          numeric NOT NULL,
        currency        text DEFAULT 'GBP',
        status          text DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'paid', 'overdue', 'cancelled')),
        due_date        date,
        sent_at         timestamptz,
        paid_at         timestamptz,
        invoice_type    text CHECK (invoice_type IN ('onboarding', 'monthly', 'success_fee', 'ad_hoc')),
        reference       text,
        notes           text,
        created_at      timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices (organisation_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices (client_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (organisation_id, status);

      CREATE TABLE IF NOT EXISTS success_fee_windows (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organisation_id   uuid NOT NULL REFERENCES organisations ON DELETE CASCADE,
        client_id         uuid NOT NULL REFERENCES clients ON DELETE CASCADE,
        application_id    uuid NOT NULL REFERENCES applications ON DELETE CASCADE,
        offboarded_at     timestamptz NOT NULL,
        window_expires_at timestamptz NOT NULL,
        outcome           text DEFAULT 'pending' CHECK (outcome IN ('pending', 'awarded', 'expired')),
        award_amount      numeric,
        invoice_id        uuid REFERENCES invoices,
        alerted           boolean DEFAULT false,
        created_at        timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_success_fee_windows_org ON success_fee_windows (organisation_id);
      CREATE INDEX IF NOT EXISTS idx_success_fee_windows_expiry ON success_fee_windows (window_expires_at) WHERE outcome = 'pending';
    `
  },
  {
    name: 'Enable RLS on all tables',
    sql: `
      ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
      ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
      ALTER TABLE funders ENABLE ROW LEVEL SECURITY;
      ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
      ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
      ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;
      ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
      ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
      ALTER TABLE success_fee_windows ENABLE ROW LEVEL SECURITY;
      ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
      ALTER TABLE plan_usage ENABLE ROW LEVEL SECURITY;
    `
  },
  {
    name: 'Create auth helper functions',
    sql: `
      CREATE OR REPLACE FUNCTION auth.org_id() RETURNS uuid AS $$
        SELECT (auth.jwt() ->> 'org_id')::uuid;
      $$ LANGUAGE sql STABLE SECURITY DEFINER;

      CREATE OR REPLACE FUNCTION auth.user_role() RETURNS text AS $$
        SELECT auth.jwt() ->> 'user_role';
      $$ LANGUAGE sql STABLE SECURITY DEFINER;
    `
  },
  {
    name: 'RLS policies: organisations',
    sql: `
      CREATE POLICY "super_admin_all_orgs" ON organisations FOR ALL
        USING (auth.user_role() = 'super_admin');
      CREATE POLICY "org_members_read_own_org" ON organisations FOR SELECT
        USING (id = auth.org_id());
      CREATE POLICY "org_admin_update_own_org" ON organisations FOR UPDATE
        USING (id = auth.org_id() AND auth.user_role() = 'org_admin')
        WITH CHECK (id = auth.org_id() AND auth.user_role() = 'org_admin');
      CREATE POLICY "allow_org_creation" ON organisations FOR INSERT
        WITH CHECK (owner_id = auth.uid());
    `
  },
  {
    name: 'RLS policies: profiles',
    sql: `
      CREATE POLICY "users_read_own_profile" ON profiles FOR SELECT USING (id = auth.uid());
      CREATE POLICY "org_members_read_org_profiles" ON profiles FOR SELECT USING (organisation_id = auth.org_id());
      CREATE POLICY "users_update_own_profile" ON profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
      CREATE POLICY "org_admin_update_org_profiles" ON profiles FOR UPDATE
        USING (organisation_id = auth.org_id() AND auth.user_role() = 'org_admin')
        WITH CHECK (organisation_id = auth.org_id() AND auth.user_role() = 'org_admin');
      CREATE POLICY "super_admin_all_profiles" ON profiles FOR ALL USING (auth.user_role() = 'super_admin');
    `
  },
  {
    name: 'RLS policies: clients',
    sql: `
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
    `
  },
  {
    name: 'RLS policies: applications',
    sql: `
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
    `
  },
  {
    name: 'RLS policies: documents',
    sql: `
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
    `
  },
  {
    name: 'RLS policies: remaining tables',
    sql: `
      -- funders
      CREATE POLICY "org_read_funders" ON funders FOR SELECT USING (organisation_id = auth.org_id() OR organisation_id IS NULL);
      CREATE POLICY "org_create_funders" ON funders FOR INSERT
        WITH CHECK (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'));
      CREATE POLICY "org_update_funders" ON funders FOR UPDATE
        USING (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'))
        WITH CHECK (organisation_id = auth.org_id());
      CREATE POLICY "super_admin_all_funders" ON funders FOR ALL USING (auth.user_role() = 'super_admin');

      -- agent_conversations
      CREATE POLICY "org_read_conversations" ON agent_conversations FOR SELECT USING (organisation_id = auth.org_id());
      CREATE POLICY "org_create_conversations" ON agent_conversations FOR INSERT
        WITH CHECK (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'));
      CREATE POLICY "org_update_conversations" ON agent_conversations FOR UPDATE
        USING (organisation_id = auth.org_id()) WITH CHECK (organisation_id = auth.org_id());
      CREATE POLICY "super_admin_all_conversations" ON agent_conversations FOR ALL USING (auth.user_role() = 'super_admin');

      -- agent_tasks
      CREATE POLICY "org_read_tasks" ON agent_tasks FOR SELECT USING (organisation_id = auth.org_id());
      CREATE POLICY "org_manage_tasks" ON agent_tasks FOR ALL
        USING (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'));
      CREATE POLICY "super_admin_all_tasks" ON agent_tasks FOR ALL USING (auth.user_role() = 'super_admin');

      -- activity_log
      CREATE POLICY "org_read_activity_log" ON activity_log FOR SELECT USING (organisation_id = auth.org_id());
      CREATE POLICY "org_insert_activity_log" ON activity_log FOR INSERT WITH CHECK (organisation_id = auth.org_id());
      CREATE POLICY "super_admin_all_activity_log" ON activity_log FOR ALL USING (auth.user_role() = 'super_admin');

      -- invoices
      CREATE POLICY "org_read_invoices" ON invoices FOR SELECT USING (organisation_id = auth.org_id());
      CREATE POLICY "org_manage_invoices" ON invoices FOR ALL
        USING (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'));
      CREATE POLICY "super_admin_all_invoices" ON invoices FOR ALL USING (auth.user_role() = 'super_admin');

      -- success_fee_windows
      CREATE POLICY "org_read_success_fees" ON success_fee_windows FOR SELECT USING (organisation_id = auth.org_id());
      CREATE POLICY "org_manage_success_fees" ON success_fee_windows FOR ALL
        USING (organisation_id = auth.org_id() AND auth.user_role() IN ('org_admin', 'org_member'));
      CREATE POLICY "super_admin_all_success_fees" ON success_fee_windows FOR ALL USING (auth.user_role() = 'super_admin');

      -- plans (read-only for all)
      CREATE POLICY "anyone_read_plans" ON plans FOR SELECT USING (true);
      CREATE POLICY "super_admin_manage_plans" ON plans FOR ALL USING (auth.user_role() = 'super_admin');

      -- plan_usage
      CREATE POLICY "org_read_own_usage" ON plan_usage FOR SELECT USING (organisation_id = auth.org_id());
      CREATE POLICY "org_update_own_usage" ON plan_usage FOR UPDATE
        USING (organisation_id = auth.org_id()) WITH CHECK (organisation_id = auth.org_id());
      CREATE POLICY "super_admin_all_usage" ON plan_usage FOR ALL USING (auth.user_role() = 'super_admin');
    `
  },
  {
    name: 'Create storage buckets',
    sql: `
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES (
        'client-documents', 'client-documents', false, 52428800,
        ARRAY['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp','text/plain','text/csv']
      ) ON CONFLICT (id) DO NOTHING;

      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES (
        'application-drafts', 'application-drafts', false, 52428800,
        ARRAY['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/json','text/plain']
      ) ON CONFLICT (id) DO NOTHING;

      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES (
        'org-assets', 'org-assets', false, 10485760,
        ARRAY['image/jpeg','image/png','image/svg+xml','image/webp','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
      ) ON CONFLICT (id) DO NOTHING;
    `
  },
  {
    name: 'Storage RLS policies',
    sql: `
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
    `
  },
  {
    name: 'Custom JWT claims hook',
    sql: `
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
    `
  },
];

async function main() {
  await client.connect();
  console.log('Connected to Supabase database\n');

  for (const step of steps) {
    process.stdout.write(`${step.name}... `);
    try {
      await client.query(step.sql);
      console.log('OK');
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
  }

  await client.end();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});

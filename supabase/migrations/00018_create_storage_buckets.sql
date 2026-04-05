-- =============================================================
-- Storage buckets — ALL private, no public URLs anywhere
-- =============================================================

-- Client documents bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-documents',
  'client-documents',
  false,
  52428800, -- 50MB max file size
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/plain',
    'text/csv'
  ]
);

-- Application drafts bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'application-drafts',
  'application-drafts',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/json',
    'text/plain'
  ]
);

-- Org assets bucket (logos, templates)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-assets',
  'org-assets',
  false,
  10485760, -- 10MB max
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/svg+xml',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
);

-- =============================================================
-- Storage RLS policies
-- Path convention: {org_id}/{client_id}/...
-- =============================================================

-- client-documents: org members can upload/read within their org path
CREATE POLICY "org_upload_client_docs" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'client-documents'
    AND (storage.foldername(name))[1] = auth.org_id()::text
    AND auth.user_role() IN ('org_admin', 'org_member', 'client_admin')
  );

CREATE POLICY "org_read_client_docs" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'client-documents'
    AND (storage.foldername(name))[1] = auth.org_id()::text
  );

CREATE POLICY "org_delete_client_docs" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'client-documents'
    AND (storage.foldername(name))[1] = auth.org_id()::text
    AND auth.user_role() = 'org_admin'
  );

-- application-drafts: org members can manage within their org path
CREATE POLICY "org_upload_drafts" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'application-drafts'
    AND (storage.foldername(name))[1] = auth.org_id()::text
    AND auth.user_role() IN ('org_admin', 'org_member')
  );

CREATE POLICY "org_read_drafts" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'application-drafts'
    AND (storage.foldername(name))[1] = auth.org_id()::text
  );

CREATE POLICY "org_delete_drafts" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'application-drafts'
    AND (storage.foldername(name))[1] = auth.org_id()::text
    AND auth.user_role() IN ('org_admin', 'org_member')
  );

-- org-assets: org admins manage their org's assets
CREATE POLICY "org_upload_assets" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'org-assets'
    AND (storage.foldername(name))[1] = auth.org_id()::text
    AND auth.user_role() = 'org_admin'
  );

CREATE POLICY "org_read_assets" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'org-assets'
    AND (storage.foldername(name))[1] = auth.org_id()::text
  );

CREATE POLICY "org_delete_assets" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'org-assets'
    AND (storage.foldername(name))[1] = auth.org_id()::text
    AND auth.user_role() = 'org_admin'
  );

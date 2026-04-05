import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { supabase } from '../lib/supabase.js';
import { generateSignedUrl, generateUploadSignedUrl, deleteFile } from '../lib/storage.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const documentsRouter = Router();

// All routes require authentication
documentsRouter.use(authMiddleware);

// ---- Constants ----

const DOCUMENTS_BUCKET = process.env['STORAGE_BUCKET_DOCUMENTS'] ?? 'client-documents';

const ALLOWED_DOCUMENT_TYPES = [
  'governance',
  'financial',
  'policy',
  'evidence',
  'questionnaire',
  'transcript',
  'correspondence',
  'draft',
  'impact_data',
  'other',
] as const;

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'text/plain',
  'text/csv',
] as const;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// ---- Schemas ----

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  client_id: z.string().uuid().optional(),
  type: z.enum(ALLOWED_DOCUMENT_TYPES).optional(),
});

const uploadSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1).max(255),
  type: z.enum(ALLOWED_DOCUMENT_TYPES),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  fileSize: z.number().int().min(1).max(MAX_FILE_SIZE),
});

// ---- Helpers ----

function asyncHandler(fn: (req: Express.Request & import('express').Request, res: import('express').Response) => Promise<void>) {
  return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    fn(req, res).catch(next);
  };
}

// ---- Routes ----

// GET / — list documents, paginated, filterable by client_id and type
documentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(422).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters' },
      });
      return;
    }

    const { page, limit, client_id, type } = parsed.data;
    const offset = (page - 1) * limit;
    const orgId = req.user.org_id;

    // Build query
    let query = supabase
      .from('documents')
      .select('*', { count: 'exact' })
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (client_id) {
      query = query.eq('client_id', client_id);
    }
    if (type) {
      query = query.eq('type', type);
    }

    const { data, error, count } = await query;

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'QUERY_FAILED', message: 'Failed to fetch documents' },
      });
      return;
    }

    res.json({
      success: true,
      data,
      pagination: { page, limit, total: count ?? 0 },
    });
  })
);

// POST /upload — generate a signed upload URL and create document record
documentsRouter.post(
  '/upload',
  validate(uploadSchema),
  asyncHandler(async (req, res) => {
    const { clientId, name, type, mimeType, fileSize } = req.body;
    const orgId = req.user.org_id;

    // Verify the client belongs to this org
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .eq('organisation_id', orgId)
      .single();

    if (clientError || !client) {
      res.status(404).json({
        success: false,
        error: { code: 'CLIENT_NOT_FOUND', message: 'Client not found' },
      });
      return;
    }

    // Build storage path: {org_id}/{client_id}/{type}/{uuid}-{name}
    const fileId = randomUUID();
    const storagePath = `${orgId}/${clientId}/${type}/${fileId}-${name}`;

    // Generate signed upload URL
    const signedUrl = await generateUploadSignedUrl(DOCUMENTS_BUCKET, storagePath);

    // Create document record in DB with processing_status: 'pending'
    const { data: document, error: insertError } = await supabase
      .from('documents')
      .insert({
        organisation_id: orgId,
        client_id: clientId,
        name,
        type,
        storage_path: storagePath,
        storage_bucket: DOCUMENTS_BUCKET,
        file_size: fileSize,
        mime_type: mimeType,
        uploaded_by: req.user.id,
        processing_status: 'pending',
      })
      .select()
      .single();

    if (insertError) {
      res.status(500).json({
        success: false,
        error: { code: 'INSERT_FAILED', message: 'Failed to create document record' },
      });
      return;
    }

    // Log upload activity
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      client_id: clientId,
      document_id: document.id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'document_uploaded',
      details: { name, type, mimeType, fileSize },
      ip_address: req.ip,
    });

    res.status(201).json({
      success: true,
      data: {
        document,
        uploadUrl: signedUrl,
      },
    });
  })
);

// GET /:id — document metadata
documentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const orgId = req.user.org_id;

    const { data: document, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', id)
      .eq('organisation_id', orgId)
      .single();

    if (error || !document) {
      res.status(404).json({
        success: false,
        error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' },
      });
      return;
    }

    res.json({ success: true, data: document });
  })
);

// GET /:id/url — generate signed download URL (1hr expiry), log access
documentsRouter.get(
  '/:id/url',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const orgId = req.user.org_id;

    const { data: document, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', id)
      .eq('organisation_id', orgId)
      .single();

    if (error || !document) {
      res.status(404).json({
        success: false,
        error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' },
      });
      return;
    }

    // Generate signed download URL (1hr expiry — handled by storage helper)
    const signedUrl = await generateSignedUrl(document.storage_bucket, document.storage_path);

    // Log download to activity_log
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      client_id: document.client_id,
      document_id: document.id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'document_downloaded',
      details: { name: document.name, type: document.type },
      ip_address: req.ip,
    });

    res.json({
      success: true,
      data: { url: signedUrl },
    });
  })
);

// DELETE /:id — delete document. org_admin only. Removes from storage and DB.
documentsRouter.delete(
  '/:id',
  requireRole('org_admin', 'super_admin'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const orgId = req.user.org_id;

    const { data: document, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', id)
      .eq('organisation_id', orgId)
      .single();

    if (error || !document) {
      res.status(404).json({
        success: false,
        error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' },
      });
      return;
    }

    // Remove from storage
    await deleteFile(document.storage_bucket, [document.storage_path]);

    // Remove from DB
    const { error: deleteError } = await supabase
      .from('documents')
      .delete()
      .eq('id', id)
      .eq('organisation_id', orgId);

    if (deleteError) {
      res.status(500).json({
        success: false,
        error: { code: 'DELETE_FAILED', message: 'Failed to delete document record' },
      });
      return;
    }

    // Log deletion
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      client_id: document.client_id,
      document_id: document.id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'document_deleted',
      details: { name: document.name, type: document.type },
      ip_address: req.ip,
    });

    res.json({ success: true, data: { message: 'Document deleted' } });
  })
);

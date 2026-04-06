import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { anthropic, AGENT_MODEL } from '../lib/anthropic.js';
import { authMiddleware } from '../middleware/auth.js';
import { orgScopeMiddleware } from '../middleware/orgScope.js';
import { validate } from '../middleware/validate.js';
import { parseDocumentForClient, parseVoiceForClient } from '../agents/clientParser.js';
import type { ParsedClientData } from '../agents/clientParser.js';
import type { Request, Response, NextFunction } from 'express';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { enrichClientData } from '../agents/dataEnrichment.js';

export const clientParserRouter = Router();

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

// All routes require authentication and org scope
clientParserRouter.use(authMiddleware, orgScopeMiddleware);

// ---- Schemas ----

const parseDocumentSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  fileName: z.string().min(1, 'File name is required'),
  mimeType: z.string().min(1, 'MIME type is required'),
});

const parseVoiceSchema = z.object({
  transcript: z.string().min(1, 'Transcript is required'),
});

const confirmClientSchema = z.object({
  name: z.string().min(1, 'Client name is required').max(255),
  type: z.enum(['CIC', 'charity', 'social_enterprise', 'unincorporated', 'other']).optional(),
  primaryContactName: z.string().max(255).optional(),
  primaryContactEmail: z.string().email().optional().or(z.literal('')),
  primaryContactPhone: z.string().max(50).optional(),
  annualIncome: z.number().nonnegative().optional(),
  registeredNumber: z.string().max(50).optional(),
  address: z
    .object({
      line1: z.string().optional(),
      line2: z.string().optional(),
      city: z.string().optional(),
      county: z.string().optional(),
      postcode: z.string().optional(),
    })
    .optional(),
  policiesHeld: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

// ---- Routes ----

/**
 * POST /parse-document
 *
 * Accepts document content as base64 or plain text in JSON body.
 * Extracts client information using the Anthropic API.
 *
 * For PDF files: uses raw text content. A proper implementation would use
 * a PDF parser like pdf-parse to extract text from the binary. For now,
 * the caller should send pre-extracted text or plain text content.
 *
 * For images: sends to Anthropic vision API for text extraction.
 * For plain text/CSV: uses content directly.
 */
clientParserRouter.post(
  '/parse-document',
  validate(parseDocumentSchema),
  asyncHandler(async (req, res) => {
    const { content, fileName, mimeType } = req.body as z.infer<typeof parseDocumentSchema>;

    // Image files — use Anthropic vision to extract text
    if (mimeType.startsWith('image/')) {
      if (!anthropic) {
        res.status(503).json({
          success: false,
          error: { code: 'AI_UNAVAILABLE', message: 'Anthropic API key not configured' },
        });
        return;
      }

      const supportedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!supportedImageTypes.includes(mimeType)) {
        res.status(422).json({
          success: false,
          error: { code: 'UNSUPPORTED_FORMAT', message: `Unsupported image type: ${mimeType}` },
        });
        return;
      }

      // Send image to Anthropic vision for extraction + parsing in one call
      const visionResponse = await anthropic.messages.create({
        model: AGENT_MODEL,
        max_tokens: 2048,
        system: `You are a document parsing agent for BidBase, a UK grant bid writing platform.
Extract structured client information from this document image.

Look for: organisation name, type (CIC/charity/social_enterprise/unincorporated/other),
contact details (name, email, phone), registered number, annual income, address
(line1, line2, city, county, postcode), and policies held.

Return ONLY valid JSON (no markdown fences) matching:
{
  "name": "string",
  "type": "CIC" | "charity" | "social_enterprise" | "unincorporated" | "other",
  "primaryContactName": "string",
  "primaryContactEmail": "string",
  "primaryContactPhone": "string",
  "annualIncome": number,
  "registeredNumber": "string",
  "address": { "line1": "string", "line2": "string", "city": "string", "county": "string", "postcode": "string" },
  "policiesHeld": ["string"],
  "notes": "string",
  "confidence": { "fieldName": 0-100 }
}
Include a confidence score (0-100) for every field returned.`,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                  data: content,
                },
              },
              {
                type: 'text',
                text: `Extract client information from this document image (${fileName}).`,
              },
            ],
          },
        ],
      });

      const visionContent = visionResponse.content[0];
      if (visionContent.type !== 'text') {
        res.status(500).json({
          success: false,
          error: { code: 'PARSE_FAILED', message: 'Unexpected response format from vision API' },
        });
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        let cleaned = visionContent.text.trim();
        if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        parsed = JSON.parse(cleaned) as Record<string, unknown>;
      } catch {
        res.status(500).json({
          success: false,
          error: { code: 'PARSE_FAILED', message: 'Failed to parse AI response as JSON' },
        });
        return;
      }

      const data: ParsedClientData = {
        ...parsed,
        confidence: (parsed['confidence'] as Record<string, number>) ?? {},
        rawExtract: `[Image: ${fileName}]`,
      } as ParsedClientData;

      res.json({ success: true, data });
      return;
    }

    // Determine text content from the file
    let textContent = content;

    // PDF files — decode base64 and extract text with pdf-parse
    if (mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
      try {
        const pdfBuffer = Buffer.from(content, 'base64');
        const pdfData = await pdfParse(pdfBuffer);
        textContent = pdfData.text;
        if (!textContent.trim()) {
          res.status(422).json({
            success: false,
            error: { code: 'EMPTY_PDF', message: 'Could not extract text from this PDF. It may be an image-only PDF.' },
          });
          return;
        }
      } catch {
        res.status(422).json({
          success: false,
          error: { code: 'PDF_PARSE_FAILED', message: 'Failed to read this PDF file. Please try a text file or use voice input.' },
        });
        return;
      }
    }
    // Word docs — use mammoth to extract text from .docx / .doc
    else if (mimeType.includes('word') || fileName.toLowerCase().endsWith('.docx') || fileName.toLowerCase().endsWith('.doc')) {
      try {
        const docBuffer = Buffer.from(content, 'base64');
        const result = await mammoth.extractRawText({ buffer: docBuffer });
        textContent = result.value;
        if (!textContent.trim()) {
          res.status(422).json({
            success: false,
            error: { code: 'EMPTY_DOC', message: 'Could not extract text from this Word document. The file may be empty or corrupted.' },
          });
          return;
        }
      } catch (docErr) {
        console.error('[ClientParser] Word doc parse error:', docErr);
        res.status(422).json({
          success: false,
          error: { code: 'DOC_PARSE_FAILED', message: 'Failed to read this Word file. Please try a .docx, PDF, or text file instead.' },
        });
        return;
      }
    }
    // Base64-encoded content (non-text files sent as base64)
    else if (/^[A-Za-z0-9+/=]+$/.test(content) && content.length > 200 && !content.includes(' ')) {
      try {
        textContent = Buffer.from(content, 'base64').toString('utf-8');
      } catch {
        // Not valid base64 — use as-is
      }
    }
    // Plain text — use directly

    if (!textContent.trim()) {
      res.status(422).json({
        success: false,
        error: { code: 'EMPTY_CONTENT', message: 'No text could be extracted from this file.' },
      });
      return;
    }

    try {
      const data = await parseDocumentForClient(textContent);
      res.json({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse document';
      const code = message.includes('not configured') ? 'AI_UNAVAILABLE' : 'PARSE_FAILED';
      const status = code === 'AI_UNAVAILABLE' ? 503 : 500;
      res.status(status).json({
        success: false,
        error: { code, message },
      });
    }
  })
);

/**
 * POST /parse-voice
 *
 * Accepts a voice transcript and extracts client information.
 */
clientParserRouter.post(
  '/parse-voice',
  validate(parseVoiceSchema),
  asyncHandler(async (req, res) => {
    const { transcript } = req.body as z.infer<typeof parseVoiceSchema>;

    try {
      const data = await parseVoiceForClient(transcript);
      res.json({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse voice transcript';
      const code = message.includes('not configured') ? 'AI_UNAVAILABLE' : 'PARSE_FAILED';
      const status = code === 'AI_UNAVAILABLE' ? 503 : 500;
      res.status(status).json({
        success: false,
        error: { code, message },
      });
    }
  })
);

/**
 * POST /confirm
 *
 * Accepts the confirmed/edited parsed client data and creates the client
 * in Supabase. Mirrors the existing POST /api/clients logic.
 */
clientParserRouter.post(
  '/confirm',
  validate(confirmClientSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof confirmClientSchema>;

    const { data, error } = await supabase
      .from('clients')
      .insert({
        organisation_id: req.user.org_id,
        name: body.name,
        type: body.type ?? null,
        stage: 'A',
        status: 'lead',
        primary_contact_name: body.primaryContactName ?? null,
        primary_contact_email: body.primaryContactEmail || null,
        primary_contact_phone: body.primaryContactPhone ?? null,
        annual_income: body.annualIncome ?? null,
        registered_number: body.registeredNumber ?? null,
        address: body.address ?? null,
        policies_held: body.policiesHeld ?? null,
        existing_grants: [],
        notes: body.notes ?? null,
        assigned_to: null,
        portal_enabled: false,
      })
      .select()
      .single();

    if (error || !data) {
      console.error('[ClientParser] Client creation failed:', error?.message, error?.details, error?.hint);
      res.status(500).json({
        success: false,
        error: { code: 'CREATE_FAILED', message: error?.message ?? 'Failed to create client' },
      });
      return;
    }

    // Update plan usage counter (non-critical — skip if fails)
    try {
      await supabase
        .from('plan_usage')
        .update({ active_clients: supabase.rpc ? 0 : 0 })
        .eq('organisation_id', req.user.org_id);
    } catch {
      // Non-critical
    }

    // Log activity
    const orgId = req.user.org_id;
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      client_id: data.id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'client_created',
      details: { name: body.name, stage: 'A', source: 'client_parser' },
    });

    // Trigger background enrichment — don't await, let it run async
    enrichClientData(body.name, body.registeredNumber).then(async (enriched) => {
      // Update client record with enriched data
      const updateData: Record<string, unknown> = {};
      if (enriched.companyNumber && !body.registeredNumber) updateData['registered_number'] = enriched.companyNumber;
      if (enriched.registeredAddress) updateData['address'] = enriched.registeredAddress;
      if (enriched.companyType) {
        const typeMap: Record<string, string> = { 'community-interest-company': 'CIC', 'registered-charity': 'charity' };
        const mappedType = typeMap[enriched.companyType];
        if (mappedType && !body.type) updateData['type'] = mappedType;
      }
      if (enriched.previousGrants?.length) {
        updateData['existing_grants'] = enriched.previousGrants.map(g => ({ funder: g.funder, amount: g.amount, open_until: g.date }));
      }
      if (Object.keys(updateData).length > 0) {
        await supabase.from('clients').update(updateData).eq('id', data.id);
      }
      // Log enrichment
      await supabase.from('activity_log').insert({
        organisation_id: orgId, client_id: data.id, actor_type: 'system',
        action: 'client_enriched', details: { sources: enriched.sources, fieldsUpdated: Object.keys(updateData) }
      });
    }).catch(err => console.error('[Enrichment] Background enrichment failed:', err));

    res.status(201).json({ success: true, data });
  })
);

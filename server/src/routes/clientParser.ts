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

    // PDF files — in a production system, use pdf-parse or similar to extract text
    // from the binary. For now, we accept pre-extracted text content.
    // TODO: Integrate pdf-parse for proper PDF text extraction from base64 content
    if (mimeType === 'application/pdf') {
      // Attempt to use the content as-is (assumes caller sent extracted text)
      // A real implementation would decode the base64 and run it through pdf-parse
    }

    // Plain text, CSV, and pre-extracted PDF text — parse directly
    let textContent = content;

    // If content looks like base64 (no spaces, long alphanumeric), try decoding
    if (/^[A-Za-z0-9+/=]+$/.test(content) && content.length > 100) {
      try {
        textContent = Buffer.from(content, 'base64').toString('utf-8');
      } catch {
        // Not valid base64 — use as-is
      }
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
      res.status(500).json({
        success: false,
        error: { code: 'CREATE_FAILED', message: 'Failed to create client' },
      });
      return;
    }

    // Update plan usage counter
    await supabase
      .rpc('increment_usage', { org: req.user.org_id, field: 'active_clients' })
      .catch(() => {
        // Non-critical — usage counter will reconcile on next sync
      });

    // Log activity
    await supabase.from('activity_log').insert({
      organisation_id: req.user.org_id,
      client_id: data.id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'client_created',
      details: { name: body.name, stage: 'A', source: 'client_parser' },
    });

    res.status(201).json({ success: true, data });
  })
);

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { anthropic, AGENT_MODEL, AGENT_MAX_TOKENS } from '../lib/anthropic.js';
import { supabase } from '../lib/supabase.js';
import { buildContext } from '../agents/contextBuilder.js';
import { searchCompaniesHouse as chSearch, getCompanyProfile as chProfile, getCompanyOfficers as chOfficers, getCompanyFilingHistory as chFilings } from '../agents/companiesHouse.js';
import { getHeadCoachPrompt } from '../agents/prompts/headCoach.js';
import { getVAPrompt } from '../agents/prompts/vaAgent.js';
import { getEligibilityPrompt } from '../agents/prompts/eligibilityAgent.js';
import { getGrantWriterPrompt } from '../agents/prompts/grantWriter.js';
import { getOpsManagerPrompt } from '../agents/prompts/opsManager.js';
import { getSocialMediaPrompt } from '../agents/prompts/socialMedia.js';
import { getSocialValuePrompt } from '../agents/prompts/socialValueAgent.js';
import { getFunderIntelligencePrompt } from '../agents/prompts/funderIntelligence.js';
import { getImpactMeasurementPrompt } from '../agents/prompts/impactMeasurement.js';
import type { AgentType } from '../../../shared/types/database.js';
import type { AgentContext } from '../../../shared/types/agents.js';

export const agentsRouter = Router();

// All agent routes require authentication
agentsRouter.use(authMiddleware);

// ---- Constants ----

const ALLOWED_AGENT_TYPES: AgentType[] = [
  'head_coach',
  'va',
  'eligibility',
  'grant_writer',
  'ops_manager',
  'social_media',
  'social_value',
  'funder_intelligence',
  'impact_measurement',
];

// ---- Schemas ----

const sendMessageSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1),
      timestamp: z.string().optional(),
    })
  ).min(1),
  clientId: z.string().uuid().optional().nullable(),
  applicationId: z.string().uuid().optional().nullable(),
});

// ---- Helpers ----

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    fn(req, res).catch(next);
  };
}

/**
 * Returns the system prompt for a given agent type using the assembled context.
 * Each agent has its own prompt file in server/src/agents/prompts/.
 */
function getSystemPrompt(agentType: AgentType, context: AgentContext): string {
  switch (agentType) {
    case 'head_coach':
      return getHeadCoachPrompt(context);
    case 'va':
      return getVAPrompt(context);
    case 'eligibility':
      return getEligibilityPrompt(context);
    case 'grant_writer':
      return getGrantWriterPrompt(context);
    case 'ops_manager':
      return getOpsManagerPrompt(context);
    case 'social_media':
      return getSocialMediaPrompt(context);
    case 'social_value':
      return getSocialValuePrompt(context);
    case 'funder_intelligence':
      return getFunderIntelligencePrompt(context);
    case 'impact_measurement':
      return getImpactMeasurementPrompt(context);
    default:
      return `You are the ${agentType.replace(/_/g, ' ')} agent for BidBase, working for ${context.organisation.name}. You are a professional AI assistant for a grant bid writing platform. Respond helpfully and concisely based on the context provided.\n\nOrganisation: ${context.organisation.name} (${context.organisation.plan} plan)`;
  }
}

/**
 * Increments the agent_calls_month counter in plan_usage for the organisation.
 */
async function incrementAgentUsage(orgId: string): Promise<void> {
  // Use an upsert with raw increment — Supabase JS doesn't have atomic increment,
  // so we fetch-then-update. In production, use an RPC or database function.
  const { data: usage } = await supabase
    .from('plan_usage')
    .select('agent_calls_month')
    .eq('organisation_id', orgId)
    .single();

  const currentCalls = usage?.agent_calls_month ?? 0;

  await supabase
    .from('plan_usage')
    .upsert(
      {
        organisation_id: orgId,
        agent_calls_month: currentCalls + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organisation_id' }
    );
}

// ---- Routes ----

/**
 * POST /:agentType/message — Streaming SSE endpoint
 *
 * Validates the agent type, builds context, gets the system prompt,
 * streams the Anthropic response as SSE, then saves the conversation
 * and increments usage.
 */
agentsRouter.post(
  '/:agentType/message',
  validate(sendMessageSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const agentType = req.params['agentType'] as AgentType;

    // Validate agent type against allowed list
    if (!ALLOWED_AGENT_TYPES.includes(agentType)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_AGENT_TYPE', message: `Unknown agent type: ${agentType}` },
      });
      return;
    }

    const { messages, clientId, applicationId } = req.body as z.infer<typeof sendMessageSchema>;
    const orgId = req.user.org_id;

    // Build context pack from database
    const context = await buildContext(orgId, clientId, applicationId);

    // If VA agent and no client selected, try to find Companies House data from the message
    if (agentType === 'va' && !clientId && !context.companiesHouse && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.content) {
        try {
          // Look for company number pattern (8 digits)
          const numMatch = lastMsg.content.match(/\b(\d{7,8})\b/);

          let companyNumber: string | null = null;
          const commonWords = new Set(['tell','me','about','the','a','an','for','of','and','is','are','was','who','what','where','how','look','up','find','search','get','show','give','can','you','do','i','my','this','that','please','thanks','company','details','directors','information','info']);

          if (numMatch) {
            companyNumber = numMatch[1]!;
          } else {
            // Smart extraction: find words before CIC/Ltd/Limited/charity
            const words = lastMsg.content.split(/\s+/);
            const typeIdx = words.findIndex(w => /^(CIC|Ltd|Limited|LLP|PLC|charity)$/i.test(w));
            let searchName = '';

            if (typeIdx > 0) {
              const nameWords: string[] = [];
              for (let i = typeIdx - 1; i >= Math.max(0, typeIdx - 4); i--) {
                if (commonWords.has(words[i]!.toLowerCase().replace(/[^a-z]/g, ''))) break;
                nameWords.unshift(words[i]!);
              }
              searchName = nameWords.join(' ');
            }

            // Fallback: check for quoted names
            if (!searchName) {
              const quoted = lastMsg.content.match(/["']([A-Za-z0-9][A-Za-z0-9\s&'-]{2,40})["']/);
              if (quoted?.[1]) searchName = quoted[1];
            }

            if (searchName) {
              console.log(`[VA] Searching Companies House for: "${searchName}"`);
              const results = await chSearch(searchName);
              if (results.length > 0) {
                companyNumber = results[0]!.companyNumber;
                console.log(`[VA] Found: ${results[0]!.companyName} (${companyNumber})`);
              }
            }
          }

          if (companyNumber) {
            const [profile, officers, filings] = await Promise.all([
              chProfile(companyNumber).catch(() => null),
              chOfficers(companyNumber).catch(() => []),
              chFilings(companyNumber).catch(() => []),
            ]);

            if (profile) {
              const addr = profile.registeredAddress;
              context.companiesHouse = {
                companyNumber: profile.companyNumber,
                companyName: profile.companyName,
                companyType: profile.companyType,
                companyStatus: profile.companyStatus,
                dateOfCreation: profile.dateOfCreation,
                registeredAddress: [addr.line1, addr.line2, addr.locality, addr.region, addr.postalCode].filter(Boolean).join(', '),
                sicCodes: profile.sicCodes ?? [],
                officers: officers.map((o) => ({ name: o.name, role: o.role, appointedOn: o.appointedOn })),
                recentFilings: filings.slice(0, 5).map((f) => ({ date: f.date, description: f.description })),
                hasInsolvencyHistory: profile.hasInsolvencyHistory,
              };
            }
          }
        } catch {
          // Companies House lookup failed — continue without it
        }
      }
    }

    const systemPrompt = getSystemPrompt(agentType, context);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Stream from Anthropic
    if (!anthropic) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'AI agents unavailable — ANTHROPIC_API_KEY not configured' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    let fullResponse = '';

    try {
      const stream = anthropic.messages.stream({
        model: AGENT_MODEL,
        max_tokens: AGENT_MAX_TOKENS,
        system: systemPrompt,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      for await (const event of stream) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);

        // Accumulate the full response text for saving
        if (
          event.type === 'content_block_delta' &&
          'delta' in event &&
          event.delta.type === 'text_delta'
        ) {
          fullResponse += event.delta.text;
        }
      }
    } catch (streamErr: unknown) {
      const errMsg = streamErr instanceof Error ? streamErr.message : 'Agent error';
      console.error('[Agent Stream Error]', errMsg);

      // If headers already sent (SSE started), send error as SSE event
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: errMsg })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      // Headers not sent yet — return JSON error
      res.status(500).json({
        success: false,
        error: { code: 'AGENT_ERROR', message: errMsg },
      });
      return;
    }

    // Save conversation to agent_conversations
    const now = new Date().toISOString();
    const allMessages = [
      ...messages,
      { role: 'assistant' as const, content: fullResponse, timestamp: now },
    ];

    await supabase.from('agent_conversations').insert({
      organisation_id: orgId,
      client_id: clientId ?? null,
      application_id: applicationId ?? null,
      agent_type: agentType,
      messages: allMessages,
      context_pack: context,
      status: 'active',
      created_by: req.user.id,
      created_at: now,
      updated_at: now,
    });

    // Increment usage
    await incrementAgentUsage(orgId);

    // Signal end of stream
    res.write('data: [DONE]\n\n');
    res.end();
  })
);

/**
 * GET /conversations — List agent conversations scoped to the organisation.
 */
agentsRouter.get(
  '/conversations',
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;
    const page = parseInt(req.query['page'] as string, 10) || 1;
    const limit = Math.min(parseInt(req.query['limit'] as string, 10) || 20, 100);
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      supabase
        .from('agent_conversations')
        .select('id', { count: 'exact', head: true })
        .eq('organisation_id', orgId),

      supabase
        .from('agent_conversations')
        .select('id, agent_type, client_id, application_id, status, created_by, created_at, updated_at')
        .eq('organisation_id', orgId)
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1),
    ]);

    res.json({
      success: true,
      data: dataResult.data ?? [],
      pagination: {
        page,
        limit,
        total: countResult.count ?? 0,
      },
    });
  })
);

/**
 * GET /conversations/:id — Conversation detail with full messages.
 */
agentsRouter.get(
  '/conversations/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;
    const conversationId = req.params['id'];

    const { data, error } = await supabase
      .from('agent_conversations')
      .select('*')
      .eq('id', conversationId)
      .eq('organisation_id', orgId)
      .single();

    if (error || !data) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found' },
      });
      return;
    }

    res.json({ success: true, data });
  })
);

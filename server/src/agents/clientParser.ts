import { anthropic, AGENT_MODEL } from '../lib/anthropic.js';

export interface ParsedClientData {
  name?: string;
  type?: 'CIC' | 'charity' | 'social_enterprise' | 'unincorporated' | 'other';
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  annualIncome?: number;
  registeredNumber?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    county?: string;
    postcode?: string;
  };
  policiesHeld?: string[];
  notes?: string;
  confidence: Record<string, number>; // 0-100 confidence per field
  rawExtract: string; // original text used
}

const DOCUMENT_SYSTEM_PROMPT = `You are a document parsing agent for BidBase, a UK grant bid writing platform.
Your job is to extract structured client information from uploaded documents.

Look for:
- Organisation name — headers, letterheads, registration documents
- Organisation type — CIC, charity, social enterprise, unincorporated association, or other
- Primary contact details — name, email, phone number
- Registered number — Companies House number, charity number, CIC number
- Annual income / turnover — from financial statements, accounts, or stated figures
- Address — registered address or primary operating address (UK format: line1, line2, city, county, postcode)
- Policies held — safeguarding, equality & diversity, GDPR/data protection, health & safety, environmental, etc.

Return ONLY valid JSON matching this exact shape (omit fields you cannot find):
{
  "name": "string",
  "type": "CIC" | "charity" | "social_enterprise" | "unincorporated" | "other",
  "primaryContactName": "string",
  "primaryContactEmail": "string",
  "primaryContactPhone": "string",
  "annualIncome": number,
  "registeredNumber": "string",
  "address": {
    "line1": "string",
    "line2": "string",
    "city": "string",
    "county": "string",
    "postcode": "string"
  },
  "policiesHeld": ["string"],
  "notes": "string — any other relevant info that does not fit the fields above",
  "confidence": {
    "fieldName": 0-100
  }
}

The confidence object must include a score for every field you return. Score meaning:
- 90-100: explicitly stated, unambiguous
- 70-89: strongly implied or clearly readable but not labelled
- 50-69: inferred from context, may need verification
- Below 50: best guess, likely needs correction

Do NOT wrap the JSON in markdown code fences. Return raw JSON only.`;

const VOICE_SYSTEM_PROMPT = `You are a voice transcript parsing agent for BidBase, a UK grant bid writing platform.
Your job is to extract structured client information from transcribed voice input.

The transcript may contain:
- Spelling errors, informal language, filler words
- Dictated information in conversational style
- UK phone numbers, postcodes, and organisation references

Be tolerant of errors. For example:
- "see eye see" or "C I C" = CIC
- "registered charity" = type: charity
- Phonetic spellings of names and places

Extract:
- Organisation name
- Organisation type — CIC, charity, social enterprise, unincorporated association, or other
- Primary contact details — name, email, phone number
- Registered number — Companies House number, charity number, CIC number
- Annual income / turnover
- Address — UK format: line1, line2, city, county, postcode
- Policies held — safeguarding, equality & diversity, GDPR/data protection, health & safety, environmental, etc.

Return ONLY valid JSON matching this exact shape (omit fields you cannot find):
{
  "name": "string",
  "type": "CIC" | "charity" | "social_enterprise" | "unincorporated" | "other",
  "primaryContactName": "string",
  "primaryContactEmail": "string",
  "primaryContactPhone": "string",
  "annualIncome": number,
  "registeredNumber": "string",
  "address": {
    "line1": "string",
    "line2": "string",
    "city": "string",
    "county": "string",
    "postcode": "string"
  },
  "policiesHeld": ["string"],
  "notes": "string — any other relevant info that does not fit the fields above",
  "confidence": {
    "fieldName": 0-100
  }
}

The confidence object must include a score for every field you return. Score meaning:
- 90-100: explicitly stated, unambiguous
- 70-89: strongly implied or clearly recognisable despite transcription noise
- 50-69: inferred from context, may need verification
- Below 50: best guess from unclear audio, likely needs correction

Do NOT wrap the JSON in markdown code fences. Return raw JSON only.`;

function parseJsonFromResponse(text: string): Record<string, unknown> {
  // Strip markdown code fences if the model wraps them despite instructions
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return JSON.parse(cleaned) as Record<string, unknown>;
}

export async function parseDocumentForClient(text: string): Promise<ParsedClientData> {
  if (!anthropic) {
    throw new Error('Anthropic API key not configured — document parsing is unavailable');
  }

  const response = await anthropic.messages.create({
    model: AGENT_MODEL,
    max_tokens: 2048,
    system: DOCUMENT_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Extract client information from this document text:\n\n${text}`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response format from Anthropic API');
  }

  const parsed = parseJsonFromResponse(content.text);

  return {
    ...parsed,
    confidence: (parsed['confidence'] as Record<string, number>) ?? {},
    rawExtract: text,
  } as ParsedClientData;
}

export async function parseVoiceForClient(transcript: string): Promise<ParsedClientData> {
  if (!anthropic) {
    throw new Error('Anthropic API key not configured — voice parsing is unavailable');
  }

  const response = await anthropic.messages.create({
    model: AGENT_MODEL,
    max_tokens: 2048,
    system: VOICE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Extract client information from this voice transcript:\n\n${transcript}`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response format from Anthropic API');
  }

  const parsed = parseJsonFromResponse(content.text);

  return {
    ...parsed,
    confidence: (parsed['confidence'] as Record<string, number>) ?? {},
    rawExtract: transcript,
  } as ParsedClientData;
}

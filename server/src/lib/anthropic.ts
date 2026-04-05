import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env['ANTHROPIC_API_KEY'];

if (!apiKey) {
  console.warn('ANTHROPIC_API_KEY not set — AI agents will be unavailable');
}

export const anthropic = apiKey ? new Anthropic({ apiKey }) : null;

// Model constants — always this, never anything else
export const AGENT_MODEL = 'claude-sonnet-4-6' as const;
export const AGENT_MAX_TOKENS = 4096;

// Agent task and message types — shared between client and server

import type { AgentType } from './database.js';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface AgentContext {
  organisation: {
    id: string;
    name: string;
    plan: string;
  };
  client?: {
    id: string;
    name: string;
    type: string | null;
    stage: string;
    status: string;
    primary_contact_name: string | null;
    annual_income: number | null;
    policies_held: string[] | null;
    existing_grants: unknown[];
    registered_number: string | null;
    address: unknown;
  };
  companiesHouse?: {
    companyNumber: string;
    companyName: string;
    companyType: string;
    companyStatus: string;
    dateOfCreation: string;
    registeredAddress: string;
    sicCodes: string[];
    officers: Array<{ name: string; role: string; appointedOn: string }>;
    recentFilings: Array<{ date: string; description: string }>;
    hasInsolvencyHistory: boolean;
  };
  documents?: Array<{
    id: string;
    name: string;
    type: string;
    extracted_text: string | null;
  }>;
  applications?: Array<{
    id: string;
    funder_name: string;
    status: string;
    gate1_passed: boolean | null;
    gate2_passed: boolean | null;
    gate2_risk_level: string | null;
    gate3_passed: boolean | null;
    operator_approval: boolean;
  }>;
  funders?: Array<{
    id: string;
    name: string;
    grant_range_min: number | null;
    grant_range_max: number | null;
    eligible_structures: string[] | null;
    open_rounds: unknown[];
  }>;
}

export interface AgentStreamChunk {
  type: 'content_block_delta' | 'message_start' | 'message_stop';
  delta?: {
    type: 'text_delta';
    text: string;
  };
}

export interface SendMessageRequest {
  agentType: AgentType;
  messages: AgentMessage[];
  clientId?: string;
  applicationId?: string;
}

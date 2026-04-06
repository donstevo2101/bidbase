import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, API_BASE } from '../../lib/api';
import { useSessionStore } from '../../stores/session';
import type { Client, Application, AgentType } from '@shared/types/database';
import CommandCenter from '../../components/agents/CommandCenter';
import DailyReportPanel from '../../components/agents/DailyReportPanel';

// Web Speech API type declarations
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SpeechRecognition: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webkitSpeechRecognition: any;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agentType: AgentType;
  timestamp: Date;
  action?: 'client_extracted' | 'client_created' | 'enrichment_complete';
  actionData?: Record<string, unknown>;
}

interface AgentOption {
  type: AgentType;
  label: string;
  icon: string;
  description: string;
  group: 'orchestrator' | 'execution' | 'advanced';
  prompts: string[];
}

interface Conversation {
  id: string;
  agent_type: AgentType;
  client_id: string | null;
  application_id: string | null;
  messages: Array<{ role: string; content: string; timestamp?: string }>;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Agent definitions — all 9
// ---------------------------------------------------------------------------

const AGENTS: AgentOption[] = [
  // Orchestrator
  {
    type: 'head_coach',
    label: 'Head Coach',
    icon: '\u{1F3AF}',
    description: 'Your main AI assistant. Delegates to specialist agents, enforces gates, manages workflow.',
    group: 'orchestrator',
    prompts: [
      'Give me a Monday summary',
      'Check eligibility for this client',
      'What should I work on next?',
      'Run a pipeline health check',
    ],
  },
  // Execution agents
  {
    type: 'va',
    label: 'VA',
    icon: '\u{1F4CB}',
    description: 'Lead management, onboarding, document chasing, scheduling',
    group: 'execution',
    prompts: [
      'Start onboarding for this client',
      'Chase missing governance documents',
      'Schedule a follow-up for next week',
      'Draft an introduction email',
    ],
  },
  {
    type: 'eligibility',
    label: 'Eligibility & Research',
    icon: '\u{1F50D}',
    description: 'Gate 1 eligibility checks, Gate 2 funder matching, shortlists',
    group: 'execution',
    prompts: [
      'Run a Gate 1 eligibility check',
      'Find matching funders for this client',
      'Build a funder shortlist',
      'Check if we can reapply to this funder',
    ],
  },
  {
    type: 'grant_writer',
    label: 'Grant Writer',
    icon: '\u{270D}\uFE0F',
    description: 'Application drafting with Gate 3 quality review',
    group: 'execution',
    prompts: [
      'Draft an application for this funder',
      'Review my draft for quality',
      'Strengthen the impact section',
      'Write the budget justification',
    ],
  },
  {
    type: 'ops_manager',
    label: 'Ops Manager',
    icon: '\u{1F4CA}',
    description: 'Monday summaries, deadlines, capacity, invoice alerts',
    group: 'execution',
    prompts: [
      'Show upcoming deadlines this month',
      'How many Stage C slots are left?',
      'Which invoices are overdue?',
      'Generate the Monday summary',
    ],
  },
  {
    type: 'social_media',
    label: 'Social Media',
    icon: '\u{1F4F1}',
    description: 'Content drafts for LinkedIn, Twitter \u2014 operator approves',
    group: 'execution',
    prompts: [
      'Draft a LinkedIn post about a recent win',
      'Write a Twitter thread on grant tips',
      'Create a case study post',
      'Suggest content themes for this month',
    ],
  },
  // Advanced agents (Professional+ only)
  {
    type: 'social_value',
    label: 'Social Value',
    icon: '\u{1F4D0}',
    description: 'HACT, TOMS, SROI calculations and reporting',
    group: 'advanced',
    prompts: [
      'Calculate social value using HACT proxies',
      'Generate a TOMS output table',
      'Estimate indicative SROI ratio',
      'Draft a social value narrative',
    ],
  },
  {
    type: 'funder_intelligence',
    label: 'Funder Intelligence',
    icon: '\u{1F514}',
    description: 'New funding rounds, deadline alerts, client matching',
    group: 'advanced',
    prompts: [
      'What new rounds opened this week?',
      'Which clients match this new fund?',
      'Show pre-registration deadlines',
      'Generate the weekly intelligence briefing',
    ],
  },
  {
    type: 'impact_measurement',
    label: 'Impact Measurement',
    icon: '\u{1F4C8}',
    description: 'Theory of Change, evidence gaps, outcome indicators',
    group: 'advanced',
    prompts: [
      'Build a Theory of Change framework',
      'Identify evidence gaps for this client',
      'Suggest outcome indicators',
      'Draft the impact narrative section',
    ],
  },
];

const AGENT_GROUPS = [
  { key: 'orchestrator' as const, label: 'ORCHESTRATOR' },
  { key: 'execution' as const, label: 'EXECUTION AGENTS' },
  { key: 'advanced' as const, label: 'ADVANCED \u2014 Professional+' },
];

const ADVANCED_AGENT_TYPES: AgentType[] = ['social_value', 'funder_intelligence', 'impact_measurement'];

type ViewMode = 'chat' | 'command_center' | 'reports';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const DEFAULT_AGENT: AgentOption = AGENTS[0]!;

function getAgentByType(type: AgentType): AgentOption {
  return AGENTS.find((a) => a.type === type) ?? DEFAULT_AGENT;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AgentWorkspacePage() {
  const accessToken = useSessionStore((s) => s.accessToken);
  const organisation = useSessionStore((s) => s.organisation);
  const plan = organisation?.plan ?? 'starter';
  const isAdvancedLocked = plan === 'starter';

  // State
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [selectedAgent, setSelectedAgent] = useState<AgentOption>(DEFAULT_AGENT);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedApplicationId, setSelectedApplicationId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [contextPanelOpen, setContextPanelOpen] = useState(true);
  const [isListening, setIsListening] = useState(false);

  // Client action state
  const [pendingClientData, setPendingClientData] = useState<Record<string, unknown> | null>(null);
  const [isCreatingClient, setIsCreatingClient] = useState(false);
  const [showQuickAddForm, setShowQuickAddForm] = useState(false);
  const [quickAddData, setQuickAddData] = useState({
    name: '',
    type: '',
    primaryContactName: '',
    primaryContactEmail: '',
    primaryContactPhone: '',
    annualIncome: '',
    registeredNumber: '',
  });

  // File upload state
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileUploadRef = useRef<HTMLInputElement>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  // Speech-to-text setup
  const speechSupported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const toggleListening = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-GB';

    let finalTranscript = '';

    recognition.onresult = (event: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.[0]) {
          if (result.isFinal) {
            finalTranscript += result[0].transcript + ' ';
          } else {
            interim += result[0].transcript;
          }
        }
      }
      setInputValue(finalTranscript + interim);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = async () => {
      setIsListening(false);
      // Auto-parse voice transcript for client data when VA is selected
      if (selectedAgent.type === 'va' && finalTranscript.trim().length > 20) {
        try {
          const parseResult = await api.post<Record<string, unknown>>('/client-parser/parse-voice', { transcript: finalTranscript.trim() });
          if (parseResult.success && parseResult.data && parseResult.data.name) {
            setPendingClientData(parseResult.data);
            const extracted = parseResult.data;
            const lines: string[] = ['I heard your client details. Here\'s what I extracted:\n'];
            if (extracted.name) lines.push(`Organisation: ${String(extracted.name)}`);
            if (extracted.type) lines.push(`Type: ${String(extracted.type)}`);
            if (extracted.primaryContactName) lines.push(`Contact: ${String(extracted.primaryContactName)}`);
            if (extracted.primaryContactEmail) lines.push(`Email: ${String(extracted.primaryContactEmail)}`);
            if (extracted.primaryContactPhone) lines.push(`Phone: ${String(extracted.primaryContactPhone)}`);

            const userMsg: ChatMessage = {
              id: generateId(),
              role: 'user',
              content: finalTranscript.trim(),
              agentType: selectedAgent.type,
              timestamp: new Date(),
            };
            const assistantMsg: ChatMessage = {
              id: generateId(),
              role: 'assistant',
              content: lines.join('\n'),
              agentType: selectedAgent.type,
              timestamp: new Date(),
            };
            const actionMsg: ChatMessage = {
              id: generateId(),
              role: 'assistant',
              content: 'Would you like me to create a client record with this information?',
              agentType: selectedAgent.type,
              timestamp: new Date(),
              action: 'client_extracted',
              actionData: parseResult.data,
            };
            setMessages(prev => [...prev, userMsg, assistantMsg, actionMsg]);
            setInputValue('');
          }
        } catch {
          // Voice parsing failed silently — user can still send as normal message
        }
      }
    };

    recognitionRef.current = recognition;
    finalTranscript = inputValue;
    recognition.start();
    setIsListening(true);
  }, [isListening, inputValue, selectedAgent.type]);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const { data: clientsRes } = useQuery({
    queryKey: ['clients-dropdown'],
    queryFn: () => api.paginated<Client>('/clients?page=1&limit=100'),
  });
  const clients = clientsRes?.success ? clientsRes.data : [];

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );

  const { data: applicationsRes } = useQuery({
    queryKey: ['client-applications', selectedClientId],
    queryFn: () => api.paginated<Application>(`/clients/${selectedClientId}/applications?page=1&limit=50`),
    enabled: !!selectedClientId,
  });
  const applications = applicationsRes?.success ? applicationsRes.data : [];

  const selectedApplication = useMemo(
    () => applications.find((a) => a.id === selectedApplicationId) ?? null,
    [applications, selectedApplicationId],
  );

  const { data: conversationsRes, refetch: refetchConversations } = useQuery({
    queryKey: ['agent-conversations'],
    queryFn: () => api.get<Conversation[]>('/agents/conversations'),
  });
  const conversations: Conversation[] =
    conversationsRes?.success ? (conversationsRes.data as Conversation[]) : [];

  // Document count for context panel
  const { data: documentsRes } = useQuery({
    queryKey: ['client-documents-count', selectedClientId],
    queryFn: () => api.paginated<{ id: string }>(`/clients/${selectedClientId}/documents?page=1&limit=1`),
    enabled: !!selectedClientId,
  });
  const documentCount = documentsRes?.success ? documentsRes.pagination.total : 0;

  // -----------------------------------------------------------------------
  // Scroll behaviour
  // -----------------------------------------------------------------------

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // -----------------------------------------------------------------------
  // Agent selection
  // -----------------------------------------------------------------------

  function handleAgentChange(agent: AgentOption) {
    if (isAdvancedLocked && ADVANCED_AGENT_TYPES.includes(agent.type)) return;
    if (isStreaming && abortRef.current) {
      abortRef.current.abort();
    }
    setSelectedAgent(agent);
    setMessages([]);
    setError(null);
    setIsStreaming(false);
    setActiveConversationId(null);
    setPendingClientData(null);
    setShowQuickAddForm(false);
  }

  // -----------------------------------------------------------------------
  // New conversation
  // -----------------------------------------------------------------------

  function handleNewConversation() {
    if (isStreaming && abortRef.current) {
      abortRef.current.abort();
    }
    setMessages([]);
    setError(null);
    setIsStreaming(false);
    setActiveConversationId(null);
    setPendingClientData(null);
    setShowQuickAddForm(false);
  }

  // -----------------------------------------------------------------------
  // Load conversation from history
  // -----------------------------------------------------------------------

  async function handleLoadConversation(conv: Conversation) {
    const agent = getAgentByType(conv.agent_type);
    setSelectedAgent(agent);
    setActiveConversationId(conv.id);
    if (conv.client_id) setSelectedClientId(conv.client_id);
    if (conv.application_id) setSelectedApplicationId(conv.application_id);
    setError(null);

    // If messages aren't loaded (list view doesn't include them), fetch the full conversation
    if (!conv.messages || conv.messages.length === 0) {
      const result = await api.get<Conversation>(`/agents/conversations/${conv.id}`);
      if (result.success && result.data.messages) {
        setMessages(
          result.data.messages.map((m, i) => ({
            id: `hist-${conv.id}-${i}`,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            agentType: conv.agent_type,
            timestamp: m.timestamp ? new Date(m.timestamp) : new Date(conv.created_at),
          })),
        );
        return;
      }
    }

    const convMessages = conv.messages ?? [];
    setMessages(
      convMessages.map((m, i) => ({
        id: `hist-${conv.id}-${i}`,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        agentType: conv.agent_type,
        timestamp: m.timestamp ? new Date(m.timestamp) : new Date(conv.created_at),
      })),
    );
  }

  // -----------------------------------------------------------------------
  // Send message with SSE streaming
  // -----------------------------------------------------------------------

  const sendMessage = useCallback(
    async (overrideContent?: string) => {
      const content = (overrideContent ?? inputValue).trim();
      if (!content || isStreaming) return;

      setError(null);
      if (!overrideContent) setInputValue('');

      const userMessage: ChatMessage = {
        id: generateId(),
        role: 'user',
        content,
        agentType: selectedAgent.type,
        timestamp: new Date(),
      };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);

      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: '',
        agentType: selectedAgent.type,
        timestamp: new Date(),
      };
      setMessages([...updatedMessages, assistantMessage]);
      setIsStreaming(true);

      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        const response = await fetch(`${API_BASE}/agents/${selectedAgent.type}/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
            clientId: selectedClientId || undefined,
            applicationId: selectedApplicationId || undefined,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage = 'Failed to get response from agent';

          try {
            const parsed = JSON.parse(errorBody);
            if (parsed.error?.message) {
              errorMessage = parsed.error.message;
            }
          } catch {
            // use default
          }

          if (
            response.status === 500 &&
            (errorMessage.toLowerCase().includes('api key') ||
              errorMessage.toLowerCase().includes('anthropic') ||
              errorMessage.toLowerCase().includes('unavailable') ||
              errorMessage.toLowerCase().includes('credit balance') ||
              errorMessage.toLowerCase().includes('billing'))
          ) {
            setError('AI agents unavailable \u2014 Anthropic API credits required. Check billing at console.anthropic.com');
            setMessages((prev) => {
              const updated = [...prev];
              const lastItem = updated.length > 0 ? updated[updated.length - 1] : undefined;
              if (lastItem && lastItem.role === 'assistant' && !lastItem.content) {
                updated.pop();
              }
              return updated;
            });
            setIsStreaming(false);
            abortRef.current = null;
            return;
          }

          throw new Error(errorMessage);
        }

        if (!response.body) throw new Error('No response stream available');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') break;

            try {
              const chunk = JSON.parse(data);
              if (chunk.text) {
                fullContent += chunk.text;
              } else if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
                fullContent += chunk.delta.text;
              } else if (chunk.type === 'text_delta' && chunk.text) {
                fullContent += chunk.text;
              } else if (typeof chunk === 'string') {
                fullContent += chunk;
              } else if (chunk.content) {
                fullContent += chunk.content;
              }
            } catch {
              if (data && data !== '[DONE]') {
                fullContent += data;
              }
            }

            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              const last = lastIdx >= 0 ? updated[lastIdx] : undefined;
              if (last && last.role === 'assistant') {
                updated[lastIdx] = { ...last, content: fullContent };
              }
              return updated;
            });
          }
        }

        // Final update
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          const last = lastIdx >= 0 ? updated[lastIdx] : undefined;
          if (last && last.role === 'assistant') {
            updated[lastIdx] = { ...last, content: fullContent || '(No response)' };
          }
          return updated;
        });

        // Refresh conversation list
        refetchConversations();
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setMessages((prev) => {
            const updated = [...prev];
            const lastMsg = updated.length > 0 ? updated[updated.length - 1] : undefined;
            if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.content) {
              updated.pop();
            }
            return updated;
          });
        } else {
          const errorMsg = err instanceof Error ? err.message : 'An unexpected error occurred';
          setError(errorMsg);
          setMessages((prev) => {
            const updated = [...prev];
            const lastMsg = updated.length > 0 ? updated[updated.length - 1] : undefined;
            if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.content) {
              updated.pop();
            }
            return updated;
          });
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [inputValue, isStreaming, messages, selectedAgent.type, selectedClientId, selectedApplicationId, accessToken, refetchConversations],
  );

  // -----------------------------------------------------------------------
  // Create client from chat action
  // -----------------------------------------------------------------------

  const createClientFromChat = useCallback(async (dataOverride?: Record<string, unknown>) => {
    const data = dataOverride ?? pendingClientData;
    if (!data) return;
    setIsCreatingClient(true);

    try {
      const result = await api.post<{ id: string; name: string }>('/client-parser/confirm', data);

      if (!result.success) throw new Error(result.error.message);

      const successMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `Client "${result.data.name}" has been created successfully. The system is now enriching their profile with Companies House, LinkedIn, and grant data.`,
        agentType: selectedAgent.type,
        timestamp: new Date(),
        action: 'client_created',
        actionData: { clientId: result.data.id, clientName: result.data.name },
      };
      setMessages(prev => [...prev, successMsg]);
      setPendingClientData(null);
      setShowQuickAddForm(false);

      // Auto-select the new client in the context panel
      setSelectedClientId(result.data.id);

      toast.success(`Client "${result.data.name}" created`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setIsCreatingClient(false);
    }
  }, [pendingClientData, selectedAgent.type]);

  // -----------------------------------------------------------------------
  // Document upload for agent chat
  // -----------------------------------------------------------------------

  const handleAgentFileUpload = useCallback(async (file: File) => {
    // Auto-switch to VA agent when uploading a document from any agent
    const vaAgent = AGENTS.find(a => a.type === 'va');
    if (vaAgent && selectedAgent.type !== 'va') {
      setSelectedAgent(vaAgent);
    }
    const agentType = 'va' as AgentType;

    setIsUploading(true);
    setUploadedFileName(file.name);

    try {
      let content: string;
      const isTextFile = file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.csv');

      if (isTextFile) {
        content = await file.text();
      } else {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]!);
        }
        content = btoa(binary);
      }

      const result = await api.post<{
        name?: string;
        type?: string;
        primaryContactName?: string;
        primaryContactEmail?: string;
        primaryContactPhone?: string;
        annualIncome?: number;
        registeredNumber?: string;
        address?: Record<string, string>;
        policiesHeld?: string[];
        notes?: string;
      }>('/client-parser/parse-document', {
        content,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
      });

      if (!result.success) {
        throw new Error(result.error.message);
      }

      const extracted = result.data;

      // Store the extracted data for the action system
      setPendingClientData(extracted as Record<string, unknown>);

      // Build summary lines
      const lines: string[] = [`I've uploaded and analysed "${file.name}". Here's what I extracted:\n`];
      if (extracted.name) lines.push(`Organisation: ${extracted.name}`);
      if (extracted.type) lines.push(`Type: ${extracted.type}`);
      if (extracted.primaryContactName) lines.push(`Contact: ${extracted.primaryContactName}`);
      if (extracted.primaryContactEmail) lines.push(`Email: ${extracted.primaryContactEmail}`);
      if (extracted.primaryContactPhone) lines.push(`Phone: ${extracted.primaryContactPhone}`);
      if (extracted.annualIncome) lines.push(`Annual Income: \u00A3${extracted.annualIncome.toLocaleString()}`);
      if (extracted.registeredNumber) lines.push(`Reg Number: ${extracted.registeredNumber}`);
      if (extracted.address) {
        const addr = Object.values(extracted.address).filter(Boolean).join(', ');
        if (addr) lines.push(`Address: ${addr}`);
      }
      if (extracted.policiesHeld?.length) lines.push(`Policies: ${extracted.policiesHeld.join(', ')}`);

      // Add user message showing the upload
      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: `I've uploaded "${file.name}"`,
        agentType: agentType,
        timestamp: new Date(),
      };

      // Add assistant message with extracted data summary
      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: lines.join('\n'),
        agentType: agentType,
        timestamp: new Date(),
      };

      // Add action message with interactive card
      const actionMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: 'Would you like me to create a client record with this information?',
        agentType: agentType,
        timestamp: new Date(),
        action: 'client_extracted',
        actionData: extracted as Record<string, unknown>,
      };

      setMessages(prev => [...prev, userMsg, assistantMsg, actionMsg]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to process document';
      setError(`Document upload failed: ${errMsg}`);
    } finally {
      setIsUploading(false);
      setUploadedFileName(null);
      if (fileUploadRef.current) fileUploadRef.current.value = '';
    }
  }, [selectedAgent.type]);

  // -----------------------------------------------------------------------
  // Keyboard handling
  // -----------------------------------------------------------------------

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // -----------------------------------------------------------------------
  // Helpers for context panel
  // -----------------------------------------------------------------------

  function gateLabel(passed: boolean | null): string {
    if (passed === true) return 'Passed';
    if (passed === false) return 'Failed';
    return 'Pending';
  }

  function gateColor(passed: boolean | null): string {
    if (passed === true) return 'text-emerald-400';
    if (passed === false) return 'text-red-400';
    return 'text-slate-500';
  }

  function statusBadgeColor(status: string): string {
    switch (status) {
      case 'successful': return 'bg-emerald-900/40 text-emerald-300 border-emerald-700';
      case 'submitted': return 'bg-blue-900/40 text-blue-300 border-blue-700';
      case 'drafting': case 'draft_ready': return 'bg-amber-900/40 text-amber-300 border-amber-700';
      case 'gate1_failed': case 'unsuccessful': case 'withdrawn': return 'bg-red-900/40 text-red-300 border-red-700';
      default: return 'bg-slate-700/40 text-slate-300 border-slate-600';
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="flex h-full overflow-hidden bg-slate-900">
      {/* ================================================================ */}
      {/* LEFT PANEL - Agent Selector + Conversation History               */}
      {/* ================================================================ */}
      <div className="w-72 flex-shrink-0 bg-slate-900 border-r border-slate-700/60 flex flex-col">
        {/* Logo / title */}
        <div className="px-4 py-4 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center">
              <span className="text-white text-sm font-bold">B</span>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white leading-tight">BidBase Copilot</h1>
              <p className="text-[10px] text-slate-500">AI Agent Workspace</p>
            </div>
          </div>
        </div>

        {/* Agent list grouped */}
        <div className="flex-1 overflow-auto py-2">
          {AGENT_GROUPS.map((group) => {
            const groupAgents = AGENTS.filter((a) => a.group === group.key);
            return (
              <div key={group.key} className="mb-1">
                <div className="px-4 py-1.5">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                    {group.label}
                  </span>
                </div>
                {groupAgents.map((agent) => {
                  const isLocked = isAdvancedLocked && ADVANCED_AGENT_TYPES.includes(agent.type);
                  const isActive = selectedAgent.type === agent.type;
                  return (
                    <button
                      key={agent.type}
                      onClick={() => handleAgentChange(agent)}
                      disabled={isLocked}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-all duration-150 group relative ${
                        isActive
                          ? 'bg-teal-600/15 text-white border-l-2 border-teal-500'
                          : isLocked
                            ? 'text-slate-600 cursor-not-allowed opacity-50 border-l-2 border-transparent'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border-l-2 border-transparent'
                      }`}
                    >
                      <span className="text-lg leading-none w-6 text-center flex-shrink-0">
                        {agent.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium truncate">{agent.label}</span>
                          {isLocked && (
                            <svg className="w-3 h-3 text-slate-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">
                          {isLocked ? 'Professional plan required' : agent.description}
                        </p>
                      </div>
                      {isActive && (
                        <div className="w-1.5 h-1.5 rounded-full bg-teal-400 flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}

          {/* Conversation history */}
          <div className="mt-4 border-t border-slate-700/60 pt-2">
            <div className="px-4 py-1.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                History
              </span>
              <button
                onClick={handleNewConversation}
                className="text-[10px] text-teal-500 hover:text-teal-400 font-medium transition-colors"
              >
                + New
              </button>
            </div>
            {conversations.length === 0 && (
              <p className="px-4 py-2 text-[10px] text-slate-600">No conversations yet</p>
            )}
            {conversations.slice(0, 20).map((conv) => {
              const agent = getAgentByType(conv.agent_type);
              const convMessages = conv.messages ?? [];
              const firstUserMsg = convMessages.find((m) => m.role === 'user');
              const preview = firstUserMsg?.content?.slice(0, 50) ?? `${agent.label} conversation`;
              const isActive = activeConversationId === conv.id;
              return (
                <button
                  key={conv.id}
                  onClick={() => handleLoadConversation(conv)}
                  className={`w-full text-left px-4 py-2 flex items-start gap-2 transition-colors ${
                    isActive
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
                  }`}
                >
                  <span className="text-xs leading-none mt-0.5 flex-shrink-0">{agent.icon}</span>
                  <div className="min-w-0">
                    <p className="text-[11px] truncate">{preview}{firstUserMsg?.content && firstUserMsg.content.length > 50 ? '...' : ''}</p>
                    <p className="text-[9px] text-slate-600 mt-0.5">
                      {new Date(conv.updated_at ?? conv.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* CENTER PANEL - Chat / Command Center / Reports                   */}
      {/* ================================================================ */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
        {/* Header bar */}
        <div className="border-b border-slate-700/60 bg-slate-900/80 backdrop-blur-sm">
          <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-lg">
              {selectedAgent.icon}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">{selectedAgent.label}</h2>
              <p className="text-[10px] text-slate-500">{selectedAgent.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Client selector */}
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Client</label>
              <select
                value={selectedClientId}
                onChange={(e) => {
                  setSelectedClientId(e.target.value);
                  setSelectedApplicationId('');
                }}
                className="px-2.5 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-300 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 max-w-[180px] appearance-none cursor-pointer"
              >
                <option value="">None selected</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Application selector */}
            {selectedClientId && applications.length > 0 && (
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">App</label>
                <select
                  value={selectedApplicationId}
                  onChange={(e) => setSelectedApplicationId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-300 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 max-w-[180px] appearance-none cursor-pointer"
                >
                  <option value="">None</option>
                  {applications.map((a) => (
                    <option key={a.id} value={a.id}>{a.funder_name}{a.project_name ? ` \u2014 ${a.project_name}` : ''}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Context panel toggle */}
            <button
              onClick={() => setContextPanelOpen(!contextPanelOpen)}
              className={`p-1.5 rounded-lg transition-colors ${
                contextPanelOpen ? 'bg-teal-600/20 text-teal-400' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
              }`}
              title={contextPanelOpen ? 'Hide context panel' : 'Show context panel'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>
          </div>

          {/* View mode tabs */}
          <div className="flex px-5 gap-0">
            {([
              { key: 'chat' as ViewMode, label: 'Chat' },
              { key: 'command_center' as ViewMode, label: 'Command Center' },
              { key: 'reports' as ViewMode, label: 'Reports' },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setViewMode(tab.key)}
                className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                  viewMode === tab.key
                    ? 'text-teal-400 border-teal-400'
                    : 'text-slate-500 border-transparent hover:text-slate-300 hover:border-slate-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Render view based on mode */}
        {viewMode === 'command_center' ? (
          <CommandCenter
            onSelectAgent={(agentType) => {
              const agent = getAgentByType(agentType);
              handleAgentChange(agent);
              setViewMode('chat');
            }}
          />
        ) : viewMode === 'reports' ? (
          <DailyReportPanel />
        ) : (
        <>
        {/* API key error banner */}
        {error && (error.includes('ANTHROPIC') || error.includes('unavailable') || error.includes('credit')) && (
          <div className="mx-5 mt-3 px-4 py-3 bg-amber-900/30 border border-amber-700/50 rounded-lg flex items-center gap-3">
            <svg className="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-300">AI agents unavailable</p>
              <p className="text-xs text-amber-400/70 mt-0.5">Add ANTHROPIC_API_KEY to your server .env file to enable agent conversations.</p>
            </div>
          </div>
        )}

        {/* Messages area */}
        <div className="flex-1 overflow-auto px-5 py-5">
          {messages.length === 0 && !error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-lg">
                <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-3xl mx-auto mb-4">
                  {selectedAgent.icon}
                </div>
                <h3 className="text-lg font-semibold text-white mb-1">{selectedAgent.label}</h3>
                <p className="text-sm text-slate-500 mb-6 max-w-sm mx-auto">
                  {selectedAgent.description}
                  {!selectedClientId && (
                    <span className="block mt-1 text-slate-600">Select a client above for context-aware responses.</span>
                  )}
                </p>

                {/* Suggested prompts */}
                <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">
                  {selectedAgent.prompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => sendMessage(prompt)}
                      disabled={isStreaming}
                      className="text-left px-3 py-2.5 rounded-lg border border-slate-700/60 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-600 text-xs text-slate-400 hover:text-slate-200 transition-all duration-150 disabled:opacity-50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>

                {/* VA-specific quick action buttons */}
                {selectedAgent.type === 'va' && (
                  <div className="mt-4 pt-4 border-t border-slate-700/40">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Quick Actions</p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      <button
                        onClick={() => fileUploadRef.current?.click()}
                        disabled={isStreaming || isUploading}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-teal-700/40 bg-teal-900/20 hover:bg-teal-900/40 text-xs text-teal-300 hover:text-teal-200 transition-all disabled:opacity-50"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                        Upload client document
                      </button>
                      {speechSupported && (
                        <button
                          onClick={toggleListening}
                          disabled={isStreaming}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-teal-700/40 bg-teal-900/20 hover:bg-teal-900/40 text-xs text-teal-300 hover:text-teal-200 transition-all disabled:opacity-50"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                          </svg>
                          Dictate client details
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setShowQuickAddForm(true);
                          setQuickAddData({ name: '', type: '', primaryContactName: '', primaryContactEmail: '', primaryContactPhone: '', annualIncome: '', registeredNumber: '' });
                        }}
                        disabled={isStreaming}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-teal-700/40 bg-teal-900/20 hover:bg-teal-900/40 text-xs text-teal-300 hover:text-teal-200 transition-all disabled:opacity-50"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                        </svg>
                        Quick add client
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {messages.map((msg, idx) => {
            const agent = getAgentByType(msg.agentType);
            return (
              <div
                key={msg.id}
                className={`flex mb-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {/* Assistant avatar */}
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-sm flex-shrink-0 mr-2.5 mt-0.5">
                    {agent.icon}
                  </div>
                )}

                <div className={`max-w-[70%] ${msg.role === 'user' ? '' : ''}`}>
                  {/* Agent name + time */}
                  <div className={`flex items-center gap-2 mb-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <span className="text-[10px] text-slate-600 font-medium">
                      {msg.role === 'user' ? 'You' : agent.label}
                    </span>
                    <span className="text-[9px] text-slate-700">
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>

                  {/* Message bubble */}
                  <div
                    className={`px-4 py-3 rounded-2xl text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-teal-600 text-white rounded-br-md'
                        : 'bg-slate-800/80 text-slate-200 border border-slate-700/60 rounded-bl-md'
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                    {msg.role === 'assistant' && isStreaming && idx === messages.length - 1 && (
                      <span className="inline-flex items-center gap-1 ml-1 align-middle">
                        <span className="w-1 h-1 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1 h-1 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1 h-1 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    )}
                  </div>

                  {/* Action card: Extracted client data with Create/Cancel buttons */}
                  {msg.action === 'client_extracted' && msg.actionData && (
                    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mt-2">
                      <h4 className="text-xs font-semibold text-teal-400 uppercase tracking-wider mb-3">
                        Extracted Client Data
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                        {Object.entries(msg.actionData).filter(([k]) => !['confidence', 'rawExtract'].includes(k)).map(([key, value]) => (
                          <div key={key} className="flex justify-between">
                            <span className="text-slate-400 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                            <span className="text-white font-medium">{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => createClientFromChat()}
                          disabled={isCreatingClient}
                          className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium rounded-lg disabled:opacity-50 flex items-center gap-2 transition-colors"
                        >
                          {isCreatingClient ? (
                            <>
                              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Creating...
                            </>
                          ) : (
                            'Create Client'
                          )}
                        </button>
                        <button
                          onClick={() => setPendingClientData(null)}
                          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Action card: Client created success */}
                  {msg.action === 'client_created' && msg.actionData && (
                    <div className="bg-emerald-900/30 border border-emerald-700/50 rounded-xl p-4 mt-2">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-sm font-semibold text-emerald-300">Client Created Successfully</span>
                      </div>
                      <p className="text-xs text-slate-300 mb-3">
                        The system is enriching this client with Companies House, LinkedIn, and grant data in the background.
                      </p>
                      <a
                        href={`/clients/${String(msg.actionData.clientId)}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors"
                      >
                        View Client Profile
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                      </a>
                    </div>
                  )}
                </div>

                {/* User avatar */}
                {msg.role === 'user' && (
                  <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 ml-2.5 mt-0.5">
                    You
                  </div>
                )}
              </div>
            );
          })}

          {/* Streaming typing indicator — when assistant message is empty */}
          {isStreaming && messages.length > 0 && (() => { const l = messages[messages.length - 1]; return l && l.role === 'assistant' && !l.content; })() && (
            <div className="flex mb-4 justify-start">
              <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-sm flex-shrink-0 mr-2.5 mt-0.5">
                {selectedAgent.icon}
              </div>
              <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-slate-800/80 border border-slate-700/60">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 mr-1">{selectedAgent.label} is thinking</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          {/* General error display (non-API-key errors) */}
          {error && !error.includes('ANTHROPIC') && !error.includes('unavailable') && !error.includes('credit') && (
            <div className="flex justify-center mb-4">
              <div className="bg-red-900/30 border border-red-700/50 text-red-300 rounded-xl px-4 py-3 text-xs max-w-md">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{error}</span>
                </div>
              </div>
            </div>
          )}

          {/* Inline quick-add client form */}
          {showQuickAddForm && selectedAgent.type === 'va' && (
            <div className="flex mb-4 justify-start">
              <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-sm flex-shrink-0 mr-2.5 mt-0.5">
                {selectedAgent.icon}
              </div>
              <div className="max-w-[70%]">
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                  <h4 className="text-xs font-semibold text-teal-400 uppercase tracking-wider mb-3">Quick Add Client</h4>
                  <div className="space-y-2">
                    <input
                      placeholder="Organisation name *"
                      value={quickAddData.name}
                      onChange={(e) => setQuickAddData(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                    />
                    <select
                      value={quickAddData.type}
                      onChange={(e) => setQuickAddData(prev => ({ ...prev, type: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                    >
                      <option value="">Type...</option>
                      <option value="CIC">CIC</option>
                      <option value="charity">Charity</option>
                      <option value="social_enterprise">Social Enterprise</option>
                      <option value="unincorporated">Unincorporated</option>
                      <option value="other">Other</option>
                    </select>
                    <input
                      placeholder="Contact name"
                      value={quickAddData.primaryContactName}
                      onChange={(e) => setQuickAddData(prev => ({ ...prev, primaryContactName: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                    />
                    <input
                      placeholder="Contact email"
                      type="email"
                      value={quickAddData.primaryContactEmail}
                      onChange={(e) => setQuickAddData(prev => ({ ...prev, primaryContactEmail: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                    />
                    <input
                      placeholder="Contact phone"
                      type="tel"
                      value={quickAddData.primaryContactPhone}
                      onChange={(e) => setQuickAddData(prev => ({ ...prev, primaryContactPhone: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                    />
                    <input
                      placeholder="Annual income"
                      type="number"
                      value={quickAddData.annualIncome}
                      onChange={(e) => setQuickAddData(prev => ({ ...prev, annualIncome: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                    />
                    <input
                      placeholder="Registered number"
                      value={quickAddData.registeredNumber}
                      onChange={(e) => setQuickAddData(prev => ({ ...prev, registeredNumber: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                    />
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => {
                          if (!quickAddData.name.trim()) {
                            toast.error('Organisation name is required');
                            return;
                          }
                          const payload: Record<string, unknown> = {
                            name: quickAddData.name.trim(),
                          };
                          if (quickAddData.type) payload.type = quickAddData.type;
                          if (quickAddData.primaryContactName) payload.primaryContactName = quickAddData.primaryContactName;
                          if (quickAddData.primaryContactEmail) payload.primaryContactEmail = quickAddData.primaryContactEmail;
                          if (quickAddData.primaryContactPhone) payload.primaryContactPhone = quickAddData.primaryContactPhone;
                          if (quickAddData.annualIncome) payload.annualIncome = Number(quickAddData.annualIncome);
                          if (quickAddData.registeredNumber) payload.registeredNumber = quickAddData.registeredNumber;
                          createClientFromChat(payload);
                        }}
                        disabled={isCreatingClient || !quickAddData.name.trim()}
                        className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium rounded-lg disabled:opacity-50 flex items-center gap-2 transition-colors"
                      >
                        {isCreatingClient ? (
                          <>
                            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Creating...
                          </>
                        ) : (
                          'Create Client'
                        )}
                      </button>
                      <button
                        onClick={() => setShowQuickAddForm(false)}
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="border-t border-slate-700/60 bg-slate-900/80 backdrop-blur-sm px-5 py-4">
          <div className="flex items-end gap-3 max-w-4xl mx-auto">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Message ${selectedAgent.label}...`}
                disabled={isStreaming}
                rows={1}
                className="w-full px-4 py-3 pr-24 text-sm bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 disabled:opacity-50 max-h-32 overflow-auto transition-all"
                style={{ minHeight: '44px' }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = '44px';
                  el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                }}
              />
              <div className="absolute right-2 bottom-2 flex items-center gap-1">
                {/* Document upload button */}
                <button
                  onClick={() => fileUploadRef.current?.click()}
                  disabled={isStreaming || isUploading}
                  className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                  title="Upload document"
                >
                  {isUploading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                    </svg>
                  )}
                </button>
                {/* Voice input button */}
                {speechSupported && (
                  <button
                    onClick={toggleListening}
                    disabled={isStreaming}
                    className={`p-2 rounded-lg transition-all duration-150 ${
                      isListening
                        ? 'bg-red-500 hover:bg-red-400 text-white animate-pulse'
                        : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                    } disabled:opacity-30 disabled:cursor-not-allowed`}
                    title={isListening ? 'Stop listening' : 'Voice input'}
                  >
                    {isListening ? (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                      </svg>
                    )}
                  </button>
                )}
                {/* Send button */}
                <button
                  onClick={() => sendMessage()}
                  disabled={isStreaming || !inputValue.trim()}
                  className="p-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                >
                  {isStreaming ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-slate-600 mt-2 text-center">
            Enter to send \u00b7 Shift+Enter for new line{speechSupported ? ' \u00b7 \uD83C\uDF99\uFE0F Voice' : ''} \u00b7 \uD83D\uDCCE Upload docs
          </p>
          {/* Upload status */}
          {isUploading && uploadedFileName && (
            <p className="text-[10px] text-teal-400 mt-1 text-center animate-pulse">
              Processing {uploadedFileName}...
            </p>
          )}
          {/* Hidden file input */}
          <input
            ref={fileUploadRef}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.txt,.csv,.rtf,.png,.jpg,.jpeg"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleAgentFileUpload(file);
            }}
          />
        </div>
        </>
        )}
      </div>

      {/* ================================================================ */}
      {/* RIGHT PANEL - Context Panel (collapsible)                        */}
      {/* ================================================================ */}
      {contextPanelOpen && (
        <div className="w-80 flex-shrink-0 bg-slate-900 border-l border-slate-700/60 flex flex-col overflow-auto">
          <div className="px-4 py-3 border-b border-slate-700/60 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Context</h3>
            <button
              onClick={() => setContextPanelOpen(false)}
              className="text-slate-600 hover:text-slate-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Client details */}
          {selectedClient ? (
            <div className="p-4 border-b border-slate-700/60">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-teal-600/20 border border-teal-700/40 flex items-center justify-center">
                  <span className="text-xs font-bold text-teal-400">{selectedClient.name.charAt(0)}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{selectedClient.name}</p>
                  <p className="text-[10px] text-slate-500">
                    {selectedClient.type ?? 'Unspecified type'}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Stage</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    selectedClient.stage === 'C' ? 'bg-emerald-900/40 text-emerald-300' :
                    selectedClient.stage === 'B' ? 'bg-amber-900/40 text-amber-300' :
                    'bg-slate-700/40 text-slate-300'
                  }`}>
                    Stage {selectedClient.stage}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Status</span>
                  <span className="text-xs text-slate-300 capitalize">{selectedClient.status}</span>
                </div>
                {selectedClient.primary_contact_name && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Contact</span>
                    <span className="text-xs text-slate-300 truncate max-w-[140px]">{selectedClient.primary_contact_name}</span>
                  </div>
                )}
                {selectedClient.primary_contact_email && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Email</span>
                    <span className="text-xs text-slate-400 truncate max-w-[140px]">{selectedClient.primary_contact_email}</span>
                  </div>
                )}
                {selectedClient.annual_income !== null && selectedClient.annual_income !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Income</span>
                    <span className="text-xs text-slate-300">
                      {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(selectedClient.annual_income)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Documents</span>
                  <span className="text-xs text-slate-300">{documentCount}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 border-b border-slate-700/60">
              <div className="text-center py-6">
                <svg className="w-8 h-8 text-slate-700 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <p className="text-xs text-slate-600">No client selected</p>
                <p className="text-[10px] text-slate-700 mt-0.5">Select a client for context-aware conversations</p>
              </div>
            </div>
          )}

          {/* Application details */}
          {selectedApplication && (
            <div className="p-4 border-b border-slate-700/60">
              <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Application</h4>
              <div className="space-y-2">
                <div>
                  <p className="text-xs font-medium text-white">{selectedApplication.funder_name}</p>
                  {selectedApplication.project_name && (
                    <p className="text-[10px] text-slate-500 mt-0.5">{selectedApplication.project_name}</p>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Status</span>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusBadgeColor(selectedApplication.status)}`}>
                    {selectedApplication.status.replace(/_/g, ' ')}
                  </span>
                </div>
                {selectedApplication.amount_requested !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Amount</span>
                    <span className="text-xs text-slate-300">
                      {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(selectedApplication.amount_requested)}
                    </span>
                  </div>
                )}
                {selectedApplication.deadline && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Deadline</span>
                    <span className="text-xs text-slate-300">
                      {new Date(selectedApplication.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                )}

                {/* Gate statuses */}
                <div className="mt-3 pt-3 border-t border-slate-800">
                  <h5 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Gates</h5>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">Gate 1 \u2014 Eligibility</span>
                      <span className={`text-[10px] font-medium ${gateColor(selectedApplication.gate1_passed)}`}>
                        {gateLabel(selectedApplication.gate1_passed)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">Gate 2 \u2014 Funder Match</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-medium ${gateColor(selectedApplication.gate2_passed)}`}>
                          {gateLabel(selectedApplication.gate2_passed)}
                        </span>
                        {selectedApplication.gate2_risk_level === 'high_risk' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-700/50">HIGH RISK</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">Gate 3 \u2014 Quality</span>
                      <span className={`text-[10px] font-medium ${gateColor(selectedApplication.gate3_passed)}`}>
                        {gateLabel(selectedApplication.gate3_passed)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Active agent info */}
          <div className="p-4">
            <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Active Agent</h4>
            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/40">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{selectedAgent.icon}</span>
                <span className="text-xs font-medium text-white">{selectedAgent.label}</span>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">{selectedAgent.description}</p>
              <div className="mt-2 pt-2 border-t border-slate-700/40">
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                  selectedAgent.group === 'orchestrator'
                    ? 'bg-purple-900/40 text-purple-300 border border-purple-700/50'
                    : selectedAgent.group === 'advanced'
                      ? 'bg-amber-900/40 text-amber-300 border border-amber-700/50'
                      : 'bg-teal-900/40 text-teal-300 border border-teal-700/50'
                }`}>
                  {selectedAgent.group === 'orchestrator' ? 'Orchestrator' : selectedAgent.group === 'advanced' ? 'Advanced' : 'Execution'}
                </span>
              </div>
            </div>

            {/* Plan info for advanced agents */}
            {isAdvancedLocked && (
              <div className="mt-3 bg-amber-900/20 border border-amber-700/30 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span className="text-xs font-medium text-amber-300">Upgrade to unlock</span>
                </div>
                <p className="text-[10px] text-amber-400/70">
                  Social Value, Funder Intelligence, and Impact Measurement agents require the Professional plan or higher.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

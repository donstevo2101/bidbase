import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useSessionStore } from '../../stores/session';
import type { AgentType } from '@shared/types/database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SchedulerStatus {
  running: boolean;
  activeAgents: string[];
  uptime?: number;
}

interface ConversationSummary {
  id: string;
  agent_type: AgentType;
  updated_at: string;
  created_at: string;
}

interface AgentNodeDef {
  type: AgentType;
  label: string;
  icon: string;
  group: 'orchestrator' | 'execution' | 'advanced';
}

const ALL_AGENTS: AgentNodeDef[] = [
  { type: 'head_coach', label: 'Head Coach', icon: '\u{1F3AF}', group: 'orchestrator' },
  { type: 'va', label: 'VA', icon: '\u{1F4CB}', group: 'execution' },
  { type: 'eligibility', label: 'Eligibility', icon: '\u{1F50D}', group: 'execution' },
  { type: 'grant_writer', label: 'Grant Writer', icon: '\u{270D}\uFE0F', group: 'execution' },
  { type: 'ops_manager', label: 'Ops Manager', icon: '\u{1F4CA}', group: 'execution' },
  { type: 'social_media', label: 'Social Media', icon: '\u{1F4F1}', group: 'execution' },
  { type: 'social_value', label: 'Social Value', icon: '\u{1F4D0}', group: 'advanced' },
  { type: 'funder_intelligence', label: 'Funder Intel', icon: '\u{1F514}', group: 'advanced' },
  { type: 'impact_measurement', label: 'Impact Meas.', icon: '\u{1F4C8}', group: 'advanced' },
];

const ADVANCED_TYPES: AgentType[] = ['social_value', 'funder_intelligence', 'impact_measurement'];

// ---------------------------------------------------------------------------
// Status dot component
// ---------------------------------------------------------------------------

type NodeStatus = 'active' | 'idle' | 'processing' | 'error';

function StatusDot({ status }: { status: NodeStatus }) {
  const colors: Record<NodeStatus, string> = {
    active: 'bg-emerald-400',
    idle: 'bg-slate-500',
    processing: 'bg-amber-400',
    error: 'bg-red-400',
  };
  return (
    <span className="relative flex h-2.5 w-2.5">
      {(status === 'active' || status === 'processing') && (
        <span
          className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${colors[status]}`}
        />
      )}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${colors[status]}`} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Agent node card
// ---------------------------------------------------------------------------

interface AgentNodeProps {
  agent: AgentNodeDef;
  status: NodeStatus;
  lastActive: string | null;
  taskCount: number;
  isLocked: boolean;
  isHeadCoach: boolean;
  onClick: () => void;
}

function AgentNode({ agent, status, lastActive, taskCount, isLocked, isHeadCoach, onClick }: AgentNodeProps) {
  return (
    <button
      onClick={onClick}
      className={`relative rounded-xl border transition-all duration-200 hover:scale-[1.03] hover:shadow-lg hover:shadow-teal-900/20 focus:outline-none focus:ring-2 focus:ring-teal-500/40 ${
        isHeadCoach
          ? 'bg-slate-800/90 border-teal-500/60 shadow-md shadow-teal-900/30 px-6 py-4 min-w-[180px]'
          : 'bg-slate-800/70 border-slate-700/60 px-4 py-3 min-w-[140px]'
      } ${isLocked ? 'opacity-60' : ''}`}
    >
      {/* Lock overlay for starter plan */}
      {isLocked && (
        <div className="absolute top-1.5 right-1.5">
          <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
      )}

      {/* Status dot top-left */}
      <div className="absolute -top-1 -left-1">
        <StatusDot status={isLocked ? 'idle' : status} />
      </div>

      {/* Icon + name */}
      <div className="flex flex-col items-center gap-1.5">
        <span className={`leading-none ${isHeadCoach ? 'text-2xl' : 'text-lg'}`}>{agent.icon}</span>
        <span className={`font-semibold text-white leading-tight text-center ${isHeadCoach ? 'text-sm' : 'text-xs'}`}>
          {agent.label}
        </span>
      </div>

      {/* Meta info */}
      <div className="mt-2 flex items-center justify-center gap-3">
        {lastActive ? (
          <span className="text-[9px] text-slate-500">
            {formatRelative(lastActive)}
          </span>
        ) : (
          <span className="text-[9px] text-slate-600">No activity</span>
        )}
        {taskCount > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-teal-900/40 text-teal-300 border border-teal-700/40 font-medium">
            {taskCount}
          </span>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function isWithin24h(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface CommandCenterProps {
  onSelectAgent?: (agentType: AgentType) => void;
}

export default function CommandCenter({ onSelectAgent }: CommandCenterProps) {
  const organisation = useSessionStore((s) => s.organisation);
  const plan = organisation?.plan ?? 'starter';
  const isAdvancedLocked = plan === 'starter';
  const queryClient = useQueryClient();

  // Fetch conversations for activity data
  const { data: conversationsRes } = useQuery({
    queryKey: ['agent-conversations'],
    queryFn: () => api.get<ConversationSummary[]>('/agents/conversations'),
    refetchInterval: 30000,
  });
  const conversations: ConversationSummary[] =
    conversationsRes?.success ? (conversationsRes.data as ConversationSummary[]) : [];

  // Fetch scheduler status
  const { data: schedulerRes, isLoading: schedulerLoading } = useQuery({
    queryKey: ['scheduler-status'],
    queryFn: () => api.get<SchedulerStatus>('/scheduler/status'),
    refetchInterval: 10000,
  });
  const scheduler: SchedulerStatus | null =
    schedulerRes?.success ? (schedulerRes.data as SchedulerStatus) : null;

  // Start/stop scheduler mutations
  const startMutation = useMutation({
    mutationFn: () => api.post('/scheduler/start', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduler-status'] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => api.post('/scheduler/stop', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduler-status'] }),
  });

  const isSchedulerRunning = scheduler?.running ?? false;

  // Compute per-agent stats
  const agentStats = useMemo(() => {
    const stats: Record<string, { lastActive: string | null; taskCount: number }> = {};
    for (const agent of ALL_AGENTS) {
      const agentConvs = conversations.filter((c) => c.agent_type === agent.type);
      const sorted = agentConvs.sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
      const last = sorted[0]?.updated_at ?? null;
      const todayCount = agentConvs.filter((c) => isWithin24h(c.updated_at ?? c.created_at)).length;
      stats[agent.type] = { lastActive: last, taskCount: todayCount };
    }
    return stats;
  }, [conversations]);

  // Derive agent statuses
  function getNodeStatus(agentType: AgentType): NodeStatus {
    if (scheduler?.activeAgents?.includes(agentType)) return 'active';
    const stat = agentStats[agentType];
    if (stat?.lastActive && isWithin24h(stat.lastActive)) return 'processing';
    return 'idle';
  }

  // Fleet summary
  const activeCount = ALL_AGENTS.filter((a) => getNodeStatus(a.type) === 'active').length;
  const todayConversations = conversations.filter((c) => isWithin24h(c.updated_at ?? c.created_at)).length;

  // Tree rows
  const headCoach = ALL_AGENTS[0]!;
  const executionRow = ALL_AGENTS.filter((a) => a.group === 'execution');
  const advancedRow = ALL_AGENTS.filter((a) => a.group === 'advanced');

  // Periodic re-render to update relative timestamps
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-full flex flex-col bg-slate-950 overflow-auto">
      {/* ============================================================== */}
      {/* Status bar                                                      */}
      {/* ============================================================== */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-700/60 bg-slate-900/80 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <svg className="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
            Agent Fleet
          </h2>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              {activeCount} active
            </span>
            <span className="text-slate-600">|</span>
            <span>{todayConversations} conversations today</span>
            <span className="text-slate-600">|</span>
            <span>
              {schedulerLoading ? (
                <span className="text-slate-600">Loading...</span>
              ) : isSchedulerRunning ? (
                <span className="text-emerald-400">Scheduler running</span>
              ) : (
                <span className="text-slate-500">Scheduler stopped</span>
              )}
            </span>
          </div>
        </div>

        {/* Start/Stop toggle */}
        <button
          onClick={() => {
            if (isSchedulerRunning) {
              stopMutation.mutate();
            } else {
              startMutation.mutate();
            }
          }}
          disabled={startMutation.isPending || stopMutation.isPending}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 disabled:opacity-50 ${
            isSchedulerRunning
              ? 'bg-red-900/40 text-red-300 border border-red-700/50 hover:bg-red-900/60'
              : 'bg-teal-600 text-white hover:bg-teal-500'
          }`}
        >
          {startMutation.isPending || stopMutation.isPending
            ? 'Updating...'
            : isSchedulerRunning
              ? 'Stop All Agents'
              : 'Start All Agents'}
        </button>
      </div>

      {/* ============================================================== */}
      {/* Node graph / tree                                               */}
      {/* ============================================================== */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 gap-0">

        {/* ------ Head Coach (root) ------ */}
        <div className="flex justify-center">
          <AgentNode
            agent={headCoach}
            status={getNodeStatus(headCoach.type)}
            lastActive={agentStats[headCoach.type]?.lastActive ?? null}
            taskCount={agentStats[headCoach.type]?.taskCount ?? 0}
            isLocked={false}
            isHeadCoach={true}
            onClick={() => onSelectAgent?.(headCoach.type)}
          />
        </div>

        {/* Vertical connector from Head Coach */}
        <div className="w-px h-6 bg-slate-700/80" />

        {/* Horizontal rail + 5 down-connectors for execution row */}
        <div className="relative flex justify-center" style={{ width: 'fit-content' }}>
          {/* Horizontal line spanning the execution row */}
          <div className="absolute top-0 left-[calc(50%-280px)] right-[calc(50%-280px)] h-px bg-slate-700/80" style={{ width: '560px', left: '50%', transform: 'translateX(-50%)' }} />
          {/* 5 vertical ticks down */}
          <div className="flex gap-4 pt-0">
            {executionRow.map((_, i) => (
              <div key={i} className="flex flex-col items-center" style={{ width: '140px' }}>
                <div className="w-px h-6 bg-slate-700/80" />
              </div>
            ))}
          </div>
        </div>

        {/* ------ Execution agents row ------ */}
        <div className="flex gap-4 justify-center">
          {executionRow.map((agent) => (
            <AgentNode
              key={agent.type}
              agent={agent}
              status={getNodeStatus(agent.type)}
              lastActive={agentStats[agent.type]?.lastActive ?? null}
              taskCount={agentStats[agent.type]?.taskCount ?? 0}
              isLocked={false}
              isHeadCoach={false}
              onClick={() => onSelectAgent?.(agent.type)}
            />
          ))}
        </div>

        {/* Connector from Ops Manager down to advanced row */}
        <div className="flex justify-center" style={{ marginLeft: '144px' }}>
          <div className="w-px h-6 bg-slate-700/80" />
        </div>

        {/* Horizontal rail + 3 down-connectors for advanced row */}
        <div className="relative flex justify-center" style={{ width: 'fit-content', marginLeft: '144px' }}>
          <div className="absolute top-0 h-px bg-slate-700/80" style={{ width: '360px', left: '50%', transform: 'translateX(-50%)' }} />
          <div className="flex gap-4 pt-0">
            {advancedRow.map((_, i) => (
              <div key={i} className="flex flex-col items-center" style={{ width: '140px' }}>
                <div className="w-px h-6 bg-slate-700/80" />
              </div>
            ))}
          </div>
        </div>

        {/* ------ Advanced agents row ------ */}
        <div className="flex gap-4 justify-center" style={{ marginLeft: '144px' }}>
          {advancedRow.map((agent) => (
            <AgentNode
              key={agent.type}
              agent={agent}
              status={getNodeStatus(agent.type)}
              lastActive={agentStats[agent.type]?.lastActive ?? null}
              taskCount={agentStats[agent.type]?.taskCount ?? 0}
              isLocked={isAdvancedLocked && ADVANCED_TYPES.includes(agent.type)}
              isHeadCoach={false}
              onClick={() => {
                if (!(isAdvancedLocked && ADVANCED_TYPES.includes(agent.type))) {
                  onSelectAgent?.(agent.type);
                }
              }}
            />
          ))}
        </div>
      </div>

      {/* ============================================================== */}
      {/* Legend                                                           */}
      {/* ============================================================== */}
      <div className="flex items-center justify-center gap-6 px-6 py-3 border-t border-slate-700/60 bg-slate-900/50 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <span className="w-2 h-2 rounded-full bg-emerald-400" /> Active
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <span className="w-2 h-2 rounded-full bg-amber-400" /> Processing
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <span className="w-2 h-2 rounded-full bg-slate-500" /> Idle
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <span className="w-2 h-2 rounded-full bg-red-400" /> Error
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          Locked (Starter plan)
        </div>
      </div>
    </div>
  );
}

import { Fragment, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Client } from '@shared/types/database';

interface PipelineClient extends Client {
  activeApps: number;
  pipelineValue: number;
  nextDeadline: string | null;
}

interface PipelineData {
  A: PipelineClient[];
  B: PipelineClient[];
  C: PipelineClient[];
}

interface PipelineSummary {
  clientsByStage: { A: number; B: number; C: number };
  totalActive: number;
  upcomingDeadlines: Array<{
    clientName: string;
    funderName: string;
    deadline: string;
    applicationId: string;
  }>;
  stageC: { current: number; limit: number };
}

type ViewMode = 'pipeline' | 'table' | 'calendar';

const stageConfig: Record<string, { accent: string; label: string; borderClass: string }> = {
  A: { accent: 'var(--color-accent)', label: 'Stage A — New Leads & Assessment', borderClass: 'border-l-[var(--color-accent)]' },
  B: { accent: 'var(--color-success)', label: 'Stage B — Active Clients', borderClass: 'border-l-[var(--color-success)]' },
  C: { accent: 'var(--color-warning)', label: 'Stage C — Full Engagement', borderClass: 'border-l-[var(--color-warning)]' },
};

const statusBadge: Record<string, { bg: string; text: string }> = {
  active: { bg: '#d1fae5', text: '#065f46' },
  lead: { bg: '#fef3c7', text: '#92400e' },
  paused: { bg: '#f3f4f6', text: '#374151' },
  offboarded: { bg: '#fee2e2', text: '#991b1b' },
};

function formatCurrency(value: number): string {
  return `\u00A3${value.toLocaleString('en-GB')}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '\u2014';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DashboardPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('pipeline');
  const [collapsedStages, setCollapsedStages] = useState<Record<string, boolean>>({});

  const toggleStage = useCallback((stage: string) => {
    setCollapsedStages((prev) => ({ ...prev, [stage]: !prev[stage] }));
  }, []);

  const {
    data: pipelineRes,
    isLoading: pipelineLoading,
  } = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => api.get<PipelineData>('/pipeline'),
  });

  const {
    data: summaryRes,
    isLoading: summaryLoading,
  } = useQuery({
    queryKey: ['pipeline-summary'],
    queryFn: () => api.get<PipelineSummary>('/pipeline/summary'),
  });

  const pipeline = pipelineRes?.success ? pipelineRes.data : null;
  const summary = summaryRes?.success ? summaryRes.data : null;

  const isLoading = pipelineLoading || summaryLoading;
  const isEmpty = pipeline && pipeline.A.length === 0 && pipeline.B.length === 0 && pipeline.C.length === 0;

  const stages: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];

  const totals = useMemo(() => {
    if (!pipeline || !summary) return { clients: 0, activeApps: 0, pipelineValue: 0 };
    const allClients = [...pipeline.A, ...pipeline.B, ...pipeline.C];
    return {
      clients: allClients.length,
      activeApps: allClients.reduce((s, c) => s + c.activeApps, 0),
      pipelineValue: allClients.reduce((s, c) => s + c.pipelineValue, 0),
    };
  }, [pipeline, summary]);

  const upcomingDeadlines = useMemo(() => {
    if (!summary) return [];
    const now = new Date();
    const twoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    return summary.upcomingDeadlines.filter((d) => {
      const dl = new Date(d.deadline);
      return dl >= now && dl <= twoWeeks;
    });
  }, [summary]);

  const viewModes: { key: ViewMode; label: string }[] = [
    { key: 'pipeline', label: 'Pipeline' },
    { key: 'table', label: 'Table' },
    { key: 'calendar', label: 'Calendar' },
  ];

  return (
    <div style={{ padding: 24, background: 'var(--color-surface-subtle)', minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0, lineHeight: '28px' }}>
            Pipeline Overview
          </h1>
          <p style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)', margin: '4px 0 0 0' }}>
            {totals.clients} clients · {totals.activeApps} active applications · {formatCurrency(totals.pipelineValue)} pipeline value
          </p>
        </div>
        <div style={{
          display: 'inline-flex',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}>
          {viewModes.map((vm) => (
            <button
              key={vm.key}
              onClick={() => setViewMode(vm.key)}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 500,
                border: 'none',
                cursor: 'pointer',
                background: viewMode === vm.key ? 'var(--color-accent)' : 'var(--color-surface)',
                color: viewMode === vm.key ? '#ffffff' : 'var(--color-text-secondary)',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {vm.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'TOTAL CLIENTS', value: String(totals.clients), accent: 'var(--color-accent)' },
          { label: 'ACTIVE APPLICATIONS', value: String(totals.activeApps), accent: 'var(--color-success)' },
          { label: 'PIPELINE VALUE', value: formatCurrency(totals.pipelineValue), accent: 'var(--color-warning)' },
          { label: 'STAGE C CAPACITY', value: summary ? `${summary.stageC.current}/${summary.stageC.limit}` : '0/0', accent: 'var(--color-danger)' },
        ].map((tile) => (
          <div
            key={tile.label}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'stretch',
              gap: 12,
            }}
          >
            <div style={{ width: 3, borderRadius: 2, background: tile.accent, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', color: 'var(--color-text-secondary)', letterSpacing: '0.02em' }}>
                {tile.label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 2 }}>
                {tile.value}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          padding: '48px 0',
          textAlign: 'center',
        }}>
          <div style={{
            width: 24, height: 24,
            border: '2px solid var(--color-accent)',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 8px',
          }} />
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading pipeline data...</p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && isEmpty && (
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          padding: '48px 0',
          textAlign: 'center',
        }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>No clients yet</p>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>Add your first client to get started</p>
          <Link
            to="/clients/new"
            style={{
              display: 'inline-block',
              marginTop: 12,
              padding: '8px 16px',
              background: 'var(--color-accent)',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 6,
              textDecoration: 'none',
            }}
          >
            + Add Client
          </Link>
        </div>
      )}

      {/* Main pipeline table */}
      {!isLoading && pipeline && !isEmpty && (
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          overflow: 'hidden',
          marginBottom: 16,
        }}>
          <table className="data-grid" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Stage</th>
                <th style={{ textAlign: 'left' }}>Client</th>
                <th style={{ textAlign: 'left' }}>Type</th>
                <th style={{ textAlign: 'left' }}>Status</th>
                <th style={{ textAlign: 'right' }}>Applications</th>
                <th style={{ textAlign: 'right' }}>Pipeline Value</th>
                <th style={{ textAlign: 'left' }}>Deadline</th>
                <th style={{ textAlign: 'left' }}>Assigned</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((stage) => {
                const clients = pipeline[stage];
                const config = stageConfig[stage]!;
                const isCollapsed = collapsedStages[stage] ?? false;

                return (
                  <Fragment key={stage}>
                    {/* Stage group header */}
                    <tr
                      onClick={() => toggleStage(stage)}
                      style={{ cursor: 'pointer', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
                    >
                      <td
                        colSpan={8}
                        style={{
                          padding: '12px 16px',
                          borderLeft: `3px solid ${config.accent}`,
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 10 10"
                            style={{
                              transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                              transition: 'transform 0.15s',
                              color: 'var(--color-text-secondary)',
                            }}
                          >
                            <path d="M2 3 L5 6 L8 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                            {config.label}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}>
                            ({clients.length})
                          </span>
                        </span>
                      </td>
                    </tr>

                    {/* Client rows */}
                    {!isCollapsed && clients.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ padding: '12px 16px 12px 32px', fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                          No clients in this stage
                        </td>
                      </tr>
                    )}
                    {!isCollapsed && clients.map((client) => {
                      const badge = statusBadge[client.status] ?? { bg: '#f3f4f6', text: '#374151' };
                      return (
                        <tr key={client.id}>
                          <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{stage}</td>
                          <td>
                            <Link
                              to={`/clients/${client.id}`}
                              style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', textDecoration: 'none' }}
                            >
                              {client.name}
                            </Link>
                          </td>
                          <td style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{client.type ?? '\u2014'}</td>
                          <td>
                            <span style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 500,
                              background: badge.bg,
                              color: badge.text,
                              textTransform: 'capitalize',
                            }}>
                              {client.status}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                            {client.activeApps}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500 }}>
                            {client.pipelineValue > 0 ? formatCurrency(client.pipelineValue) : '\u2014'}
                          </td>
                          <td style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                            {formatDate(client.nextDeadline)}
                          </td>
                          <td style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                            {client.assigned_to ? 'Assigned' : '\u2014'}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Bottom section — two cards side by side */}
      {!isLoading && summary && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Upcoming Deadlines */}
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            overflow: 'hidden',
          }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
              <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                Upcoming Deadlines
              </h2>
            </div>
            <div style={{ padding: 0 }}>
              {upcomingDeadlines.length === 0 ? (
                <p style={{ padding: '16px', fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic', margin: 0 }}>
                  No upcoming deadlines in the next 14 days.
                </p>
              ) : (
                <table className="data-grid" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Client</th>
                      <th style={{ textAlign: 'left' }}>Funder</th>
                      <th style={{ textAlign: 'right' }}>Deadline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingDeadlines.map((d, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{d.clientName}</td>
                        <td style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{d.funderName}</td>
                        <td style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'right' }}>{formatDate(d.deadline)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Stage C Capacity */}
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            overflow: 'hidden',
          }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
              <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                Stage C Capacity
              </h2>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  {summary.stageC.current} of {summary.stageC.limit} slots used
                </span>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                  {summary.stageC.limit > 0
                    ? Math.round((summary.stageC.current / summary.stageC.limit) * 100)
                    : 0}%
                </span>
              </div>
              <div style={{
                width: '100%',
                height: 8,
                background: '#f3f4f6',
                borderRadius: 4,
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  borderRadius: 4,
                  background: summary.stageC.current >= summary.stageC.limit
                    ? 'var(--color-danger)'
                    : 'var(--color-accent)',
                  width: `${summary.stageC.limit > 0
                    ? Math.min((summary.stageC.current / summary.stageC.limit) * 100, 100)
                    : 0}%`,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
                {summary.stageC.current >= summary.stageC.limit
                  ? 'Stage C is at capacity. Offboard a client or upgrade your plan to add more.'
                  : `${summary.stageC.limit - summary.stageC.current} slot${summary.stageC.limit - summary.stageC.current !== 1 ? 's' : ''} remaining.`}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

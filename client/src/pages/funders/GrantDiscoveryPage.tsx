import React, { useState, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useSessionStore } from '../../stores/session';
import { toast } from 'sonner';
import type { Client } from '@shared/types/database';

// ---- Types ----

interface GrantOpportunity {
  id?: string;
  title: string;
  funder: string;
  url: string;
  amount?: string;
  deadline?: string;
  eligibility?: string;
  description?: string;
  source: string;
  scrapedAt: string;
  openDate?: string;
  closeDate?: string;
  status?: 'open' | 'upcoming' | 'closed';
  previousAwards?: number;
  totalApplicants?: number;
  averageAward?: string;
  sectors?: string[];
  riskScore?: number;
}

interface GrantSearchFilters {
  clientType?: string;
  geography?: string;
  sector?: string;
  clientId?: string;
}

interface RiskFactor {
  factor: string;
  impact: 'positive' | 'negative' | 'neutral';
  weight: number;
  detail: string;
}

interface RiskScoreResult {
  score: number;
  reasoning: string;
  factors: RiskFactor[];
}

type TabKey = 'open' | 'upcoming' | 'historic';
type ViewMode = 'discovery' | 'scrapeResults';
type ScrapeTopTab = 'output' | 'log' | 'storage' | 'liveView';
type ScrapeSubTab = 'overview' | 'organic' | 'paid' | 'aiMode' | 'perplexity' | 'chatgpt' | 'allFields';

// ---- Helpers ----

function daysUntil(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function daysSince(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  return Math.ceil((now.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
}

function riskColor(score: number | undefined): string {
  if (score === undefined) return '#94a3b8';
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#14b8a6';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function riskLabel(score: number | undefined): string {
  if (score === undefined) return 'Unscored';
  if (score >= 80) return 'Strong';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Partial';
  if (score >= 20) return 'Weak';
  return 'Poor';
}

function statusBadge(status: string | undefined) {
  const colors: Record<string, { bg: string; text: string }> = {
    open: { bg: '#dcfce7', text: '#166534' },
    upcoming: { bg: '#dbeafe', text: '#1e40af' },
    closed: { bg: '#f3f4f6', text: '#6b7280' },
  };
  const s = status ?? 'open';
  const c = colors[s] ?? colors['open']!;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={{ backgroundColor: c!.bg, color: c!.text }}
    >
      {s.charAt(0).toUpperCase() + s.slice(1)}
    </span>
  );
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '\u2014';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ---- Spinner ----

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? 'h-3.5 w-3.5'}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ---- Component ----

export default function GrantDiscoveryPage() {
  const user = useSessionStore((s) => s.user);
  const isAdmin = user?.role === 'org_admin' || user?.role === 'super_admin';

  const [activeTab, setActiveTab] = useState<TabKey>('open');
  const [clientType, setClientType] = useState('');
  const [geography, setGeography] = useState('');
  const [sector, setSector] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [grants, setGrants] = useState<GrantOpportunity[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [matchDropdownOpen, setMatchDropdownOpen] = useState<string | null>(null);
  const [scoringGrantKey, setScoringGrantKey] = useState<string | null>(null);
  const [riskDetail, setRiskDetail] = useState<{ grant: GrantOpportunity; result: RiskScoreResult } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('discovery');
  const [scrapeTopTab, setScrapeTopTab] = useState<ScrapeTopTab>('output');
  const [scrapeSubTab, setScrapeSubTab] = useState<ScrapeSubTab>('organic');
  const [expandedScrapeRow, setExpandedScrapeRow] = useState<number | null>(null);

  const { data: clientsResult } = useQuery({
    queryKey: ['clients-list'],
    queryFn: () => api.paginated<Client>('/clients'),
  });

  const clients = clientsResult?.success ? clientsResult.data : [];

  // ---- Mutations ----

  const searchMutation = useMutation({
    mutationFn: (filters: GrantSearchFilters) =>
      api.post<GrantOpportunity[]>('/enrichment/grants/search', filters),
    onSuccess: (result) => {
      setHasSearched(true);
      if (result.success) {
        setGrants(result.data);
      } else {
        toast.error('Grant search failed');
      }
    },
    onError: () => {
      toast.error('Grant search request failed');
    },
  });

  const scrapeMutation = useMutation({
    mutationFn: () =>
      api.post<{ totalFound: number; stored: number; opportunities: GrantOpportunity[] }>(
        '/enrichment/grants/scrape',
        { clientId: selectedClientId || undefined }
      ),
    onSuccess: (result) => {
      if (result.success) {
        setGrants(result.data.opportunities ?? []);
        setHasSearched(true);
        toast.success(`Scrape complete \u2014 ${result.data.totalFound} grants found`);
      } else {
        toast.error('Scrape failed');
      }
    },
    onError: () => {
      toast.error('Scrape request failed');
    },
  });

  const scoreMutation = useMutation({
    mutationFn: (payload: { grant: GrantOpportunity; clientId: string }) =>
      api.post<RiskScoreResult>('/enrichment/grants/score', payload),
    onSuccess: (result, variables) => {
      setScoringGrantKey(null);
      if (result.success) {
        // Update the grant's risk score in state
        setGrants((prev) =>
          prev.map((g) =>
            g.title === variables.grant.title && g.funder === variables.grant.funder
              ? { ...g, riskScore: result.data.score }
              : g
          )
        );
        setRiskDetail({ grant: variables.grant, result: result.data });
        toast.success(`Risk score: ${result.data.score}/100`);
      } else {
        toast.error('Risk scoring failed');
      }
    },
    onError: () => {
      setScoringGrantKey(null);
      toast.error('Risk scoring request failed');
    },
  });

  // ---- Derived data ----

  const openGrants = useMemo(
    () => grants.filter((g) => g.status === 'open' || (!g.status && !g.closeDate)),
    [grants]
  );

  const upcomingGrants = useMemo(
    () => grants.filter((g) => g.status === 'upcoming'),
    [grants]
  );

  const historicGrants = useMemo(
    () => grants.filter((g) => g.status === 'closed'),
    [grants]
  );

  const closingThisWeek = useMemo(
    () => openGrants.filter((g) => {
      const days = daysUntil(g.closeDate ?? g.deadline);
      return days !== null && days >= 0 && days <= 7;
    }),
    [openGrants]
  );

  const avgSuccessRate = useMemo(() => {
    const withRates = grants.filter((g) => g.previousAwards && g.totalApplicants && g.totalApplicants > 0);
    if (withRates.length === 0) return null;
    const total = withRates.reduce(
      (sum, g) => sum + ((g.previousAwards ?? 0) / (g.totalApplicants ?? 1)) * 100,
      0
    );
    return Math.round(total / withRates.length);
  }, [grants]);

  const bestMatchScore = useMemo(() => {
    const scored = grants.filter((g) => g.riskScore !== undefined);
    if (scored.length === 0) return null;
    return Math.max(...scored.map((g) => g.riskScore ?? 0));
  }, [grants]);

  // ---- Risk Map ----

  const riskMapData = useMemo(() => {
    const scored = grants.filter((g) => g.riskScore !== undefined);
    const matrix: Record<string, Record<string, GrantOpportunity[]>> = {
      'Strong Funder': { 'High Match': [], 'Medium Match': [], 'Low Match': [] },
      'Medium Funder': { 'High Match': [], 'Medium Match': [], 'Low Match': [] },
      'New Funder': { 'High Match': [], 'Medium Match': [], 'Low Match': [] },
    };

    const knownFunders = ['The National Lottery Community Fund', 'UK Government', 'Arts Council England', 'Sport England'];

    for (const g of scored) {
      const score = g.riskScore ?? 0;
      const matchLevel = score >= 60 ? 'High Match' : score >= 40 ? 'Medium Match' : 'Low Match';
      const funderLevel = knownFunders.some((kf) => g.funder.toLowerCase().includes(kf.toLowerCase()))
        ? 'Strong Funder'
        : g.previousAwards && g.previousAwards > 10
          ? 'Medium Funder'
          : 'New Funder';
      matrix[funderLevel]![matchLevel]!.push(g);
    }

    return matrix;
  }, [grants]);

  // ---- Handlers ----

  const handleSearch = () => {
    const filters: GrantSearchFilters = {};
    if (clientType) filters.clientType = clientType;
    if (geography) filters.geography = geography;
    if (sector) filters.sector = sector;
    if (selectedClientId) filters.clientId = selectedClientId;
    searchMutation.mutate(filters);
  };

  const handleScoreRisk = (grant: GrantOpportunity) => {
    if (!selectedClientId) {
      toast.error('Select a client first to score risk');
      return;
    }
    const key = `${grant.title}-${grant.funder}`;
    setScoringGrantKey(key);
    scoreMutation.mutate({ grant, clientId: selectedClientId });
  };

  const handleMatchToClient = (grant: GrantOpportunity, clientId: string) => {
    api.post('/enrichment/grants/match', { grantId: grant.id ?? grant.title, clientId }).then((result) => {
      if (result.success) {
        toast.success('Grant matched to client');
      } else {
        toast.error('Failed to match grant');
      }
    });
    setMatchDropdownOpen(null);
  };

  const tabGrants = activeTab === 'open' ? openGrants : activeTab === 'upcoming' ? upcomingGrants : historicGrants;

  // ---- Funder bar chart data for historic tab ----
  const funderAwardStats = useMemo(() => {
    const map: Record<string, { awards: number; applicants: number; avgAward: string }> = {};
    for (const g of historicGrants) {
      if (!map[g.funder]) {
        map[g.funder] = { awards: 0, applicants: 0, avgAward: '' };
      }
      map[g.funder]!.awards += g.previousAwards ?? 0;
      map[g.funder]!.applicants += g.totalApplicants ?? 0;
      if (g.averageAward) map[g.funder]!.avgAward = g.averageAward;
    }
    return Object.entries(map)
      .filter(([, v]) => v.awards > 0)
      .sort((a, b) => b[1].awards - a[1].awards)
      .slice(0, 10);
  }, [historicGrants]);

  const maxAwards = funderAwardStats.length > 0 ? Math.max(...funderAwardStats.map(([, v]) => v.awards)) : 1;

  // ---- Apify scrape results helpers ----

  function cleanDisplayUrl(url: string): string {
    try {
      const u = new URL(url);
      const path = u.pathname.length > 30 ? u.pathname.slice(0, 30) + '...' : u.pathname;
      return u.hostname + path;
    } catch {
      return url.length > 50 ? url.slice(0, 50) + '...' : url;
    }
  }

  function formatScrapeDate(dateStr: string | undefined): string {
    if (!dateStr) return '\u2014';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function truncateText(text: string | undefined, max: number): { text: string; truncated: boolean } {
    if (!text) return { text: '\u2014', truncated: false };
    if (text.length <= max) return { text, truncated: false };
    return { text: text.slice(0, max) + '...', truncated: true };
  }

  // ---- Scrape Results Panel Component ----

  function renderScrapeResultsPanel() {
    const topTabs: { key: ScrapeTopTab; label: string; badge?: number }[] = [
      { key: 'output', label: 'Output', badge: grants.length },
      { key: 'log', label: 'Log' },
      { key: 'storage', label: 'Storage' },
      { key: 'liveView', label: 'Live view' },
    ];

    const subTabs: { key: ScrapeSubTab; label: string }[] = [
      { key: 'overview', label: 'Overview' },
      { key: 'organic', label: 'Organic results' },
      { key: 'paid', label: 'Paid results' },
      { key: 'aiMode', label: 'AI Mode results' },
      { key: 'perplexity', label: 'Perplexity AI search results' },
      { key: 'chatgpt', label: 'ChatGPT search results' },
      { key: 'allFields', label: 'All fields' },
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        {/* Top bar with tabs */}
        <div style={{ display: 'flex', alignItems: 'center', background: '#f5f5f5', borderBottom: '1px solid #e0e0e0', padding: '0 16px', minHeight: '40px' }}>
          {topTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setScrapeTopTab(tab.key)}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 500,
                color: scrapeTopTab === tab.key ? '#202124' : '#5f6368',
                background: scrapeTopTab === tab.key ? '#fff' : 'transparent',
                border: scrapeTopTab === tab.key ? '1px solid #e0e0e0' : '1px solid transparent',
                borderBottom: scrapeTopTab === tab.key ? '1px solid #fff' : '1px solid transparent',
                borderRadius: scrapeTopTab === tab.key ? '6px 6px 0 0' : '6px 6px 0 0',
                marginBottom: scrapeTopTab === tab.key ? '-1px' : '0',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                position: 'relative',
              }}
            >
              {tab.label}
              {tab.badge !== undefined && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '20px',
                  height: '20px',
                  borderRadius: '10px',
                  background: '#1a73e8',
                  color: '#fff',
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '0 6px',
                }}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content area for Output tab */}
        {scrapeTopTab === 'output' ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Sub-tabs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0', borderBottom: '1px solid #e0e0e0', padding: '0 16px', background: '#fff', overflowX: 'auto' }}>
              {subTabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setScrapeSubTab(tab.key)}
                  style={{
                    padding: '10px 14px',
                    fontSize: '13px',
                    fontWeight: scrapeSubTab === tab.key ? 600 : 400,
                    color: scrapeSubTab === tab.key ? '#1a73e8' : '#5f6368',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: scrapeSubTab === tab.key ? '2px solid #1a73e8' : '2px solid transparent',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Table */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {scrapeSubTab === 'overview' ? (
                <div style={{ padding: '32px', color: '#5f6368', fontSize: '14px' }}>
                  <div style={{ marginBottom: '16px' }}>
                    <span style={{ fontWeight: 600, color: '#202124' }}>Run status:</span>{' '}
                    <span style={{ color: '#188038', fontWeight: 500 }}>SUCCEEDED</span>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ fontWeight: 600, color: '#202124' }}>Results:</span> {grants.length} items
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ fontWeight: 600, color: '#202124' }}>Dataset:</span> default
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ fontWeight: 600, color: '#202124' }}>Run time:</span> ~{Math.max(1, Math.round(grants.length * 0.8))}s
                  </div>
                </div>
              ) : scrapeSubTab === 'allFields' ? (
                <div style={{ padding: '16px', overflow: 'auto' }}>
                  <pre style={{ fontSize: '12px', fontFamily: '"SF Mono", "Fira Code", "Fira Mono", Menlo, monospace', color: '#202124', background: '#f8f9fa', padding: '16px', borderRadius: '6px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(grants, null, 2)}
                  </pre>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e0e0e0', background: '#fff' }}>
                      <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 500, color: '#5f6368', fontSize: '12px', whiteSpace: 'nowrap' }}>#</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 500, color: '#5f6368', fontSize: '12px', minWidth: '200px' }}>Title</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 500, color: '#5f6368', fontSize: '12px', minWidth: '180px' }}>URL</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 500, color: '#5f6368', fontSize: '12px', minWidth: '250px' }}>Description</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 500, color: '#5f6368', fontSize: '12px', minWidth: '150px' }}>Displayed URL</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 500, color: '#5f6368', fontSize: '12px', whiteSpace: 'nowrap' }}>Emphasized keywords</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 500, color: '#5f6368', fontSize: '12px', whiteSpace: 'nowrap' }}>Site links</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 500, color: '#5f6368', fontSize: '12px', whiteSpace: 'nowrap' }}>Date</th>
                      <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 500, color: '#5f6368', fontSize: '12px', whiteSpace: 'nowrap' }}>Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grants.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ textAlign: 'center', padding: '48px 16px', color: '#9aa0a6', fontSize: '14px' }}>
                          No results. Run a scrape or search to populate data.
                        </td>
                      </tr>
                    ) : (
                      grants.map((grant, idx) => {
                        const titleTrunc = truncateText(grant.title, 60);
                        const descTrunc = truncateText(grant.description ?? grant.eligibility, 120);
                        const displayUrl = cleanDisplayUrl(grant.url);
                        const keywordCount = grant.sectors?.length ?? 0;
                        const isExpanded = expandedScrapeRow === idx;

                        return (
                          <React.Fragment key={`scrape-${idx}`}>
                            <tr style={{ borderBottom: '1px solid #e8eaed', minHeight: '80px', verticalAlign: 'top' }}>
                              <td style={{ padding: '12px 12px', color: '#5f6368', fontSize: '13px' }}>{idx + 1}</td>
                              <td style={{ padding: '12px 12px', maxWidth: '260px' }}>
                                <div style={{ color: '#202124', fontWeight: 500, fontSize: '14px', lineHeight: '1.4' }}>
                                  {titleTrunc.text}
                                  {titleTrunc.truncated && (
                                    <button
                                      onClick={() => setExpandedScrapeRow(isExpanded ? null : idx)}
                                      style={{ display: 'inline', marginLeft: '4px', color: '#5f6368', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: 0 }}
                                      title="Show more"
                                    >
                                      ...
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td style={{ padding: '12px 12px', maxWidth: '200px' }}>
                                <a
                                  href={grant.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ color: '#1a73e8', textDecoration: 'none', fontSize: '13px', wordBreak: 'break-all' }}
                                >
                                  {grant.url.length > 60 ? grant.url.slice(0, 60) + '...' : grant.url}
                                </a>
                              </td>
                              <td style={{ padding: '12px 12px', maxWidth: '300px' }}>
                                <div style={{ color: '#3c4043', fontSize: '13px', lineHeight: '1.5' }}>
                                  {descTrunc.text}
                                  {descTrunc.truncated && (
                                    <button
                                      onClick={() => setExpandedScrapeRow(isExpanded ? null : idx)}
                                      style={{ display: 'inline', marginLeft: '4px', color: '#5f6368', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: 0 }}
                                      title="Show more"
                                    >
                                      ...
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td style={{ padding: '12px 12px', maxWidth: '180px' }}>
                                <span style={{ color: '#5f6368', fontSize: '12px' }}>{displayUrl}</span>
                              </td>
                              <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                                {keywordCount > 0 ? (
                                  <a
                                    href="#"
                                    onClick={(e) => { e.preventDefault(); setExpandedScrapeRow(isExpanded ? null : idx); }}
                                    style={{ color: '#1a73e8', textDecoration: 'none', fontSize: '13px' }}
                                  >
                                    {keywordCount} items
                                  </a>
                                ) : (
                                  <span style={{ color: '#9aa0a6', fontSize: '13px' }}>0 items</span>
                                )}
                              </td>
                              <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                                <span style={{ color: '#9aa0a6', fontSize: '13px' }}>0 items</span>
                              </td>
                              <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                                <span style={{ color: '#5f6368', fontSize: '12px', fontFamily: '"SF Mono", "Fira Code", monospace' }}>
                                  {formatScrapeDate(grant.scrapedAt)}
                                </span>
                              </td>
                              <td style={{ padding: '12px 12px', textAlign: 'center' }}>
                                <button
                                  onClick={() => setExpandedScrapeRow(isExpanded ? null : idx)}
                                  style={{
                                    background: isExpanded ? '#e8f0fe' : '#f1f3f4',
                                    border: '1px solid ' + (isExpanded ? '#1a73e8' : '#dadce0'),
                                    borderRadius: '4px',
                                    padding: '4px 10px',
                                    cursor: 'pointer',
                                    color: isExpanded ? '#1a73e8' : '#5f6368',
                                    fontSize: '12px',
                                    fontWeight: 500,
                                  }}
                                >
                                  {isExpanded ? 'Close' : 'Preview'}
                                </button>
                              </td>
                            </tr>
                            {/* Expanded preview row */}
                            {isExpanded && (
                              <tr style={{ borderBottom: '1px solid #e8eaed', background: '#f8f9fa' }}>
                                <td colSpan={9} style={{ padding: '16px 24px' }}>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 32px', fontSize: '13px' }}>
                                    <div>
                                      <div style={{ fontWeight: 600, color: '#202124', marginBottom: '4px' }}>Full Title</div>
                                      <div style={{ color: '#3c4043' }}>{grant.title}</div>
                                    </div>
                                    <div>
                                      <div style={{ fontWeight: 600, color: '#202124', marginBottom: '4px' }}>Funder</div>
                                      <div style={{ color: '#3c4043' }}>{grant.funder}</div>
                                    </div>
                                    <div>
                                      <div style={{ fontWeight: 600, color: '#202124', marginBottom: '4px' }}>Full URL</div>
                                      <a href={grant.url} target="_blank" rel="noopener noreferrer" style={{ color: '#1a73e8', textDecoration: 'none', wordBreak: 'break-all' }}>
                                        {grant.url}
                                      </a>
                                    </div>
                                    <div>
                                      <div style={{ fontWeight: 600, color: '#202124', marginBottom: '4px' }}>Amount</div>
                                      <div style={{ color: '#3c4043' }}>{grant.amount ?? '\u2014'}</div>
                                    </div>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                      <div style={{ fontWeight: 600, color: '#202124', marginBottom: '4px' }}>Full Description</div>
                                      <div style={{ color: '#3c4043', lineHeight: '1.6' }}>{grant.description ?? grant.eligibility ?? '\u2014'}</div>
                                    </div>
                                    <div>
                                      <div style={{ fontWeight: 600, color: '#202124', marginBottom: '4px' }}>Open Date</div>
                                      <div style={{ color: '#3c4043' }}>{formatDate(grant.openDate)}</div>
                                    </div>
                                    <div>
                                      <div style={{ fontWeight: 600, color: '#202124', marginBottom: '4px' }}>Close Date / Deadline</div>
                                      <div style={{ color: '#3c4043' }}>{formatDate(grant.closeDate ?? grant.deadline)}</div>
                                    </div>
                                    <div>
                                      <div style={{ fontWeight: 600, color: '#202124', marginBottom: '4px' }}>Status</div>
                                      <div style={{ color: '#3c4043' }}>{grant.status ?? 'open'}</div>
                                    </div>
                                    <div>
                                      <div style={{ fontWeight: 600, color: '#202124', marginBottom: '4px' }}>Source</div>
                                      <div style={{ color: '#3c4043' }}>{grant.source}</div>
                                    </div>
                                    {grant.sectors && grant.sectors.length > 0 && (
                                      <div style={{ gridColumn: '1 / -1' }}>
                                        <div style={{ fontWeight: 600, color: '#202124', marginBottom: '4px' }}>Sectors / Keywords</div>
                                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                          {grant.sectors.map((s, si) => (
                                            <span key={si} style={{ background: '#e8f0fe', color: '#1a73e8', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 500 }}>
                                              {s}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {grant.riskScore !== undefined && (
                                      <div>
                                        <div style={{ fontWeight: 600, color: '#202124', marginBottom: '4px' }}>Risk Score</div>
                                        <div style={{ color: riskColor(grant.riskScore), fontWeight: 600 }}>{grant.riskScore}/100 ({riskLabel(grant.riskScore)})</div>
                                      </div>
                                    )}
                                    <div>
                                      <div style={{ fontWeight: 600, color: '#202124', marginBottom: '4px' }}>Scraped At</div>
                                      <div style={{ color: '#3c4043', fontFamily: '"SF Mono", monospace', fontSize: '12px' }}>{formatScrapeDate(grant.scrapedAt)}</div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : scrapeTopTab === 'log' ? (
          <div style={{ flex: 1, padding: '16px', background: '#1e1e1e', color: '#d4d4d4', fontFamily: '"SF Mono", "Fira Code", monospace', fontSize: '12px', overflow: 'auto' }}>
            <div style={{ marginBottom: '4px' }}><span style={{ color: '#6a9955' }}>INFO</span> {'  '}Scrape started at {formatScrapeDate(grants[0]?.scrapedAt ?? new Date().toISOString())}</div>
            <div style={{ marginBottom: '4px' }}><span style={{ color: '#6a9955' }}>INFO</span> {'  '}Navigating to grant portals...</div>
            {grants.slice(0, 10).map((g, i) => (
              <div key={i} style={{ marginBottom: '4px' }}><span style={{ color: '#569cd6' }}>DEBUG</span> Extracted: {g.title.slice(0, 80)}</div>
            ))}
            <div style={{ marginBottom: '4px' }}><span style={{ color: '#6a9955' }}>INFO</span> {'  '}Total results: {grants.length}</div>
            <div style={{ marginBottom: '4px' }}><span style={{ color: '#6a9955' }}>INFO</span> {'  '}Scrape completed successfully.</div>
          </div>
        ) : scrapeTopTab === 'storage' ? (
          <div style={{ flex: 1, padding: '32px', color: '#5f6368', fontSize: '14px' }}>
            <div style={{ marginBottom: '16px', fontWeight: 600, color: '#202124', fontSize: '16px' }}>Dataset: default</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
              <div style={{ background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px' }}>
                <div style={{ fontSize: '12px', color: '#5f6368', marginBottom: '4px' }}>Items</div>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#202124' }}>{grants.length}</div>
              </div>
              <div style={{ background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px' }}>
                <div style={{ fontSize: '12px', color: '#5f6368', marginBottom: '4px' }}>Size</div>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#202124' }}>{Math.round(JSON.stringify(grants).length / 1024)} KB</div>
              </div>
              <div style={{ background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px' }}>
                <div style={{ fontSize: '12px', color: '#5f6368', marginBottom: '4px' }}>Format</div>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#202124' }}>JSON</div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9aa0a6', fontSize: '14px' }}>
            Live view not available for completed runs.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-[#e5e7eb] bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-semibold text-slate-900">Grant Discovery</h1>
            <p className="text-[11px] text-slate-500 mt-1">
              Search open grant opportunities across UK funding portals
            </p>
          </div>
          {/* View mode toggle */}
          <div style={{ display: 'flex', background: '#f1f3f4', borderRadius: '8px', padding: '3px', gap: '2px' }}>
            <button
              onClick={() => setViewMode('discovery')}
              style={{
                padding: '6px 16px',
                fontSize: '13px',
                fontWeight: 500,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'discovery' ? '#fff' : 'transparent',
                color: viewMode === 'discovery' ? '#202124' : '#5f6368',
                boxShadow: viewMode === 'discovery' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              Discovery
            </button>
            <button
              onClick={() => setViewMode('scrapeResults')}
              style={{
                padding: '6px 16px',
                fontSize: '13px',
                fontWeight: 500,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'scrapeResults' ? '#fff' : 'transparent',
                color: viewMode === 'scrapeResults' ? '#202124' : '#5f6368',
                boxShadow: viewMode === 'scrapeResults' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              Scrape Results
              {grants.length > 0 && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '18px',
                  height: '18px',
                  borderRadius: '9px',
                  background: '#1a73e8',
                  color: '#fff',
                  fontSize: '10px',
                  fontWeight: 600,
                  padding: '0 5px',
                }}>
                  {grants.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Scrape Results view */}
      {viewMode === 'scrapeResults' && (
        <div className="flex-1 overflow-hidden">
          {renderScrapeResultsPanel()}
        </div>
      )}

      {/* Discovery view - existing content */}
      {viewMode === 'discovery' && hasSearched && grants.length > 0 && (
        <div className="px-6 py-3 bg-white border-b border-[#e5e7eb]">
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-white border border-[#e5e7eb] rounded-[6px] px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500 uppercase">Total Open Grants</div>
              <div className="text-[22px] font-bold mt-1" style={{ color: '#2563eb' }}>
                {openGrants.length}
              </div>
            </div>
            <div className="bg-white border border-[#e5e7eb] rounded-[6px] px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500 uppercase">Closing This Week</div>
              <div className="text-[22px] font-bold mt-1" style={{ color: '#ef4444' }}>
                {closingThisWeek.length}
              </div>
            </div>
            <div className="bg-white border border-[#e5e7eb] rounded-[6px] px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500 uppercase">Avg Success Rate</div>
              <div className="text-[22px] font-bold mt-1" style={{ color: '#22c55e' }}>
                {avgSuccessRate !== null ? `${avgSuccessRate}%` : '\u2014'}
              </div>
            </div>
            <div className="bg-white border border-[#e5e7eb] rounded-[6px] px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500 uppercase">Best Match Score</div>
              <div className="text-[22px] font-bold mt-1" style={{ color: '#f59e0b' }}>
                {bestMatchScore !== null ? `${bestMatchScore}/100` : '\u2014'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search bar */}
      {viewMode === 'discovery' && <div className="px-6 py-4 bg-white border-b border-[#e5e7eb]">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 max-w-[180px]">
            <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">Client</label>
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="w-full h-8 px-2 text-[13px] border border-slate-300 rounded-[6px] bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
            >
              <option value="">Select client...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 max-w-[150px]">
            <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">Client Type</label>
            <select
              value={clientType}
              onChange={(e) => setClientType(e.target.value)}
              className="w-full h-8 px-2 text-[13px] border border-slate-300 rounded-[6px] bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
            >
              <option value="">All types</option>
              <option value="CIC">CIC</option>
              <option value="charity">Charity</option>
              <option value="social_enterprise">Social Enterprise</option>
            </select>
          </div>
          <div className="flex-1 max-w-[180px]">
            <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">Geography</label>
            <input
              type="text"
              value={geography}
              onChange={(e) => setGeography(e.target.value)}
              placeholder="e.g. North West England"
              className="w-full h-8 px-2 text-[13px] border border-slate-300 rounded-[6px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
            />
          </div>
          <div className="flex-1 max-w-[180px]">
            <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">Sector</label>
            <input
              type="text"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              placeholder="e.g. Youth services"
              className="w-full h-8 px-2 text-[13px] border border-slate-300 rounded-[6px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searchMutation.isPending}
            className="h-8 px-4 bg-[#2563eb] text-white text-[13px] font-medium rounded-[6px] hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {searchMutation.isPending && <Spinner className="h-3.5 w-3.5 text-white" />}
            Search Grants
          </button>
          {isAdmin && (
            <button
              onClick={() => scrapeMutation.mutate()}
              disabled={scrapeMutation.isPending}
              className="h-8 px-4 border border-slate-300 text-[13px] font-medium text-slate-700 rounded-[6px] hover:bg-slate-50 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {scrapeMutation.isPending && <Spinner className="h-3.5 w-3.5 text-slate-500" />}
              Scrape All Portals
            </button>
          )}
        </div>
      </div>}

      {/* Tabs */}
      {viewMode === 'discovery' && <div className="px-6 bg-white border-b border-[#e5e7eb]">
        <div className="flex gap-0">
          {([
            { key: 'open' as TabKey, label: 'Open Grants', count: openGrants.length },
            { key: 'upcoming' as TabKey, label: 'Upcoming', count: upcomingGrants.length },
            { key: 'historic' as TabKey, label: 'Historic', count: historicGrants.length },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-[#2563eb] text-[#2563eb]'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
              {hasSearched && (
                <span className="ml-1.5 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>}

      {/* Results */}
      {viewMode === 'discovery' && <div className="flex-1 overflow-auto">
        {!hasSearched && grants.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-[13px] text-slate-400">
                Search for grants or scrape funding portals to discover opportunities
              </p>
              <p className="text-[11px] text-slate-300 mt-1">
                Select a client above to enable risk scoring
              </p>
            </div>
          </div>
        ) : tabGrants.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-[13px] text-slate-400">
              {activeTab === 'open' && 'No open grants found'}
              {activeTab === 'upcoming' && 'No upcoming grants found'}
              {activeTab === 'historic' && 'No historic grants found'}
            </p>
          </div>
        ) : (
          <div>
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-[#e5e7eb]">
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-[11px]">Title</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-[11px]">Funder</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 text-[11px]">Amount</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-[11px]">Opens</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-[11px]">
                    {activeTab === 'upcoming' ? 'Opens In' : 'Closes'}
                  </th>
                  {activeTab !== 'upcoming' && (
                    <th className="text-left px-3 py-2 font-semibold text-slate-600 text-[11px]">
                      {activeTab === 'historic' ? 'Closed' : 'Days Left'}
                    </th>
                  )}
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-[11px] w-[80px]">Risk</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-[11px]">Status</th>
                  {activeTab === 'historic' && (
                    <>
                      <th className="text-right px-3 py-2 font-semibold text-slate-600 text-[11px]">Awards</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-600 text-[11px]">Applicants</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-600 text-[11px]">Avg Award</th>
                    </>
                  )}
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-[11px] w-[140px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tabGrants.map((grant, idx) => {
                  const grantKey = `${grant.title}-${grant.funder}`;
                  const closeDays = daysUntil(grant.closeDate ?? grant.deadline);
                  const openDays = daysUntil(grant.openDate);
                  const closedDays = daysSince(grant.closeDate ?? grant.deadline);
                  const isScoring = scoringGrantKey === grantKey;

                  return (
                    <tr key={`${grantKey}-${idx}`} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-1.5 font-medium text-slate-800 max-w-[220px]">
                        <a
                          href={grant.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-[#2563eb] hover:underline"
                        >
                          {grant.title}
                        </a>
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">{grant.funder}</td>
                      <td className="px-3 py-1.5 text-right text-slate-600 font-mono text-[12px]">
                        {grant.amount ?? '\u2014'}
                      </td>
                      <td className="px-3 py-1.5 text-slate-500 text-[12px]">
                        {formatDate(grant.openDate)}
                      </td>
                      <td className="px-3 py-1.5 text-slate-500 text-[12px]">
                        {activeTab === 'upcoming' ? (
                          openDays !== null ? (
                            <span className="text-[#2563eb] font-medium">{openDays}d</span>
                          ) : '\u2014'
                        ) : (
                          formatDate(grant.closeDate ?? grant.deadline)
                        )}
                      </td>
                      {activeTab !== 'upcoming' && (
                        <td className="px-3 py-1.5 text-[12px]">
                          {activeTab === 'historic' ? (
                            closedDays !== null ? (
                              <span className="text-slate-400">{closedDays}d ago</span>
                            ) : '\u2014'
                          ) : closeDays !== null ? (
                            <span
                              className="font-semibold"
                              style={{
                                color: closeDays < 7 ? '#ef4444' : closeDays < 14 ? '#f59e0b' : '#22c55e',
                              }}
                            >
                              {closeDays}d
                            </span>
                          ) : '\u2014'}
                        </td>
                      )}
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <div
                            className="h-2 rounded-full"
                            style={{
                              width: '60px',
                              backgroundColor: '#e5e7eb',
                            }}
                          >
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: grant.riskScore !== undefined ? `${grant.riskScore}%` : '0%',
                                backgroundColor: riskColor(grant.riskScore),
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-slate-500 w-[14px] text-right">
                            {grant.riskScore ?? '\u2014'}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        {statusBadge(grant.status)}
                      </td>
                      {activeTab === 'historic' && (
                        <>
                          <td className="px-3 py-1.5 text-right text-slate-600 text-[12px]">
                            {grant.previousAwards ?? '\u2014'}
                          </td>
                          <td className="px-3 py-1.5 text-right text-slate-600 text-[12px]">
                            {grant.totalApplicants ?? '\u2014'}
                          </td>
                          <td className="px-3 py-1.5 text-right text-slate-600 text-[12px]">
                            {grant.averageAward ?? '\u2014'}
                          </td>
                        </>
                      )}
                      <td className="px-3 py-1.5 relative">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleScoreRisk(grant)}
                            disabled={isScoring || !selectedClientId}
                            className="px-2 py-1 border border-slate-300 text-[10px] font-medium text-slate-600 rounded hover:bg-slate-50 transition-colors disabled:opacity-40 flex items-center gap-1"
                            title={!selectedClientId ? 'Select a client first' : 'Score risk for this grant'}
                          >
                            {isScoring ? <Spinner className="h-3 w-3 text-slate-400" /> : null}
                            Score
                          </button>
                          <button
                            onClick={() => setMatchDropdownOpen(matchDropdownOpen === grantKey ? null : grantKey)}
                            className="px-2 py-1 border border-slate-300 text-[10px] font-medium text-slate-600 rounded hover:bg-slate-50 transition-colors"
                          >
                            Match
                          </button>
                        </div>
                        {matchDropdownOpen === grantKey && (
                          <div className="absolute right-3 top-8 z-20 w-48 bg-white border border-[#e5e7eb] rounded-[6px] shadow-lg py-1 max-h-48 overflow-auto">
                            {clients.length === 0 ? (
                              <div className="px-3 py-2 text-[10px] text-slate-400 italic">No clients available</div>
                            ) : (
                              clients.map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() => handleMatchToClient(grant, c.id)}
                                  className="w-full text-left px-3 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors"
                                >
                                  {c.name}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Historic tab: Awards by funder bar chart */}
            {activeTab === 'historic' && funderAwardStats.length > 0 && (
              <div className="px-6 py-5 border-t border-[#e5e7eb]">
                <h3 className="text-[13px] font-semibold text-slate-700 mb-3">Awards by Funder</h3>
                <div className="space-y-2">
                  {funderAwardStats.map(([funder, stats]) => (
                    <div key={funder} className="flex items-center gap-3">
                      <div className="w-[180px] text-[11px] text-slate-600 truncate text-right">{funder}</div>
                      <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
                        <div
                          className="h-full rounded transition-all"
                          style={{
                            width: `${(stats.awards / maxAwards) * 100}%`,
                            backgroundColor: '#2563eb',
                            minWidth: '2px',
                          }}
                        />
                      </div>
                      <div className="w-[60px] text-[11px] text-slate-500 text-right">{stats.awards} awards</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risk Map section */}
            {grants.some((g) => g.riskScore !== undefined) && (
              <div className="px-6 py-5 border-t border-[#e5e7eb]">
                <h3 className="text-[13px] font-semibold text-slate-700 mb-3">Risk Map</h3>
                <div className="bg-white border border-[#e5e7eb] rounded-[6px] overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="px-3 py-2 text-left text-slate-500 font-medium" />
                        <th className="px-3 py-2 text-center text-slate-600 font-semibold">High Match</th>
                        <th className="px-3 py-2 text-center text-slate-600 font-semibold">Medium Match</th>
                        <th className="px-3 py-2 text-center text-slate-600 font-semibold">Low Match</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(riskMapData).map(([funderLevel, matches]) => (
                        <tr key={funderLevel} className="border-t border-[#e5e7eb]">
                          <td className="px-3 py-2 font-medium text-slate-600">{funderLevel}</td>
                          {['High Match', 'Medium Match', 'Low Match'].map((matchLevel, colIdx) => {
                            const cellGrants = matches[matchLevel] ?? [];
                            const rowIdx = funderLevel === 'Strong Funder' ? 0 : funderLevel === 'Medium Funder' ? 1 : 2;
                            // Color gradient: green top-left to red bottom-right
                            const intensity = (rowIdx + colIdx) / 4;
                            const bgColor = cellGrants.length > 0
                              ? `rgba(${Math.round(34 + intensity * 205)}, ${Math.round(197 - intensity * 129)}, ${Math.round(94 - intensity * 26)}, 0.15)`
                              : 'transparent';

                            return (
                              <td
                                key={matchLevel}
                                className="px-3 py-2 text-center"
                                style={{ backgroundColor: bgColor }}
                              >
                                {cellGrants.length > 0 ? (
                                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white border border-[#e5e7eb] text-[12px] font-semibold text-slate-700">
                                    {cellGrants.length}
                                  </span>
                                ) : (
                                  <span className="text-slate-300">\u2014</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>}

      {/* Risk detail modal */}
      {riskDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setRiskDetail(null)}
        >
          <div
            className="bg-white rounded-[6px] border border-[#e5e7eb] shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#e5e7eb]">
              <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-semibold text-slate-900">Risk Assessment</h3>
                <button
                  onClick={() => setRiskDetail(null)}
                  className="text-slate-400 hover:text-slate-600 text-lg"
                >
                  x
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">{riskDetail.grant.title}</p>
            </div>
            <div className="px-5 py-4">
              {/* Score display */}
              <div className="flex items-center gap-4 mb-4">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center text-white text-[20px] font-bold"
                  style={{ backgroundColor: riskColor(riskDetail.result.score) }}
                >
                  {riskDetail.result.score}
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-slate-800">
                    {riskLabel(riskDetail.result.score)}
                  </div>
                  <div className="text-[12px] text-slate-500 mt-0.5 max-w-[340px]">
                    {riskDetail.result.reasoning}
                  </div>
                </div>
              </div>

              {/* Factors */}
              <div className="space-y-2">
                {riskDetail.result.factors.map((factor, i) => (
                  <div key={i} className="bg-slate-50 rounded-[6px] px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-medium text-slate-700">{factor.factor}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400">{factor.weight}%</span>
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                          style={{
                            backgroundColor:
                              factor.impact === 'positive' ? '#dcfce7' :
                              factor.impact === 'negative' ? '#fef2f2' : '#f3f4f6',
                            color:
                              factor.impact === 'positive' ? '#166534' :
                              factor.impact === 'negative' ? '#991b1b' : '#6b7280',
                          }}
                        >
                          {factor.impact}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">{factor.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useMemo } from 'react';
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-[#e5e7eb] bg-white">
        <h1 className="text-[18px] font-semibold text-slate-900">Grant Discovery</h1>
        <p className="text-[11px] text-slate-500 mt-1">
          Search open grant opportunities across UK funding portals
        </p>
      </div>

      {/* Stats tiles */}
      {hasSearched && grants.length > 0 && (
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
      <div className="px-6 py-4 bg-white border-b border-[#e5e7eb]">
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
      </div>

      {/* Tabs */}
      <div className="px-6 bg-white border-b border-[#e5e7eb]">
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
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto">
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
      </div>

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

import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, API_BASE } from '../../lib/api';
import { useSessionStore } from '../../stores/session';
import { toast } from 'sonner';

// ---- Types ----

interface GrantRecord {
  id: string;
  title: string;
  funder: string;
  url: string;
  amount: string | null;
  deadline: string | null;
  eligibility: string | null;
  description: string | null;
  source: string;
  scraped_at: string;
  open_date: string | null;
  close_date: string | null;
  status: string;
  previous_awards: number | null;
  total_applicants: number | null;
  average_award: string | null;
  sectors: string[] | null;
  daysRemaining: number | null;
  ragStatus: 'red' | 'amber' | 'green' | 'grey';
}

interface GrantDatabaseData {
  grants: GrantRecord[];
  stats: {
    total: number;
    open: number;
    closingThisWeek: number;
    closed: number;
    lastScrapedAt: string | null;
  };
  sources: string[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

interface ScrapeResultData {
  totalFound: number;
  newGrants: number;
  updatedGrants: number;
  totalInDatabase: number;
}

interface Filters {
  status: string;
  eligibleFor: string;
  closingWithin: string;
  source: string;
  search: string;
  page: number;
}

// ---- Helpers ----

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
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

// ---- Sort helpers ----

type SortKey = 'title' | 'funder' | 'amount' | 'open_date' | 'close_date' | 'daysRemaining' | 'source';
type SortDir = 'asc' | 'desc';

function compareGrants(a: GrantRecord, b: GrantRecord, key: SortKey, dir: SortDir): number {
  let aVal: string | number | null = null;
  let bVal: string | number | null = null;

  switch (key) {
    case 'title': aVal = a.title.toLowerCase(); bVal = b.title.toLowerCase(); break;
    case 'funder': aVal = a.funder.toLowerCase(); bVal = b.funder.toLowerCase(); break;
    case 'amount': aVal = a.amount ?? ''; bVal = b.amount ?? ''; break;
    case 'open_date': aVal = a.open_date ?? ''; bVal = b.open_date ?? ''; break;
    case 'close_date': aVal = a.close_date ?? ''; bVal = b.close_date ?? ''; break;
    case 'daysRemaining': aVal = a.daysRemaining ?? 99999; bVal = b.daysRemaining ?? 99999; break;
    case 'source': aVal = a.source.toLowerCase(); bVal = b.source.toLowerCase(); break;
  }

  if (aVal === null && bVal === null) return 0;
  if (aVal === null) return 1;
  if (bVal === null) return -1;

  const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
  return dir === 'asc' ? cmp : -cmp;
}

// ---- Component ----

export default function GrantDatabasePage() {
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<Filters>({
    status: 'all',
    eligibleFor: '',
    closingWithin: '',
    source: '',
    search: '',
    page: 1,
  });

  const [sortKey, setSortKey] = useState<SortKey>('daysRemaining');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const buildQueryParams = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.status !== 'all') params.set('status', filters.status);
    if (filters.eligibleFor) params.set('eligibleFor', filters.eligibleFor);
    if (filters.closingWithin) params.set('closingWithin', filters.closingWithin);
    if (filters.source) params.set('source', filters.source);
    if (filters.search) params.set('search', filters.search);
    params.set('page', String(filters.page));
    params.set('limit', '50');
    return params.toString();
  }, [filters]);

  const accessToken = useSessionStore((s) => s.accessToken);

  const { data: dbResult, isLoading, isFetching } = useQuery({
    queryKey: ['grant-database', filters],
    queryFn: async () => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

      const res = await fetch(`${API_BASE}/enrichment/grants/database?${buildQueryParams()}`, { headers });
      if (!res.ok) return { grants: [], stats: { total: 0, open: 0, closingThisWeek: 0, closed: 0, lastScrapedAt: null }, sources: [], pagination: { page: 1, limit: 50, total: 0 } } as GrantDatabaseData;

      const json = await res.json() as { success: boolean; data: GrantRecord[]; stats: GrantDatabaseData['stats']; sources: string[]; pagination: GrantDatabaseData['pagination'] };
      if (json.success) {
        return { grants: json.data ?? [], stats: json.stats, sources: json.sources ?? [], pagination: json.pagination } as GrantDatabaseData;
      }
      return { grants: [], stats: { total: 0, open: 0, closingThisWeek: 0, closed: 0, lastScrapedAt: null }, sources: [], pagination: { page: 1, limit: 50, total: 0 } } as GrantDatabaseData;
    },
    placeholderData: (prev: GrantDatabaseData | undefined) => prev,
  });

  const scrapeMutation = useMutation({
    mutationFn: () => api.post<ScrapeResultData>('/enrichment/grants/scrape', {}),
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Scrape complete: ${result.data.newGrants} new, ${result.data.updatedGrants} updated`);
        queryClient.invalidateQueries({ queryKey: ['grant-database'] });
      }
    },
    onError: () => toast.error('Grant scrape failed'),
  });

  const grants = dbResult?.grants ?? [];
  const stats = dbResult?.stats ?? { total: 0, open: 0, closingThisWeek: 0, closed: 0, lastScrapedAt: null };
  const sources = dbResult?.sources ?? [];
  const pagination = dbResult?.pagination ?? { page: 1, limit: 50, total: 0 };
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.limit));

  // Client-side sort
  const sortedGrants = [...grants].sort((a, b) => compareGrants(a, b, sortKey, sortDir));

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const clearFilters = () => {
    setFilters({ status: 'all', eligibleFor: '', closingWithin: '', source: '', search: '', page: 1 });
  };

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' \u2191' : ' \u2193';
  };

  // ---- RAG helpers ----

  const ragBg = (rag: string) => {
    switch (rag) {
      case 'red': return '#fee2e2';
      case 'amber': return '#fef3c7';
      case 'green': return '#d1fae5';
      default: return '#f3f4f6';
    }
  };

  const ragText = (rag: string) => {
    switch (rag) {
      case 'red': return '#991b1b';
      case 'amber': return '#92400e';
      case 'green': return '#065f46';
      default: return '#6b7280';
    }
  };

  const ragCircle = (rag: string) => {
    const fill = rag === 'red' ? '#ef4444' : rag === 'amber' ? '#f59e0b' : rag === 'green' ? '#22c55e' : 'transparent';
    const stroke = rag === 'grey' ? '#9ca3af' : fill;
    return (
      <svg width="12" height="12" viewBox="0 0 12 12">
        <circle cx="6" cy="6" r="5" fill={fill} stroke={stroke} strokeWidth="1" />
      </svg>
    );
  };

  const daysDisplay = (grant: GrantRecord) => {
    if (grant.daysRemaining === null || grant.status === 'closed') {
      return (
        <span
          className="inline-flex items-center justify-center px-2 py-0.5 rounded text-[11px] font-medium"
          style={{ backgroundColor: '#f3f4f6', color: '#6b7280' }}
        >
          N/A
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center justify-center px-2 py-0.5 rounded text-[11px] font-medium"
        style={{ backgroundColor: ragBg(grant.ragStatus), color: ragText(grant.ragStatus) }}
      >
        {grant.daysRemaining}d
      </span>
    );
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: '#f8f9fb' }}>
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-[#e5e7eb] bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-semibold text-slate-900">Grant Database</h1>
            <p className="text-[11px] text-slate-500 mt-1">
              {stats.total} grants stored — last scraped {formatRelativeTime(stats.lastScrapedAt)}
            </p>
          </div>
          <Link
            to="/grants"
            className="text-[13px] font-medium text-blue-600 hover:text-blue-800 transition-colors"
          >
            &larr; Back to Discovery
          </Link>
        </div>
      </div>

      <div className="px-6 py-4 space-y-4">
        {/* Stats tiles */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total Grants', value: stats.total, bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af' },
            { label: 'Open Now', value: stats.open, bg: '#f0fdf4', border: '#bbf7d0', color: '#166534' },
            { label: 'Closing This Week', value: stats.closingThisWeek, bg: '#fef2f2', border: '#fecaca', color: '#991b1b' },
            { label: 'Closed', value: stats.closed, bg: '#f9fafb', border: '#e5e7eb', color: '#6b7280' },
          ].map((tile) => (
            <div
              key={tile.label}
              className="px-4 py-3 rounded-md"
              style={{ backgroundColor: tile.bg, border: `1px solid ${tile.border}` }}
            >
              <div className="text-[11px] font-medium" style={{ color: tile.color }}>
                {tile.label}
              </div>
              <div className="text-[22px] font-bold mt-1" style={{ color: tile.color }}>
                {tile.value}
              </div>
            </div>
          ))}
        </div>

        {/* Filter bar */}
        <div
          className="flex flex-wrap items-center gap-2 p-3 rounded-md bg-white"
          style={{ border: '1px solid #e5e7eb' }}
        >
          {/* Status */}
          <select
            className="h-8 px-2 text-[12px] rounded border border-[#e5e7eb] bg-white text-slate-700 outline-none"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="upcoming">Upcoming</option>
            <option value="closed">Closed</option>
          </select>

          {/* Eligible For */}
          <select
            className="h-8 px-2 text-[12px] rounded border border-[#e5e7eb] bg-white text-slate-700 outline-none"
            value={filters.eligibleFor}
            onChange={(e) => setFilters((f) => ({ ...f, eligibleFor: e.target.value, page: 1 }))}
          >
            <option value="">All Types</option>
            <option value="CIC">CIC</option>
            <option value="charity">Charity</option>
            <option value="social enterprise">Social Enterprise</option>
            <option value="community group">Community Group</option>
          </select>

          {/* Closing Within */}
          <select
            className="h-8 px-2 text-[12px] rounded border border-[#e5e7eb] bg-white text-slate-700 outline-none"
            value={filters.closingWithin}
            onChange={(e) => setFilters((f) => ({ ...f, closingWithin: e.target.value, page: 1 }))}
          >
            <option value="">Any time</option>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </select>

          {/* Source */}
          <select
            className="h-8 px-2 text-[12px] rounded border border-[#e5e7eb] bg-white text-slate-700 outline-none"
            value={filters.source}
            onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value, page: 1 }))}
          >
            <option value="">All Sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Search */}
          <input
            type="text"
            placeholder="Search title or description..."
            className="h-8 px-3 text-[12px] rounded border border-[#e5e7eb] bg-white text-slate-700 outline-none flex-1 min-w-[180px]"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))}
          />

          {/* Clear Filters */}
          <button
            className="h-8 px-3 text-[12px] rounded border border-[#e5e7eb] text-slate-500 hover:bg-slate-50 transition-colors"
            onClick={clearFilters}
          >
            Clear Filters
          </button>

          {/* Refresh Database */}
          <button
            className="h-8 px-3 text-[12px] rounded font-medium text-white transition-colors flex items-center gap-1.5"
            style={{ backgroundColor: scrapeMutation.isPending ? '#94a3b8' : '#2563eb' }}
            onClick={() => scrapeMutation.mutate()}
            disabled={scrapeMutation.isPending}
          >
            {scrapeMutation.isPending && <Spinner className="h-3 w-3" />}
            {scrapeMutation.isPending ? 'Scraping...' : 'Refresh Database'}
          </button>
        </div>

        {/* Main table */}
        <div
          className="bg-white rounded-md overflow-hidden"
          style={{ border: '1px solid #e5e7eb' }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner className="h-5 w-5 text-blue-600" />
              <span className="ml-2 text-[13px] text-slate-500">Loading grants...</span>
            </div>
          ) : sortedGrants.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-[13px] text-slate-500">No grants found matching your filters.</p>
              <p className="text-[11px] text-slate-400 mt-1">Try adjusting filters or run a scrape to populate the database.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-[#e5e7eb]" style={{ backgroundColor: '#f9fafb' }}>
                      {[
                        { key: 'title' as SortKey, label: 'Title', width: '' },
                        { key: 'funder' as SortKey, label: 'Funder', width: 'w-[140px]' },
                        { key: 'amount' as SortKey, label: 'Amount', width: 'w-[100px]' },
                        { key: 'open_date' as SortKey, label: 'Opens', width: 'w-[90px]' },
                        { key: 'close_date' as SortKey, label: 'Closes', width: 'w-[90px]' },
                        { key: 'daysRemaining' as SortKey, label: 'Days Left', width: 'w-[80px]' },
                      ].map((col) => (
                        <th
                          key={col.key}
                          className={`px-3 py-2 text-[11px] font-medium text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700 select-none ${col.width}`}
                          onClick={() => handleSort(col.key)}
                        >
                          {col.label}{sortArrow(col.key)}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-[11px] font-medium text-slate-500 uppercase tracking-wide w-[40px]">RAG</th>
                      <th className="px-3 py-2 text-[11px] font-medium text-slate-500 uppercase tracking-wide w-[120px]">Eligibility</th>
                      <th
                        className="px-3 py-2 text-[11px] font-medium text-slate-500 uppercase tracking-wide w-[100px] cursor-pointer hover:text-slate-700 select-none"
                        onClick={() => handleSort('source')}
                      >
                        Source{sortArrow('source')}
                      </th>
                      <th className="px-3 py-2 text-[11px] font-medium text-slate-500 uppercase tracking-wide w-[120px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedGrants.map((grant) => (
                      <React.Fragment key={grant.id}>
                        <tr
                          className="border-b border-[#f1f5f9] hover:bg-[#f8fafc] cursor-pointer transition-colors"
                          onClick={() => setExpandedRow(expandedRow === grant.id ? null : grant.id)}
                        >
                          <td className="px-3 py-2.5">
                            <div className="text-[13px] font-medium text-slate-800 line-clamp-1">{grant.title}</div>
                          </td>
                          <td className="px-3 py-2.5 text-[12px] text-slate-600">{grant.funder}</td>
                          <td className="px-3 py-2.5 text-[12px] text-slate-600 font-medium">{grant.amount ?? '\u2014'}</td>
                          <td className="px-3 py-2.5 text-[11px] text-slate-500">{formatDate(grant.open_date)}</td>
                          <td className="px-3 py-2.5 text-[11px] text-slate-500">{formatDate(grant.close_date)}</td>
                          <td className="px-3 py-2.5">{daysDisplay(grant)}</td>
                          <td className="px-3 py-2.5">{ragCircle(grant.ragStatus)}</td>
                          <td className="px-3 py-2.5 text-[11px] text-slate-500 line-clamp-1">{grant.eligibility ?? '\u2014'}</td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                              {grant.source}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <a
                                href={grant.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2 py-1 text-[11px] font-medium rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                              >
                                Apply
                              </a>
                              <button className="px-2 py-1 text-[11px] font-medium rounded bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors">
                                Match
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Expanded detail row */}
                        {expandedRow === grant.id && (
                          <tr className="bg-[#fafbfc]">
                            <td colSpan={10} className="px-6 py-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">Description</div>
                                  <p className="text-[12px] text-slate-700 leading-relaxed">
                                    {grant.description ?? 'No description available.'}
                                  </p>
                                </div>
                                <div className="space-y-3">
                                  <div>
                                    <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">Eligibility</div>
                                    <p className="text-[12px] text-slate-700">{grant.eligibility ?? 'Not specified'}</p>
                                  </div>
                                  {grant.sectors && grant.sectors.length > 0 && (
                                    <div>
                                      <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">Sectors</div>
                                      <div className="flex flex-wrap gap-1">
                                        {grant.sectors.map((s: string) => (
                                          <span key={s} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">
                                            {s}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <div className="flex gap-4">
                                    {grant.previous_awards !== null && (
                                      <div>
                                        <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Prev. Awards</div>
                                        <div className="text-[13px] font-medium text-slate-800">{grant.previous_awards}</div>
                                      </div>
                                    )}
                                    {grant.total_applicants !== null && (
                                      <div>
                                        <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Applicants</div>
                                        <div className="text-[13px] font-medium text-slate-800">{grant.total_applicants}</div>
                                      </div>
                                    )}
                                    {grant.average_award && (
                                      <div>
                                        <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Avg. Award</div>
                                        <div className="text-[13px] font-medium text-slate-800">{grant.average_award}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="mt-3 pt-3 border-t border-[#e5e7eb] flex items-center gap-2">
                                <span className="text-[10px] text-slate-400">
                                  Status: {grant.status} | Scraped: {formatDate(grant.scraped_at)} | ID: {grant.id}
                                </span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-[#e5e7eb]">
                <div className="text-[11px] text-slate-500">
                  Showing {((pagination.page - 1) * pagination.limit) + 1}
                  &ndash;{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
                  {isFetching && <span className="ml-2 text-blue-500">Updating...</span>}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="px-2 py-1 text-[11px] rounded border border-[#e5e7eb] text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={filters.page <= 1}
                    onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
                  >
                    Prev
                  </button>
                  <span className="px-2 text-[11px] text-slate-500">
                    Page {filters.page} of {totalPages}
                  </span>
                  <button
                    className="px-2 py-1 text-[11px] rounded border border-[#e5e7eb] text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={filters.page >= totalPages}
                    onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Bottom section: Source info + Auto-scrape status */}
        <div className="grid grid-cols-2 gap-4">
          {/* Grant Sources */}
          <div
            className="bg-white rounded-md p-4"
            style={{ border: '1px solid #e5e7eb' }}
          >
            <h3 className="text-[13px] font-semibold text-slate-800 mb-3">Grant Sources</h3>
            {sources.length === 0 ? (
              <p className="text-[12px] text-slate-400">No sources yet. Run a scrape to populate.</p>
            ) : (
              <div className="space-y-2">
                {sources.map((src: string) => {
                  const count = grants.filter((g: GrantRecord) => g.source === src).length;
                  return (
                    <div key={src} className="flex items-center justify-between py-1.5 border-b border-[#f1f5f9] last:border-0">
                      <span className="text-[12px] text-slate-700 font-medium">{src}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-slate-400">Last scraped: {formatRelativeTime(stats.lastScrapedAt)}</span>
                        <span className="text-[11px] font-medium text-slate-600">{count} grants</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Auto-Scrape Status */}
          <div
            className="bg-white rounded-md p-4"
            style={{ border: '1px solid #e5e7eb' }}
          >
            <h3 className="text-[13px] font-semibold text-slate-800 mb-3">Auto-Scrape Status</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-1.5">
                <span className="text-[12px] text-slate-600">Status</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700">
                  Enabled
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-t border-[#f1f5f9]">
                <span className="text-[12px] text-slate-600">Schedule</span>
                <span className="text-[12px] text-slate-800 font-medium">Daily (every 24h)</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-t border-[#f1f5f9]">
                <span className="text-[12px] text-slate-600">Last Run</span>
                <span className="text-[12px] text-slate-800">{formatRelativeTime(stats.lastScrapedAt)}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-t border-[#f1f5f9]">
                <span className="text-[12px] text-slate-600">Next Run</span>
                <span className="text-[12px] text-slate-800">
                  {stats.lastScrapedAt
                    ? formatDate(new Date(new Date(stats.lastScrapedAt).getTime() + 24 * 60 * 60 * 1000).toISOString())
                    : 'Pending first scrape'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-t border-[#f1f5f9]">
                <span className="text-[12px] text-slate-600">Grants in DB</span>
                <span className="text-[12px] text-slate-800 font-medium">{stats.total}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

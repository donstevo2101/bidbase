import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { toast } from 'sonner';
import { useSessionStore } from '../../stores/session';

// ---- Types ----

interface OpenRound {
  name: string;
  opens?: string;
  closes: string | null;
}

interface ThreeSixtyStats {
  source: string;
  totalGrants: number;
  grantsToOrgs: number;
  grantsToIndividuals: number;
  totalToOrgs: number;
  totalToIndividuals: number;
  latestAward: string | null;
  earliestAward: string | null;
  grantNavUrl: string;
  syncedAt: string;
}

interface Funder {
  id: string;
  organisation_id: string | null;
  name: string;
  website: string | null;
  grant_range_min: number | null;
  grant_range_max: number | null;
  eligible_structures: string[];
  eligible_geographies: string[];
  open_rounds: OpenRound[];
  notes: string | null;
  requires_preregistration: boolean;
  preregistration_lead_weeks: number | null;
  rejection_gap_months: number | null;
  verified: boolean;
  last_updated: string;
  created_at: string;
}

type SortField = 'name' | 'grants' | 'total' | 'latest';
type SortDir = 'asc' | 'desc';
type FunderType = '' | 'Foundation' | 'Trust' | 'Government' | 'Lottery' | 'Corporate';
type GrantSize = '' | 'under10k' | '10k-50k' | '50k-250k' | 'over250k';

// ---- Helpers ----

function parse360Stats(notes: string | null): ThreeSixtyStats | null {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes);
    if (parsed && parsed.source === '360giving') return parsed as ThreeSixtyStats;
    return null;
  } catch {
    return null;
  }
}

function formatGBP(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return '-';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatGrantRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return '-';
  if (min !== null && max !== null) return `${formatGBP(min)} - ${formatGBP(max)}`;
  if (min !== null) return `From ${formatGBP(min)}`;
  return `Up to ${formatGBP(max)}`;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('en-GB').format(value);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

// ---- Component ----

const PAGE_SIZE = 20;

export default function FundersPage() {
  const queryClient = useQueryClient();
  useSessionStore(); // auth context

  const [search, setSearch] = useState('');
  const [funderType, setFunderType] = useState<FunderType>('');
  const [grantSize, setGrantSize] = useState<GrantSize>('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch all funders (we filter/sort client-side for responsiveness)
  const { data: fundersData, isLoading } = useQuery({
    queryKey: ['funders', 'all'],
    queryFn: async () => {
      // Fetch all pages worth of funders
      const result = await api.paginated<Funder>('/funders?page=1&limit=500');
      if (!result.success) return [];
      return result.data;
    },
  });

  const allFunders = fundersData ?? [];

  // Sync 360Giving mutation
  const sync360Mutation = useMutation({
    mutationFn: () => api.post<{ totalFetched: number; created: number; updated: number }>(
      '/enrichment/funders/sync-360giving', {}
    ),
    onSuccess: (result) => {
      if (result.success) {
        const d = result.data;
        toast.success(`360Giving sync complete: ${d.created} new, ${d.updated} updated`);
        queryClient.invalidateQueries({ queryKey: ['funders'] });
      } else {
        toast.error('360Giving sync failed');
      }
    },
    onError: () => toast.error('360Giving sync failed'),
  });

  // Scrape grant portals mutation
  const scrapeMutation = useMutation({
    mutationFn: () => api.post<unknown>('/enrichment/grants/scrape', {}),
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Grant portal scrape complete');
        queryClient.invalidateQueries({ queryKey: ['funders'] });
      } else {
        toast.error('Grant portal scrape failed');
      }
    },
    onError: () => toast.error('Grant portal scrape failed'),
  });

  // Filter and sort funders
  const filteredFunders = useMemo(() => {
    let result = [...allFunders];

    // Search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((f) =>
        f.name.toLowerCase().includes(q) ||
        (f.website && f.website.toLowerCase().includes(q))
      );
    }

    // Funder type filter (check name heuristics)
    if (funderType) {
      const ft = funderType.toLowerCase();
      result = result.filter((f) => {
        const nameLower = f.name.toLowerCase();
        const notesLower = (f.notes ?? '').toLowerCase();
        switch (ft) {
          case 'foundation': return nameLower.includes('foundation');
          case 'trust': return nameLower.includes('trust');
          case 'government': return nameLower.includes('government') || nameLower.includes('council') || nameLower.includes('department') || nameLower.includes('ministry');
          case 'lottery': return nameLower.includes('lottery');
          case 'corporate': return nameLower.includes('corporate') || notesLower.includes('corporate');
          default: return true;
        }
      });
    }

    // Grant size filter
    if (grantSize) {
      result = result.filter((f) => {
        const min = f.grant_range_min ?? 0;
        const max = f.grant_range_max ?? 0;
        const stats = parse360Stats(f.notes);
        const totalValue = stats ? stats.totalToOrgs + stats.totalToIndividuals : max;

        switch (grantSize) {
          case 'under10k': return max > 0 ? max <= 10000 : totalValue <= 10000;
          case '10k-50k': return (min <= 50000 && max >= 10000) || (totalValue >= 10000 && totalValue <= 50000);
          case '50k-250k': return (min <= 250000 && max >= 50000) || (totalValue >= 50000 && totalValue <= 250000);
          case 'over250k': return max >= 250000 || totalValue >= 250000;
          default: return true;
        }
      });
    }

    // Sort
    result.sort((a, b) => {
      const statsA = parse360Stats(a.notes);
      const statsB = parse360Stats(b.notes);
      let cmp = 0;

      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'grants':
          cmp = (statsA?.totalGrants ?? 0) - (statsB?.totalGrants ?? 0);
          break;
        case 'total':
          cmp = ((statsA?.totalToOrgs ?? 0) + (statsA?.totalToIndividuals ?? 0)) -
                ((statsB?.totalToOrgs ?? 0) + (statsB?.totalToIndividuals ?? 0));
          break;
        case 'latest': {
          const dateA = statsA?.latestAward ?? a.last_updated ?? '';
          const dateB = statsB?.latestAward ?? b.last_updated ?? '';
          cmp = dateA.localeCompare(dateB);
          break;
        }
      }

      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [allFunders, search, funderType, grantSize, sortField, sortDir]);

  // Pagination
  const totalPages = Math.ceil(filteredFunders.length / PAGE_SIZE);
  const paginatedFunders = filteredFunders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Stats
  const stats = useMemo(() => {
    const totalFunders = allFunders.length;
    const withOpenRounds = allFunders.filter((f) => (f.open_rounds ?? []).length > 0).length;
    let totalGrantsAwarded = 0;
    let totalValue = 0;

    for (const f of allFunders) {
      const s = parse360Stats(f.notes);
      if (s) {
        totalGrantsAwarded += s.totalGrants;
        totalValue += s.totalToOrgs + s.totalToIndividuals;
      }
    }

    return { totalFunders, withOpenRounds, totalGrantsAwarded, totalValue };
  }, [allFunders]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'name' ? 'asc' : 'desc');
    }
  }

  function sortIndicator(field: SortField): string {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  }

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Funder Database</h1>
            <p className="text-xs text-slate-500 mt-0.5">340+ UK grant funders with historical award data</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => sync360Mutation.mutate()}
              disabled={sync360Mutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {sync360Mutation.isPending ? 'Syncing...' : 'Sync 360Giving Data'}
            </button>
            <button
              onClick={() => scrapeMutation.mutate()}
              disabled={scrapeMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              {scrapeMutation.isPending ? 'Scraping...' : 'Scrape Grant Portals'}
            </button>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="px-6 py-3 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search funders by name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
          <select
            value={funderType}
            onChange={(e) => { setFunderType(e.target.value as FunderType); setPage(1); }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Funder Type: All</option>
            <option value="Foundation">Foundation</option>
            <option value="Trust">Trust</option>
            <option value="Government">Government</option>
            <option value="Lottery">Lottery</option>
            <option value="Corporate">Corporate</option>
          </select>
          <select
            value={grantSize}
            onChange={(e) => { setGrantSize(e.target.value as GrantSize); setPage(1); }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Grant Size: Any</option>
            <option value="under10k">Under &pound;10k</option>
            <option value="10k-50k">&pound;10k - &pound;50k</option>
            <option value="50k-250k">&pound;50k - &pound;250k</option>
            <option value="over250k">Over &pound;250k</option>
          </select>
          <select
            value={`${sortField}-${sortDir}`}
            onChange={(e) => {
              const [f, d] = e.target.value.split('-') as [SortField, SortDir];
              setSortField(f);
              setSortDir(d);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="name-asc">Sort: A-Z</option>
            <option value="grants-desc">Sort: Most Grants</option>
            <option value="total-desc">Sort: Highest Total</option>
            <option value="latest-desc">Sort: Latest Award</option>
          </select>
          {(search || funderType || grantSize) && (
            <button
              onClick={() => { setSearch(''); setFunderType(''); setGrantSize(''); setPage(1); }}
              className="text-xs text-slate-500 hover:text-slate-700 underline whitespace-nowrap"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <div className="px-6 py-3 border-b border-slate-200 bg-white">
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
            <p className="text-[11px] font-medium text-blue-600 uppercase tracking-wider">Total Funders</p>
            <p className="text-lg font-semibold text-blue-800 mt-0.5">{formatNumber(stats.totalFunders)}</p>
          </div>
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2">
            <p className="text-[11px] font-medium text-green-600 uppercase tracking-wider">With Open Rounds</p>
            <p className="text-lg font-semibold text-green-800 mt-0.5">{formatNumber(stats.withOpenRounds)}</p>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-[11px] font-medium text-amber-600 uppercase tracking-wider">Total Grants Awarded</p>
            <p className="text-lg font-semibold text-amber-800 mt-0.5">{formatNumber(stats.totalGrantsAwarded)}</p>
          </div>
          <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2">
            <p className="text-[11px] font-medium text-teal-600 uppercase tracking-wider">Total Value (GBP)</p>
            <p className="text-lg font-semibold text-teal-800 mt-0.5">{formatGBP(stats.totalValue)}</p>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <p className="text-xs text-slate-400">Loading funders...</p>
          </div>
        ) : paginatedFunders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <p className="text-sm text-slate-500 font-medium">No funders found</p>
            <p className="text-xs text-slate-400">
              {search || funderType || grantSize
                ? 'Try adjusting your search or filters.'
                : 'Sync 360Giving data or scrape grant portals to populate the database.'}
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-md mx-6 mt-3 mb-3 overflow-hidden">
            <table className="w-full text-[13px] data-grid">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th
                    className="text-left px-3 py-2 font-semibold text-slate-600 text-[11px] uppercase tracking-wider cursor-pointer hover:text-slate-800 select-none"
                    onClick={() => handleSort('name')}
                  >
                    Funder Name{sortIndicator('name')}
                  </th>
                  <th
                    className="text-right px-3 py-2 font-semibold text-slate-600 text-[11px] uppercase tracking-wider cursor-pointer hover:text-slate-800 select-none"
                    onClick={() => handleSort('grants')}
                  >
                    Grants{sortIndicator('grants')}
                  </th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 text-[11px] uppercase tracking-wider">To Orgs</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 text-[11px] uppercase tracking-wider">To Individuals</th>
                  <th
                    className="text-right px-3 py-2 font-semibold text-slate-600 text-[11px] uppercase tracking-wider cursor-pointer hover:text-slate-800 select-none"
                    onClick={() => handleSort('total')}
                  >
                    Total to Orgs (&pound;){sortIndicator('total')}
                  </th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 text-[11px] uppercase tracking-wider">Total to Individuals (&pound;)</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-[11px] uppercase tracking-wider">Grant Range</th>
                  <th className="text-center px-3 py-2 font-semibold text-slate-600 text-[11px] uppercase tracking-wider">Open Rounds</th>
                  <th
                    className="text-left px-3 py-2 font-semibold text-slate-600 text-[11px] uppercase tracking-wider cursor-pointer hover:text-slate-800 select-none"
                    onClick={() => handleSort('latest')}
                  >
                    Latest Award{sortIndicator('latest')}
                  </th>
                  <th className="text-center px-3 py-2 font-semibold text-slate-600 text-[11px] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedFunders.map((funder) => {
                  const stats360 = parse360Stats(funder.notes);
                  const openRoundsCount = (funder.open_rounds ?? []).length;
                  const isExpanded = expandedId === funder.id;

                  return (
                    <FunderRow
                      key={funder.id}
                      funder={funder}
                      stats360={stats360}
                      openRoundsCount={openRoundsCount}
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedId(isExpanded ? null : funder.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {filteredFunders.length > PAGE_SIZE && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-white">
          <p className="text-xs text-slate-500">
            Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filteredFunders.length)} of {filteredFunders.length}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="px-2 text-xs text-slate-500">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Funder Row Sub-component ----

function FunderRow({
  funder,
  stats360,
  openRoundsCount,
  isExpanded,
  onToggle,
}: {
  funder: Funder;
  stats360: ThreeSixtyStats | null;
  openRoundsCount: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
        {/* Funder Name */}
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-slate-800 text-[13px]">{funder.name}</span>
            {funder.verified && (
              <span className="inline-flex items-center rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-medium text-emerald-700">
                Verified
              </span>
            )}
            {funder.organisation_id === null && (
              <span className="inline-flex items-center rounded bg-purple-100 px-1 py-0.5 text-[10px] font-medium text-purple-700">
                Platform
              </span>
            )}
          </div>
          {funder.website && (
            <a
              href={funder.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline text-[11px] block mt-0.5 truncate max-w-[240px]"
            >
              {funder.website.replace(/^https?:\/\//, '')}
            </a>
          )}
          {(funder.eligible_structures ?? []).length > 0 && (
            <div className="flex flex-wrap gap-0.5 mt-1">
              {funder.eligible_structures.map((s) => (
                <span key={s} className="inline-flex items-center rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-500">
                  {s}
                </span>
              ))}
            </div>
          )}
        </td>

        {/* Grants */}
        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">
          {stats360 ? formatNumber(stats360.totalGrants) : '-'}
        </td>

        {/* To Orgs */}
        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">
          {stats360 ? formatNumber(stats360.grantsToOrgs) : '-'}
        </td>

        {/* To Individuals */}
        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">
          {stats360 ? formatNumber(stats360.grantsToIndividuals) : '-'}
        </td>

        {/* Total to Orgs */}
        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">
          {stats360 ? formatGBP(stats360.totalToOrgs) : '-'}
        </td>

        {/* Total to Individuals */}
        <td className="px-3 py-2 text-right text-slate-700 tabular-nums">
          {stats360 ? formatGBP(stats360.totalToIndividuals) : '-'}
        </td>

        {/* Grant Range */}
        <td className="px-3 py-2 text-slate-700 text-[12px]">
          {formatGrantRange(funder.grant_range_min, funder.grant_range_max)}
        </td>

        {/* Open Rounds */}
        <td className="px-3 py-2 text-center">
          <span
            className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
              openRoundsCount > 0
                ? 'bg-green-100 text-green-700'
                : 'bg-slate-100 text-slate-500'
            }`}
          >
            {openRoundsCount}
          </span>
        </td>

        {/* Latest Award */}
        <td className="px-3 py-2 text-slate-700 text-[12px]">
          {stats360 ? formatDate(stats360.latestAward) : formatDate(funder.last_updated)}
        </td>

        {/* Actions */}
        <td className="px-3 py-2 text-center">
          <div className="flex items-center justify-center gap-2">
            {stats360?.grantNavUrl && (
              <a
                href={stats360.grantNavUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-700 text-[11px] font-medium hover:underline"
              >
                Explore
              </a>
            )}
            <button
              onClick={onToggle}
              className="text-slate-500 hover:text-slate-700 text-[11px] font-medium hover:underline"
            >
              {isExpanded ? 'Hide' : 'Details'}
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded Detail Row */}
      {isExpanded && (
        <tr className="border-b border-slate-100 bg-slate-50/80">
          <td colSpan={10} className="px-3 py-3">
            <div className="grid grid-cols-3 gap-4 text-[12px]">
              {/* Description / Notes */}
              <div>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Notes</p>
                {stats360 ? (
                  <div className="text-slate-600 space-y-1">
                    <p>Source: 360Giving GrantNav</p>
                    {stats360.earliestAward && <p>Earliest award: {formatDate(stats360.earliestAward)}</p>}
                    {stats360.latestAward && <p>Latest award: {formatDate(stats360.latestAward)}</p>}
                    {stats360.syncedAt && <p className="text-slate-400">Last synced: {formatDate(stats360.syncedAt)}</p>}
                  </div>
                ) : (
                  <p className="text-slate-400">No additional notes</p>
                )}
              </div>

              {/* Open Rounds */}
              <div>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Open Rounds</p>
                {(funder.open_rounds ?? []).length > 0 ? (
                  <ul className="space-y-1">
                    {funder.open_rounds.map((round, i) => (
                      <li key={i} className="text-slate-600">
                        <span className="font-medium">{round.name}</span>
                        {round.closes && <span className="text-slate-400 ml-1">closes {formatDate(round.closes)}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-400">No open rounds</p>
                )}
              </div>

              {/* Eligibility & Meta */}
              <div>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Eligibility</p>
                <div className="space-y-1 text-slate-600">
                  {(funder.eligible_structures ?? []).length > 0 && (
                    <p>Structures: {funder.eligible_structures.join(', ')}</p>
                  )}
                  {(funder.eligible_geographies ?? []).length > 0 && (
                    <p>Geographies: {funder.eligible_geographies.join(', ')}</p>
                  )}
                  {funder.requires_preregistration && (
                    <p className="text-amber-600">
                      Pre-registration required
                      {funder.preregistration_lead_weeks && ` (${funder.preregistration_lead_weeks} weeks lead)`}
                    </p>
                  )}
                  {funder.rejection_gap_months && (
                    <p>Rejection gap: {funder.rejection_gap_months} months</p>
                  )}
                  {funder.verified && (
                    <span className="inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 mt-1">
                      Verified funder data
                    </span>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

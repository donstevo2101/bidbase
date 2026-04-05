import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { toast } from 'sonner';

// ---- Types ----

interface Funder {
  id: string;
  organisation_id: string | null;
  name: string;
  website: string | null;
  grant_range_min: number | null;
  grant_range_max: number | null;
  eligible_structures: string[];
  eligible_geographies: string[];
  open_rounds: { name: string; opens: string; closes: string }[];
  notes: string | null;
  requires_preregistration: boolean;
  preregistration_lead_weeks: number | null;
  rejection_gap_months: number | null;
  verified: boolean;
  last_updated: string;
  created_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface

interface CreateFunderPayload {
  name: string;
  website?: string;
  grantRangeMin?: number;
  grantRangeMax?: number;
  eligibleStructures?: string[];
  eligibleGeographies?: string[];
  notes?: string;
  requiresPreregistration?: boolean;
  preregistrationLeadWeeks?: number;
  rejectionGapMonths?: number;
}

// ---- Helpers ----

const STRUCTURE_OPTIONS = ['CIC', 'Charity', 'Social Enterprise', 'Unincorporated', 'Other'];
const GEOGRAPHY_OPTIONS = ['England', 'Scotland', 'Wales', 'Northern Ireland', 'UK-wide', 'Regional'];

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(value);
}

function formatGrantRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return '-';
  if (min !== null && max !== null) return `${formatCurrency(min)} - ${formatCurrency(max)}`;
  if (min !== null) return `From ${formatCurrency(min)}`;
  return `Up to ${formatCurrency(max)}`;
}

// ---- Component ----

export default function FundersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [structureFilter, setStructureFilter] = useState('');
  const [geographyFilter, setGeographyFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showAddForm, setShowAddForm] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formWebsite, setFormWebsite] = useState('');
  const [formGrantMin, setFormGrantMin] = useState('');
  const [formGrantMax, setFormGrantMax] = useState('');
  const [formStructures, setFormStructures] = useState<string[]>([]);
  const [formGeographies, setFormGeographies] = useState<string[]>([]);
  const [formNotes, setFormNotes] = useState('');
  const [formPreregistration, setFormPreregistration] = useState(false);
  const [formPreregWeeks, setFormPreregWeeks] = useState('');
  const [formRejectionGap, setFormRejectionGap] = useState('');

  // Build query string for list endpoint
  const queryParams = new URLSearchParams();
  queryParams.set('page', String(page));
  queryParams.set('limit', '25');
  if (search) queryParams.set('search', search);

  const { data: fundersData, isLoading } = useQuery({
    queryKey: ['funders', page, search, structureFilter, geographyFilter],
    queryFn: async () => {
      // Use search endpoint if filters are applied, otherwise list endpoint
      if (structureFilter || geographyFilter) {
        const filterParams = new URLSearchParams();
        if (structureFilter) filterParams.set('structure', structureFilter);
        if (geographyFilter) filterParams.set('geography', geographyFilter);
        if (search) filterParams.set('search', search);
        const result = await api.get<Funder[]>(`/funders/search?${filterParams.toString()}`);
        if (result.success) {
          return { data: result.data, pagination: { page: 1, limit: 100, total: result.data.length } };
        }
        return { data: [], pagination: { page: 1, limit: 25, total: 0 } };
      }
      const result = await api.paginated<Funder>(`/funders?${queryParams.toString()}`);
      if (!result.success) return { data: [], pagination: { page: 1, limit: 25, total: 0 } };
      return { data: result.data, pagination: result.pagination };
    },
  });

  const funders = fundersData?.data ?? [];
  const pagination = fundersData?.pagination ?? { page: 1, limit: 25, total: 0 };
  const totalPages = Math.ceil(pagination.total / pagination.limit);

  const createMutation = useMutation({
    mutationFn: (payload: CreateFunderPayload) => api.post<Funder>('/funders', payload),
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Funder added successfully');
        queryClient.invalidateQueries({ queryKey: ['funders'] });
        resetForm();
        setShowAddForm(false);
      } else {
        toast.error('Failed to add funder');
      }
    },
    onError: () => {
      toast.error('Failed to add funder');
    },
  });

  function resetForm() {
    setFormName('');
    setFormWebsite('');
    setFormGrantMin('');
    setFormGrantMax('');
    setFormStructures([]);
    setFormGeographies([]);
    setFormNotes('');
    setFormPreregistration(false);
    setFormPreregWeeks('');
    setFormRejectionGap('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error('Funder name is required');
      return;
    }

    const payload: CreateFunderPayload = {
      name: formName.trim(),
    };
    if (formWebsite.trim()) payload.website = formWebsite.trim();
    if (formGrantMin) payload.grantRangeMin = parseFloat(formGrantMin);
    if (formGrantMax) payload.grantRangeMax = parseFloat(formGrantMax);
    if (formStructures.length > 0) payload.eligibleStructures = formStructures;
    if (formGeographies.length > 0) payload.eligibleGeographies = formGeographies;
    if (formNotes.trim()) payload.notes = formNotes.trim();
    payload.requiresPreregistration = formPreregistration;
    if (formPreregWeeks) payload.preregistrationLeadWeeks = parseInt(formPreregWeeks, 10);
    if (formRejectionGap) payload.rejectionGapMonths = parseInt(formRejectionGap, 10);

    createMutation.mutate(payload);
  }

  function toggleArrayValue(arr: string[], value: string, setter: (v: string[]) => void) {
    if (arr.includes(value)) {
      setter(arr.filter((v) => v !== value));
    } else {
      setter([...arr, value]);
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white">
        <h1 className="text-lg font-semibold text-slate-800">Funder Database</h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <span className="text-sm leading-none">+</span> Add Funder
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-200 bg-slate-50">
        <input
          type="text"
          placeholder="Search funders..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="rounded border border-slate-300 px-3 py-1.5 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        />
        <select
          value={structureFilter}
          onChange={(e) => { setStructureFilter(e.target.value); setPage(1); }}
          className="rounded border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">All Structures</option>
          {STRUCTURE_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={geographyFilter}
          onChange={(e) => { setGeographyFilter(e.target.value); setPage(1); }}
          className="rounded border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">All Geographies</option>
          {GEOGRAPHY_OPTIONS.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        {(search || structureFilter || geographyFilter) && (
          <button
            onClick={() => { setSearch(''); setStructureFilter(''); setGeographyFilter(''); setPage(1); }}
            className="text-xs text-slate-500 hover:text-slate-700 underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Data Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <p className="text-xs text-slate-400">Loading funders...</p>
          </div>
        ) : funders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <p className="text-sm text-slate-500 font-medium">No funders found</p>
            <p className="text-xs text-slate-400">
              {search || structureFilter || geographyFilter
                ? 'Try adjusting your search or filters.'
                : 'Add your first funder to get started.'}
            </p>
          </div>
        ) : (
          <>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600 uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600 uppercase tracking-wider">Grant Range</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600 uppercase tracking-wider">Eligible Structures</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600 uppercase tracking-wider">Eligible Geographies</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-slate-600 uppercase tracking-wider">Open Rounds</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-slate-600 uppercase tracking-wider">Pre-registration</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-slate-600 uppercase tracking-wider">Verified</th>
                </tr>
              </thead>
              <tbody>
                {funders.map((funder: Funder) => (
                  <tr key={funder.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">{funder.name}</span>
                        {funder.organisation_id === null && (
                          <span className="inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                            Platform
                          </span>
                        )}
                      </div>
                      {funder.website && (
                        <a
                          href={funder.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:underline text-[10px]"
                        >
                          {funder.website}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {formatGrantRange(funder.grant_range_min, funder.grant_range_max)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {(funder.eligible_structures ?? []).map((s: string) => (
                          <span key={s} className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                            {s}
                          </span>
                        ))}
                        {(!funder.eligible_structures || funder.eligible_structures.length === 0) && (
                          <span className="text-slate-400">-</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {(funder.eligible_geographies ?? []).map((g: string) => (
                          <span key={g} className="inline-flex items-center rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                            {g}
                          </span>
                        ))}
                        {(!funder.eligible_geographies || funder.eligible_geographies.length === 0) && (
                          <span className="text-slate-400">-</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center text-slate-700">
                      {(funder.open_rounds ?? []).length}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {funder.requires_preregistration ? (
                        <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                          No
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {funder.verified ? (
                        <span className="inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                          Verified
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-white">
                <p className="text-xs text-slate-500">
                  Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
                  {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                  {pagination.total} funders
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="px-2 text-xs text-slate-500">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Funder Form */}
      {showAddForm && (
        <div className="border-t border-slate-200 bg-white px-6 py-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Add New Funder</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Name */}
            <div>
              <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g. National Lottery Community Fund"
                required
              />
            </div>

            {/* Website */}
            <div>
              <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">Website</label>
              <input
                type="url"
                value={formWebsite}
                onChange={(e) => setFormWebsite(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://..."
              />
            </div>

            {/* Grant Range */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">Grant Min</label>
                <input
                  type="number"
                  value={formGrantMin}
                  onChange={(e) => setFormGrantMin(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="0"
                  min="0"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">Grant Max</label>
                <input
                  type="number"
                  value={formGrantMax}
                  onChange={(e) => setFormGrantMax(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="0"
                  min="0"
                />
              </div>
            </div>

            {/* Eligible Structures */}
            <div>
              <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">Eligible Structures</label>
              <div className="flex flex-wrap gap-1.5">
                {STRUCTURE_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleArrayValue(formStructures, s, setFormStructures)}
                    className={`rounded border px-2 py-1 text-[10px] font-medium transition-colors ${
                      formStructures.includes(s)
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Eligible Geographies */}
            <div>
              <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">Eligible Geographies</label>
              <div className="flex flex-wrap gap-1.5">
                {GEOGRAPHY_OPTIONS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleArrayValue(formGeographies, g, setFormGeographies)}
                    className={`rounded border px-2 py-1 text-[10px] font-medium transition-colors ${
                      formGeographies.includes(g)
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* Pre-registration + Rejection Gap */}
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={formPreregistration}
                  onChange={(e) => setFormPreregistration(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Pre-registration required
              </label>
              {formPreregistration && (
                <div className="flex-1">
                  <input
                    type="number"
                    value={formPreregWeeks}
                    onChange={(e) => setFormPreregWeeks(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Lead weeks"
                    min="0"
                  />
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="md:col-span-2">
              <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">Notes</label>
              <textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={2}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none"
                placeholder="Additional notes about this funder..."
              />
            </div>

            {/* Rejection Gap */}
            <div>
              <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">Rejection Gap (months)</label>
              <input
                type="number"
                value={formRejectionGap}
                onChange={(e) => setFormRejectionGap(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Months before reapplication"
                min="0"
              />
            </div>

            {/* Actions */}
            <div className="md:col-span-3 flex items-center gap-2 pt-2">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {createMutation.isPending ? 'Saving...' : 'Save Funder'}
              </button>
              <button
                type="button"
                onClick={() => { resetForm(); setShowAddForm(false); }}
                className="rounded border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

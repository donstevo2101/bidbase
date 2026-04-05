import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { toast } from 'sonner';
import { Plus, Search, ChevronLeft, ChevronRight } from 'lucide-react';

interface Organisation {
  id: string;
  name: string;
  slug: string;
  plan: string;
  active: boolean;
  suspended: boolean;
  owner_name: string | null;
  owner_email: string | null;
  clients_count: number;
  created_at: string;
}

interface OrgListResponse {
  organisations: Organisation[];
  pagination: { page: number; limit: number; total: number };
}

interface CreateOrgPayload {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerName: string;
}

const PLANS = ['all', 'starter', 'professional', 'enterprise'] as const;
const STATUSES = ['all', 'active', 'suspended', 'inactive'] as const;

function planBadge(plan: string) {
  const colours: Record<string, string> = {
    starter: 'bg-slate-100 text-slate-600',
    professional: 'bg-teal-50 text-teal-700',
    enterprise: 'bg-orange-50 text-orange-700',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${colours[plan] ?? 'bg-slate-100 text-slate-600'}`}>
      {plan}
    </span>
  );
}

function statusBadge(active: boolean, suspended: boolean) {
  if (suspended) {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-red-50 text-red-600">
        Suspended
      </span>
    );
  }
  if (active) {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-green-50 text-green-700">
        Active
      </span>
    );
  }
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-100 text-slate-500">
      Inactive
    </span>
  );
}

export default function AdminOrgsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const limit = 20;

  const queryParams = new URLSearchParams();
  queryParams.set('page', String(page));
  queryParams.set('limit', String(limit));
  if (search) queryParams.set('search', search);
  if (planFilter !== 'all') queryParams.set('plan', planFilter);
  if (statusFilter !== 'all') queryParams.set('status', statusFilter);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-orgs', page, search, planFilter, statusFilter],
    queryFn: () => api.get<OrgListResponse>(`/admin/organisations?${queryParams.toString()}`),
  });

  const orgs = data?.success ? data.data.organisations : [];
  const pagination = data?.success ? data.data.pagination : { page: 1, limit, total: 0 };
  const totalPages = Math.ceil(pagination.total / pagination.limit) || 1;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Organisations</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {pagination.total} total organisations
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-medium rounded transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Create Enterprise Org
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search organisations..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
        </div>
        <select
          value={planFilter}
          onChange={(e) => { setPlanFilter(e.target.value); setPage(1); }}
          className="px-2 py-1.5 text-xs border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-orange-500"
        >
          {PLANS.map((p) => (
            <option key={p} value={p}>{p === 'all' ? 'All Plans' : p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-2 py-1.5 text-xs border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-orange-500"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s === 'all' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="aconex-grid w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2 font-semibold text-slate-600">Org Name</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-600">Slug</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-600">Plan</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-600">Status</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-600">Owner</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-600">Clients</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-600">Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                  Loading organisations...
                </td>
              </tr>
            ) : orgs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                  No organisations found.
                </td>
              </tr>
            ) : (
              orgs.map((org) => (
                <tr
                  key={org.id}
                  onClick={() => navigate(`/admin/organisations/${org.id}`)}
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2 font-medium text-slate-800">{org.name}</td>
                  <td className="px-3 py-2 text-slate-500 font-mono">{org.slug}</td>
                  <td className="px-3 py-2">{planBadge(org.plan)}</td>
                  <td className="px-3 py-2">{statusBadge(org.active, org.suspended)}</td>
                  <td className="px-3 py-2 text-slate-600">{org.owner_name ?? org.owner_email ?? '-'}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{org.clients_count}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {new Date(org.created_at).toLocaleDateString('en-GB')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-slate-500">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Create Enterprise Org Modal */}
      {showCreateModal && (
        <CreateOrgModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['admin-orgs'] });
          }}
        />
      )}
    </div>
  );
}

function CreateOrgModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<CreateOrgPayload>({
    name: '',
    slug: '',
    ownerEmail: '',
    ownerName: '',
  });

  const mutation = useMutation({
    mutationFn: (payload: CreateOrgPayload) =>
      api.post('/admin/organisations', {
        ...payload,
        plan: 'enterprise',
        onboarding_type: 'manual',
      }),
    onSuccess: (res) => {
      if (res.success) {
        toast.success('Enterprise organisation created');
        onSuccess();
      } else {
        toast.error(res.error?.message ?? 'Failed to create organisation');
      }
    },
    onError: () => {
      toast.error('Failed to create organisation');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(form);
  };

  const updateField = (field: keyof CreateOrgPayload, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800">Create Enterprise Organisation</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Organisation Name</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
              placeholder="e.g. Grant Solutions Ltd"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Slug</label>
            <input
              type="text"
              required
              value={form.slug}
              onChange={(e) => updateField('slug', e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
              placeholder="e.g. grant-solutions"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Owner Email</label>
            <input
              type="email"
              required
              value={form.ownerEmail}
              onChange={(e) => updateField('ownerEmail', e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
              placeholder="owner@example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Owner Name</label>
            <input
              type="text"
              required
              value={form.ownerName}
              onChange={(e) => updateField('ownerName', e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
              placeholder="Jane Smith"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-3 py-1.5 text-xs font-medium text-white bg-orange-600 rounded hover:bg-orange-700 disabled:opacity-50 transition-colors"
            >
              {mutation.isPending ? 'Creating...' : 'Create Organisation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

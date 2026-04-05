import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { toast } from 'sonner';
import { ArrowLeft, Save, Send, Power, Ban } from 'lucide-react';

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  plan: string;
  active: boolean;
  suspended: boolean;
  suspended_reason: string | null;
  white_label_domain: string | null;
  owner_name: string | null;
  owner_email: string | null;
  onboarding_type: string;
  onboarding_complete: boolean;
  settings: {
    max_active_clients?: number;
    max_stage_c_clients?: number;
    max_team_members?: number;
    max_storage_gb?: number;
  };
  usage: {
    active_clients: number;
    stage_c_clients: number;
    team_members: number;
    storage_used_gb: number;
    agent_calls_month: number;
  };
  created_at: string;
}

const PLAN_OPTIONS = ['starter', 'professional', 'enterprise'] as const;

function planBadge(plan: string) {
  const colours: Record<string, string> = {
    starter: 'bg-slate-100 text-slate-600',
    professional: 'bg-teal-50 text-teal-700',
    enterprise: 'bg-orange-50 text-orange-700',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${colours[plan] ?? 'bg-slate-100 text-slate-600'}`}>
      {plan}
    </span>
  );
}

function statusBadge(active: boolean, suspended: boolean) {
  if (suspended) return <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-red-50 text-red-600">Suspended</span>;
  if (active) return <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-green-50 text-green-700">Active</span>;
  return <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-100 text-slate-500">Inactive</span>;
}

export default function AdminOrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-org', id],
    queryFn: () => api.get<OrgDetail>(`/admin/organisations/${id}`),
    enabled: !!id,
  });

  const org = data?.success ? data.data : null;

  const [plan, setPlan] = useState('');
  const [whiteLabelDomain, setWhiteLabelDomain] = useState('');
  const [maxActiveClients, setMaxActiveClients] = useState('');
  const [maxStageCClients, setMaxStageCClients] = useState('');
  const [maxTeamMembers, setMaxTeamMembers] = useState('');
  const [maxStorageGb, setMaxStorageGb] = useState('');

  useEffect(() => {
    if (org) {
      setPlan(org.plan);
      setWhiteLabelDomain(org.white_label_domain ?? '');
      setMaxActiveClients(String(org.settings.max_active_clients ?? ''));
      setMaxStageCClients(String(org.settings.max_stage_c_clients ?? ''));
      setMaxTeamMembers(String(org.settings.max_team_members ?? ''));
      setMaxStorageGb(String(org.settings.max_storage_gb ?? ''));
    }
  }, [org]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch(`/admin/organisations/${id}`, {
        plan,
        white_label_domain: whiteLabelDomain || null,
        settings: {
          max_active_clients: maxActiveClients ? Number(maxActiveClients) : null,
          max_stage_c_clients: maxStageCClients ? Number(maxStageCClients) : null,
          max_team_members: maxTeamMembers ? Number(maxTeamMembers) : null,
          max_storage_gb: maxStorageGb ? Number(maxStorageGb) : null,
        },
      }),
    onSuccess: (res) => {
      if (res.success) {
        toast.success('Organisation updated');
        queryClient.invalidateQueries({ queryKey: ['admin-org', id] });
      } else {
        toast.error(res.error?.message ?? 'Update failed');
      }
    },
    onError: () => toast.error('Update failed'),
  });

  const actionMutation = useMutation({
    mutationFn: (action: 'activate' | 'suspend' | 'unsuspend' | 'invite') => {
      if (action === 'activate') return api.post(`/admin/organisations/${id}/activate`, {});
      if (action === 'invite') return api.post(`/admin/organisations/${id}/invite`, {});
      return api.patch(`/admin/organisations/${id}`, {
        suspended: action === 'suspend',
        suspended_reason: action === 'suspend' ? 'Suspended by admin' : null,
      });
    },
    onSuccess: (res, action) => {
      if (res.success) {
        toast.success(
          action === 'activate' ? 'Organisation activated' :
          action === 'invite' ? 'Invite sent' :
          action === 'suspend' ? 'Organisation suspended' :
          'Organisation unsuspended'
        );
        queryClient.invalidateQueries({ queryKey: ['admin-org', id] });
      } else {
        toast.error(res.error?.message ?? 'Action failed');
      }
    },
    onError: () => toast.error('Action failed'),
  });

  if (isLoading) {
    return <div className="p-6 text-xs text-slate-400">Loading organisation...</div>;
  }

  if (!org) {
    return <div className="p-6 text-xs text-slate-400">Organisation not found.</div>;
  }

  return (
    <div className="p-6 max-w-4xl">
      {/* Back link */}
      <button
        onClick={() => navigate('/admin/organisations')}
        className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-4 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to organisations
      </button>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-slate-800">{org.name}</h1>
          {planBadge(org.plan)}
          {statusBadge(org.active, org.suspended)}
        </div>
        <div className="flex items-center gap-2">
          {!org.active && (
            <button
              onClick={() => actionMutation.mutate('activate')}
              disabled={actionMutation.isPending}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 border border-green-300 rounded hover:bg-green-50 transition-colors"
            >
              <Power className="h-3.5 w-3.5" />
              Activate
            </button>
          )}
          {org.active && !org.suspended && (
            <button
              onClick={() => actionMutation.mutate('suspend')}
              disabled={actionMutation.isPending}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 border border-red-300 rounded hover:bg-red-50 transition-colors"
            >
              <Ban className="h-3.5 w-3.5" />
              Suspend
            </button>
          )}
          {org.suspended && (
            <button
              onClick={() => actionMutation.mutate('unsuspend')}
              disabled={actionMutation.isPending}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-teal-700 border border-teal-300 rounded hover:bg-teal-50 transition-colors"
            >
              <Power className="h-3.5 w-3.5" />
              Unsuspend
            </button>
          )}
          <button
            onClick={() => actionMutation.mutate('invite')}
            disabled={actionMutation.isPending}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-orange-600 border border-orange-300 rounded hover:bg-orange-50 transition-colors"
          >
            <Send className="h-3.5 w-3.5" />
            Send Invite
          </button>
        </div>
      </div>

      {/* Info row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <p className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Slug</p>
          <p className="text-xs font-mono text-slate-700">{org.slug}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <p className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Owner</p>
          <p className="text-xs text-slate-700">{org.owner_name ?? '-'}</p>
          <p className="text-[10px] text-slate-400">{org.owner_email ?? '-'}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <p className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Onboarding</p>
          <p className="text-xs text-slate-700">{org.onboarding_type}</p>
          <p className="text-[10px] text-slate-400">{org.onboarding_complete ? 'Complete' : 'In progress'}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <p className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Created</p>
          <p className="text-xs text-slate-700">{new Date(org.created_at).toLocaleDateString('en-GB')}</p>
        </div>
      </div>

      {/* Editable fields */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-4">Configuration</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Plan</label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
            >
              {PLAN_OPTIONS.map((p) => (
                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">White-Label Domain</label>
            <input
              type="text"
              value={whiteLabelDomain}
              onChange={(e) => setWhiteLabelDomain(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
              placeholder="e.g. grants.example.com"
            />
          </div>
        </div>

        <h3 className="text-xs font-semibold text-slate-700 mt-5 mb-3">Capacity Overrides</h3>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="block text-[10px] font-medium text-slate-500 mb-1">Max Active Clients</label>
            <input
              type="number"
              value={maxActiveClients}
              onChange={(e) => setMaxActiveClients(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
              placeholder="Unlimited"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-slate-500 mb-1">Max Stage C Clients</label>
            <input
              type="number"
              value={maxStageCClients}
              onChange={(e) => setMaxStageCClients(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
              placeholder="Default"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-slate-500 mb-1">Max Team Members</label>
            <input
              type="number"
              value={maxTeamMembers}
              onChange={(e) => setMaxTeamMembers(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
              placeholder="Unlimited"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-slate-500 mb-1">Max Storage (GB)</label>
            <input
              type="number"
              value={maxStorageGb}
              onChange={(e) => setMaxStorageGb(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
              placeholder="Custom"
            />
          </div>
        </div>

        <div className="flex justify-end mt-5">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-orange-600 rounded hover:bg-orange-700 disabled:opacity-50 transition-colors"
          >
            <Save className="h-3.5 w-3.5" />
            {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Usage stats */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-4">Usage</h2>
        <div className="grid grid-cols-5 gap-4">
          {[
            { label: 'Active Clients', value: org.usage.active_clients },
            { label: 'Stage C Clients', value: org.usage.stage_c_clients },
            { label: 'Team Members', value: org.usage.team_members },
            { label: 'Storage (GB)', value: org.usage.storage_used_gb.toFixed(1) },
            { label: 'Agent Calls (Month)', value: org.usage.agent_calls_month },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="text-lg font-semibold text-slate-800">{stat.value}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

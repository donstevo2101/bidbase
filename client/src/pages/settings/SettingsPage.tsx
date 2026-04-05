import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useSessionStore } from '../../stores/session';

type SettingsTab = 'organisation' | 'team' | 'billing' | 'branding';

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'organisation', label: 'Organisation' },
  { key: 'team', label: 'Team' },
  { key: 'billing', label: 'Billing' },
  { key: 'branding', label: 'Branding' },
];

/* ------------------------------------------------------------------ */
/*  Plan comparison data from CLAUDE.md Section 9                     */
/* ------------------------------------------------------------------ */

interface PlanCard {
  name: string;
  key: string;
  features: string[];
  highlight?: boolean;
}

const PLAN_CARDS: PlanCard[] = [
  {
    name: 'Starter',
    key: 'starter',
    features: [
      'Up to 10 active clients',
      '4 Stage C clients',
      '2 team members',
      '10 GB storage',
      '6 core agents',
      'Basic client portal',
      'Self-serve signup',
    ],
  },
  {
    name: 'Professional',
    key: 'professional',
    highlight: true,
    features: [
      'Up to 50 active clients',
      '4 Stage C clients',
      '10 team members',
      '50 GB storage',
      '6 core + 3 advanced agents',
      'Full client portal',
      'Limited custom branding',
      'Email priority support',
      'Self-serve signup',
    ],
  },
  {
    name: 'Enterprise',
    key: 'enterprise',
    features: [
      'Unlimited active clients',
      'Configurable Stage C limit',
      'Unlimited team members',
      'Custom storage',
      'All 9 agents',
      'Full portal + white-label',
      'Full custom branding',
      'Custom domain',
      'Dedicated account manager',
      'Live onboarding call',
      'Invoiced billing (optional)',
      'Manual onboarding by BidBase',
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('organisation');

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-4 py-2 border-b border-slate-200 bg-white">
        <h1 className="text-base font-semibold text-slate-900">Settings</h1>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-4 py-1.5 border-b border-slate-200 bg-white">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              activeTab === tab.key
                ? 'bg-teal-600 text-white'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'organisation' && <OrganisationTab />}
        {activeTab === 'team' && <TeamTab />}
        {activeTab === 'billing' && <BillingTab />}
        {activeTab === 'branding' && <BrandingTab />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Organisation tab                                                   */
/* ------------------------------------------------------------------ */

function OrganisationTab() {
  const organisation = useSessionStore((s) => s.organisation);
  const setSession = useSessionStore((s) => s.setSession);
  const accessToken = useSessionStore((s) => s.accessToken);
  const refreshToken = useSessionStore((s) => s.refreshToken);
  const user = useSessionStore((s) => s.user);

  const [orgName, setOrgName] = useState(organisation?.name ?? '');

  const updateMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await api.patch<{ id: string; name: string }>('/organisations/me', { name });
      if (!res.success) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data) => {
      toast.success('Organisation name updated');
      if (organisation && user && accessToken && refreshToken) {
        setSession({
          accessToken,
          refreshToken,
          user,
          organisation: { ...organisation, name: data.name },
        });
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update');
    },
  });

  return (
    <div className="max-w-lg space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Organisation Details</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Organisation Name
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Slug</label>
            <input
              type="text"
              value={organisation?.slug ?? ''}
              readOnly
              className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 text-slate-500"
            />
            <p className="text-[10px] text-slate-400 mt-0.5">Read-only identifier</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Current Plan</label>
            <span className="inline-block px-2 py-0.5 text-xs font-medium bg-teal-50 text-teal-700 rounded capitalize">
              {organisation?.plan ?? 'Unknown'}
            </span>
          </div>

          <button
            onClick={() => updateMutation.mutate(orgName)}
            disabled={updateMutation.isPending || orgName === organisation?.name}
            className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Team tab                                                           */
/* ------------------------------------------------------------------ */

function TeamTab() {
  const user = useSessionStore((s) => s.user);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-800">Team Members</h2>
          <button className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded transition-colors">
            + Invite Member
          </button>
        </div>

        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-300">
              <th className="text-left px-3 py-2 font-semibold text-slate-600">Name</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-600">Email</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-600">Role</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-600">Status</th>
            </tr>
          </thead>
          <tbody>
            {user && (
              <tr className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-1.5 font-medium text-slate-800">
                  {user.fullName ?? 'Unnamed'}{' '}
                  <span className="text-[10px] text-slate-400">(you)</span>
                </td>
                <td className="px-3 py-1.5 text-slate-600">{user.email}</td>
                <td className="px-3 py-1.5">
                  <span className="px-1.5 py-0.5 bg-teal-50 text-teal-700 rounded text-[10px] font-medium capitalize">
                    {user.role.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">
                    Active
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <p className="text-[10px] text-slate-400 mt-3">
          Team member invitations and management coming soon.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Billing tab                                                        */
/* ------------------------------------------------------------------ */

function BillingTab() {
  const organisation = useSessionStore((s) => s.organisation);
  const currentPlan = organisation?.plan ?? 'starter';

  const { data: subRes } = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () =>
      api.get<{ status: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean }>(
        '/billing/subscription'
      ),
  });

  const subscription = subRes?.success ? subRes.data : null;

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ url: string }>('/billing/create-portal', {});
      if (!res.success) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data) => {
      window.open(data.url, '_blank');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to open billing portal');
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async (plan: string) => {
      const res = await api.post<{ url: string }>('/billing/create-checkout', { plan });
      if (!res.success) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to start checkout');
    },
  });

  return (
    <div className="max-w-4xl space-y-4">
      {/* Current subscription */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Current Subscription</h2>
        <div className="flex items-center gap-6 text-xs">
          <div>
            <span className="text-slate-500">Plan:</span>{' '}
            <span className="font-medium text-slate-800 capitalize">{currentPlan}</span>
          </div>
          {subscription && (
            <>
              <div>
                <span className="text-slate-500">Status:</span>{' '}
                <span
                  className={`font-medium capitalize ${
                    subscription.status === 'active' ? 'text-green-600' : 'text-amber-600'
                  }`}
                >
                  {subscription.status}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Renews:</span>{' '}
                <span className="font-medium text-slate-800">
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded transition-colors disabled:opacity-50"
          >
            {portalMutation.isPending ? 'Opening...' : 'Manage Subscription'}
          </button>
        </div>
      </div>

      {/* Plan comparison */}
      <div>
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLAN_CARDS.map((plan) => {
            const isCurrent = currentPlan === plan.key;
            const isEnterprise = plan.key === 'enterprise';
            return (
              <div
                key={plan.key}
                className={`border rounded-lg p-4 ${
                  plan.highlight
                    ? 'border-teal-400 bg-teal-50/30'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-800">{plan.name}</h3>
                  {isCurrent && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-teal-100 text-teal-700 rounded">
                      Current
                    </span>
                  )}
                </div>
                <ul className="space-y-1.5 mb-4">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-1.5 text-xs text-slate-600">
                      <span className="text-teal-500 mt-0.5 shrink-0">&#x2713;</span>
                      {feature}
                    </li>
                  ))}
                </ul>
                {!isCurrent && !isEnterprise && (
                  <button
                    onClick={() => checkoutMutation.mutate(plan.key)}
                    disabled={checkoutMutation.isPending}
                    className="w-full px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded transition-colors disabled:opacity-50"
                  >
                    {checkoutMutation.isPending ? 'Loading...' : `Upgrade to ${plan.name}`}
                  </button>
                )}
                {isEnterprise && !isCurrent && (
                  <p className="text-[10px] text-slate-400 text-center">
                    Contact us for enterprise pricing
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Branding tab                                                       */
/* ------------------------------------------------------------------ */

function BrandingTab() {
  const organisation = useSessionStore((s) => s.organisation);
  const branding = organisation?.branding ?? {};

  return (
    <div className="max-w-lg space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Branding</h2>

        {/* Current branding info */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Logo</label>
            <div className="border border-dashed border-slate-300 rounded p-6 text-center">
              {branding.logoUrl ? (
                <img
                  src={branding.logoUrl as string}
                  alt="Organisation logo"
                  className="max-h-12 mx-auto"
                />
              ) : (
                <div className="text-xs text-slate-400">No logo uploaded</div>
              )}
              <button
                disabled
                className="mt-2 px-3 py-1 text-xs text-teal-600 hover:text-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Upload Logo (coming soon)
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Primary Colour</label>
            <div className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded border border-slate-300"
                style={{
                  backgroundColor: (branding.primaryColour as string) ?? '#0d9488',
                }}
              />
              <input
                type="text"
                value={(branding.primaryColour as string) ?? '#0d9488'}
                readOnly
                className="w-32 px-2 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 text-slate-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Display Name Override
            </label>
            <input
              type="text"
              value={(branding.displayName as string) ?? ''}
              readOnly
              placeholder="Uses organisation name by default"
              className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 text-slate-500"
            />
          </div>
        </div>

        <p className="text-[10px] text-slate-400 mt-4">
          Full branding customisation available on Professional and Enterprise plans. Colour picker
          and logo management coming soon.
        </p>
      </div>

      {/* Current branding JSON for debugging */}
      {Object.keys(branding).length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-2">Raw Branding Config</h2>
          <pre className="text-[10px] text-slate-500 bg-slate-50 p-2 rounded overflow-auto max-h-40">
            {JSON.stringify(branding, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Building2, Users, Briefcase, FileText } from 'lucide-react';

interface PlatformMetrics {
  total_orgs: number;
  total_users: number;
  total_clients: number;
  total_applications: number;
}

interface RevenueMetrics {
  mrr_by_plan: { plan: string; mrr: number; count: number }[];
  total_active_subscriptions: number;
  total_mrr: number;
}

interface UsageMetrics {
  agent_calls_this_month: number;
  total_storage_gb: number;
  active_orgs: number;
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-3">
      <div className="h-9 w-9 bg-orange-50 rounded-lg flex items-center justify-center shrink-0">
        <Icon className="h-4.5 w-4.5 text-orange-600" />
      </div>
      <div>
        <p className="text-lg font-semibold text-slate-800">{value}</p>
        <p className="text-[10px] font-medium uppercase text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export default function AdminMetricsPage() {
  const { data: metricsData, isLoading: metricsLoading } = useQuery({
    queryKey: ['admin-metrics'],
    queryFn: () => api.get<PlatformMetrics>('/admin/metrics'),
  });

  const { data: revenueData, isLoading: revenueLoading } = useQuery({
    queryKey: ['admin-metrics-revenue'],
    queryFn: () => api.get<RevenueMetrics>('/admin/metrics/revenue'),
  });

  const { data: usageData, isLoading: usageLoading } = useQuery({
    queryKey: ['admin-metrics-usage'],
    queryFn: () => api.get<UsageMetrics>('/admin/metrics/usage'),
  });

  const metrics = metricsData?.success ? metricsData.data : null;
  const revenue = revenueData?.success ? revenueData.data : null;
  const usage = usageData?.success ? usageData.data : null;

  const isLoading = metricsLoading || revenueLoading || usageLoading;

  if (isLoading) {
    return <div className="p-6 text-xs text-slate-400">Loading metrics...</div>;
  }

  const chartData = revenue?.mrr_by_plan.map((item) => ({
    name: item.plan.charAt(0).toUpperCase() + item.plan.slice(1),
    mrr: item.mrr,
    subscriptions: item.count,
  })) ?? [];

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-slate-800 mb-6">Platform Metrics</h1>

      {/* Top cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <MetricCard label="Total Orgs" value={metrics?.total_orgs ?? 0} icon={Building2} />
        <MetricCard label="Total Users" value={metrics?.total_users ?? 0} icon={Users} />
        <MetricCard label="Total Clients" value={metrics?.total_clients ?? 0} icon={Briefcase} />
        <MetricCard label="Total Applications" value={metrics?.total_applications ?? 0} icon={FileText} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Revenue section */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-1">Revenue</h2>
          <p className="text-[10px] text-slate-500 mb-4">MRR by plan</p>

          <div className="flex items-center gap-6 mb-4">
            <div>
              <p className="text-xl font-bold text-slate-800">
                {revenue ? `\u00A3${revenue.total_mrr.toLocaleString()}` : '-'}
              </p>
              <p className="text-[10px] text-slate-500">Total MRR</p>
            </div>
            <div>
              <p className="text-xl font-bold text-slate-800">
                {revenue?.total_active_subscriptions ?? 0}
              </p>
              <p className="text-[10px] text-slate-500">Active Subscriptions</p>
            </div>
          </div>

          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `\u00A3${v}`} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 6 }}
                  formatter={(value: number) => [`\u00A3${value}`, 'MRR']}
                />
                <Bar dataKey="mrr" fill="#ea580c" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Usage section */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-1">Usage</h2>
          <p className="text-[10px] text-slate-500 mb-4">Platform-wide usage this period</p>

          <div className="space-y-5 mt-6">
            <UsageStat
              label="Agent Calls This Month"
              value={usage?.agent_calls_this_month ?? 0}
            />
            <UsageStat
              label="Total Storage"
              value={`${(usage?.total_storage_gb ?? 0).toFixed(1)} GB`}
            />
            <UsageStat
              label="Active Organisations"
              value={usage?.active_orgs ?? 0}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function UsageStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-slate-800">{value}</span>
    </div>
  );
}

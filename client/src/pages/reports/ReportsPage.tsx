import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { api } from '../../lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PipelineSummary {
  clientsByStage: { A: number; B: number; C: number };
  totalActive: number;
  upcomingDeadlines: unknown[];
  stageC: { current: number; limit: number };
}

interface Application {
  id: string;
  status: string;
}

interface Invoice {
  id: string;
  amount: number;
  status: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STAGE_COLOURS = ['#0d9488', '#0891b2', '#6366f1'];

const STATUS_COLOURS: Record<string, string> = {
  researching: '#94a3b8',
  gate1_pending: '#f59e0b',
  gate1_failed: '#ef4444',
  gate2_pending: '#f59e0b',
  gate2_high_risk: '#f97316',
  drafting: '#0891b2',
  gate3_pending: '#f59e0b',
  draft_ready: '#8b5cf6',
  awaiting_approval: '#a855f7',
  submitted: '#3b82f6',
  successful: '#10b981',
  unsuccessful: '#ef4444',
  withdrawn: '#6b7280',
};

const FUNNEL_ORDER = [
  'researching',
  'gate1_pending',
  'gate2_pending',
  'drafting',
  'gate3_pending',
  'draft_ready',
  'awaiting_approval',
  'submitted',
  'successful',
  'unsuccessful',
];

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ReportsPage() {
  // Pipeline summary
  const { data: pipelineRes, isLoading: pipelineLoading } = useQuery({
    queryKey: ['pipeline-summary'],
    queryFn: () => api.get<PipelineSummary>('/pipeline/summary'),
  });

  // Applications for funnel
  const { data: appsRes, isLoading: appsLoading } = useQuery({
    queryKey: ['reports-applications'],
    queryFn: () => api.paginated<Application>('/applications?limit=1000'),
  });

  // Invoices for revenue
  const { data: invoicesRes, isLoading: invoicesLoading } = useQuery({
    queryKey: ['reports-invoices'],
    queryFn: () => api.paginated<Invoice>('/invoices?limit=1000'),
  });

  const pipeline = pipelineRes?.success ? pipelineRes.data : null;
  const applications = appsRes?.success ? appsRes.data : [];
  const invoices = invoicesRes?.success ? invoicesRes.data : [];

  // Aggregate application statuses
  const funnelData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const app of applications) {
      counts[app.status] = (counts[app.status] ?? 0) + 1;
    }
    return FUNNEL_ORDER.filter((s) => counts[s]).map((status) => ({
      status: status.replace(/_/g, ' '),
      count: counts[status] ?? 0,
      fill: STATUS_COLOURS[status] ?? '#94a3b8',
    }));
  }, [applications]);

  // Aggregate invoice amounts
  const revenue = useMemo(() => {
    let invoiced = 0;
    let paid = 0;
    let overdue = 0;
    for (const inv of invoices) {
      invoiced += Number(inv.amount) || 0;
      if (inv.status === 'paid') paid += Number(inv.amount) || 0;
      if (inv.status === 'overdue') overdue += Number(inv.amount) || 0;
    }
    return { invoiced, paid, overdue };
  }, [invoices]);

  // Pipeline chart data
  const pipelineChartData = pipeline
    ? [
        { stage: 'Stage A', count: pipeline.clientsByStage.A },
        { stage: 'Stage B', count: pipeline.clientsByStage.B },
        { stage: 'Stage C', count: pipeline.clientsByStage.C },
      ]
    : [];

  const isLoading = pipelineLoading || appsLoading || invoicesLoading;

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-4 py-2 border-b border-slate-200 bg-white">
        <h1 className="text-base font-semibold text-slate-900">Reports</h1>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center flex-1">
          <div className="text-center">
            <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs text-slate-400">Loading reports...</p>
          </div>
        </div>
      )}

      {!isLoading && (
        <div className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Pipeline Health */}
            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="px-4 py-2 border-b border-slate-200 bg-slate-50">
                <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                  Pipeline Health
                </h2>
              </div>
              <div className="p-4">
                {pipelineChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={pipelineChartData}>
                      <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ fontSize: 12 }}
                        formatter={(value: number) => [`${value} clients`, 'Count']}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {pipelineChartData.map((_entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={STAGE_COLOURS[index % STAGE_COLOURS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-xs text-slate-400 text-center py-8">
                    No pipeline data available
                  </p>
                )}
              </div>
            </div>

            {/* Application Funnel */}
            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="px-4 py-2 border-b border-slate-200 bg-slate-50">
                <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                  Application Funnel
                </h2>
              </div>
              <div className="p-4">
                {funnelData.length > 0 ? (
                  <div className="space-y-1.5">
                    {funnelData.map((item) => {
                      const maxCount = Math.max(...funnelData.map((d) => d.count), 1);
                      const pct = (item.count / maxCount) * 100;
                      return (
                        <div key={item.status} className="flex items-center gap-2">
                          <span className="w-28 text-[10px] text-slate-600 text-right truncate capitalize">
                            {item.status}
                          </span>
                          <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden">
                            <div
                              className="h-full rounded transition-all"
                              style={{ width: `${pct}%`, backgroundColor: item.fill }}
                            />
                          </div>
                          <span className="w-6 text-[10px] text-slate-600 font-medium text-right">
                            {item.count}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 text-center py-8">
                    No applications to display
                  </p>
                )}
              </div>
            </div>

            {/* Revenue Summary */}
            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="px-4 py-2 border-b border-slate-200 bg-slate-50">
                <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                  Revenue Summary
                </h2>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="text-center">
                    <div className="text-lg font-bold text-slate-800">
                      {formatCurrency(revenue.invoiced)}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Total Invoiced</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-green-600">
                      {formatCurrency(revenue.paid)}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Paid</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-red-500">
                      {formatCurrency(revenue.overdue)}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Overdue</div>
                  </div>
                </div>
                {revenue.invoiced > 0 ? (
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Paid', value: revenue.paid },
                          { name: 'Overdue', value: revenue.overdue },
                          {
                            name: 'Pending',
                            value: Math.max(0, revenue.invoiced - revenue.paid - revenue.overdue),
                          },
                        ].filter((d) => d.value > 0)}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={65}
                        dataKey="value"
                      >
                        <Cell fill="#10b981" />
                        <Cell fill="#ef4444" />
                        <Cell fill="#f59e0b" />
                      </Pie>
                      <Tooltip
                        contentStyle={{ fontSize: 12 }}
                        formatter={(value: number) => [formatCurrency(value), '']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-xs text-slate-400 text-center py-4">No invoice data</p>
                )}
              </div>
            </div>

            {/* Capacity */}
            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="px-4 py-2 border-b border-slate-200 bg-slate-50">
                <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                  Capacity
                </h2>
              </div>
              <div className="p-4">
                {pipeline ? (
                  <div>
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="text-slate-600">Stage C Usage</span>
                      <span className="font-medium text-slate-800">
                        {pipeline.stageC.current} / {pipeline.stageC.limit}
                      </span>
                    </div>
                    <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          pipeline.stageC.current >= pipeline.stageC.limit
                            ? 'bg-red-500'
                            : pipeline.stageC.current >= pipeline.stageC.limit * 0.75
                              ? 'bg-amber-500'
                              : 'bg-teal-500'
                        }`}
                        style={{
                          width: `${Math.min(100, (pipeline.stageC.current / Math.max(pipeline.stageC.limit, 1)) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-slate-400">
                        {pipeline.stageC.limit - pipeline.stageC.current > 0
                          ? `${pipeline.stageC.limit - pipeline.stageC.current} slots remaining`
                          : 'At capacity'}
                      </span>
                      {pipeline.stageC.current >= pipeline.stageC.limit && (
                        <span className="text-[10px] text-red-500 font-medium">
                          Upgrade to add more Stage C clients
                        </span>
                      )}
                    </div>

                    <div className="mt-6 pt-4 border-t border-slate-100">
                      <h3 className="text-xs font-medium text-slate-700 mb-2">
                        Pipeline Overview
                      </h3>
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="bg-slate-50 rounded p-2">
                          <div className="text-lg font-bold text-teal-600">{pipeline.clientsByStage.A}</div>
                          <div className="text-[10px] text-slate-500">Stage A</div>
                        </div>
                        <div className="bg-slate-50 rounded p-2">
                          <div className="text-lg font-bold text-cyan-600">{pipeline.clientsByStage.B}</div>
                          <div className="text-[10px] text-slate-500">Stage B</div>
                        </div>
                        <div className="bg-slate-50 rounded p-2">
                          <div className="text-lg font-bold text-indigo-600">{pipeline.stageC.current}</div>
                          <div className="text-[10px] text-slate-500">Stage C</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 text-center py-8">
                    No capacity data available
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

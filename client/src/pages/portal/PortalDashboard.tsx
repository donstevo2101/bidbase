import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useSessionStore } from '../../stores/session';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Application {
  id: string;
  funder_name: string;
  project_name: string | null;
  status: string;
  amount_requested: number | null;
  deadline: string | null;
}

interface Document {
  id: string;
}

interface TimelineEntry {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  actor_type: string;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Status badge colours                                               */
/* ------------------------------------------------------------------ */

const STATUS_BADGE: Record<string, string> = {
  researching: 'bg-slate-100 text-slate-600',
  gate1_pending: 'bg-amber-100 text-amber-700',
  gate2_pending: 'bg-amber-100 text-amber-700',
  drafting: 'bg-cyan-100 text-cyan-700',
  gate3_pending: 'bg-amber-100 text-amber-700',
  draft_ready: 'bg-violet-100 text-violet-700',
  awaiting_approval: 'bg-purple-100 text-purple-700',
  submitted: 'bg-blue-100 text-blue-700',
  successful: 'bg-green-100 text-green-700',
  unsuccessful: 'bg-red-100 text-red-600',
  withdrawn: 'bg-slate-100 text-slate-500',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PortalDashboard() {
  const user = useSessionStore((s) => s.user);
  const organisation = useSessionStore((s) => s.organisation);

  // For portal users, we use /api/applications (scoped by RLS to their client)
  const { data: appsRes, isLoading: appsLoading } = useQuery({
    queryKey: ['portal-applications'],
    queryFn: () => api.paginated<Application>('/applications?limit=50'),
  });

  const { data: docsRes } = useQuery({
    queryKey: ['portal-documents'],
    queryFn: () => api.paginated<Document>('/documents?limit=1000'),
  });

  // Timeline — try client-specific endpoint; the user ID may correspond to a client
  const { data: timelineRes } = useQuery({
    queryKey: ['portal-timeline'],
    queryFn: () =>
      api.get<TimelineEntry[]>(`/clients/${user?.id}/timeline`),
    enabled: !!user?.id,
  });

  const applications = appsRes?.success ? appsRes.data : [];
  const documents = docsRes?.success ? docsRes.data : [];
  const timeline = timelineRes?.success ? timelineRes.data : [];

  const activeApps = applications.filter(
    (a) => !['unsuccessful', 'withdrawn'].includes(a.status)
  );

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">
      {/* Welcome */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h1 className="text-base font-semibold text-slate-900">
          Welcome back{user?.fullName ? `, ${user.fullName}` : ''}
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          {organisation?.name ?? 'Your Organisation'} portal
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-teal-600">{activeApps.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">Active Applications</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-teal-600">{documents.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">Documents Uploaded</div>
        </div>
      </div>

      {/* Active applications */}
      <div className="bg-white border border-slate-200 rounded-lg">
        <div className="px-4 py-2 border-b border-slate-200 bg-slate-50">
          <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
            Active Applications
          </h2>
        </div>
        <div className="p-4">
          {appsLoading && (
            <div className="text-center py-4">
              <div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          )}
          {!appsLoading && activeApps.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-4">No active applications</p>
          )}
          {!appsLoading && activeApps.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300">
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">Funder</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">Project</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 w-32">Status</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 w-28">
                    Deadline
                  </th>
                </tr>
              </thead>
              <tbody>
                {activeApps.map((app) => (
                  <tr key={app.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-1.5 font-medium text-slate-800">{app.funder_name}</td>
                    <td className="px-3 py-1.5 text-slate-600">
                      {app.project_name ?? '\u2014'}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize ${
                          STATUS_BADGE[app.status] ?? 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {app.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-600">
                      {app.deadline
                        ? new Date(app.deadline).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })
                        : '\u2014'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-white border border-slate-200 rounded-lg">
        <div className="px-4 py-2 border-b border-slate-200 bg-slate-50">
          <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
            Recent Activity
          </h2>
        </div>
        <div className="p-4">
          {Array.isArray(timeline) && timeline.length > 0 ? (
            <div className="space-y-3">
              {timeline.slice(0, 10).map((entry) => (
                <div key={entry.id} className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-teal-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-700">{entry.action}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {new Date(entry.created_at).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' \u2022 '}
                      <span className="capitalize">{entry.actor_type}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 text-center py-4">No recent activity</p>
          )}
        </div>
      </div>
    </div>
  );
}

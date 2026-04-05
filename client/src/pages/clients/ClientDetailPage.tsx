import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import type { Client, Application, Document as DocType, ActivityLogEntry } from '@shared/types/database';

const tabs = ['Overview', 'Applications', 'Documents', 'Timeline'] as const;
type Tab = typeof tabs[number];

const stageBadgeColors: Record<string, string> = {
  A: 'bg-teal-600 text-white',
  B: 'bg-teal-500 text-white',
  C: 'bg-teal-700 text-white',
};

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('Overview');

  const { data: clientResult, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: () => api.get<Client>(`/clients/${id}`),
    enabled: !!id,
  });

  const { data: appsResult } = useQuery({
    queryKey: ['client-apps', id],
    queryFn: () => api.paginated<Application>(`/clients/${id}/applications`),
    enabled: !!id && activeTab === 'Applications',
  });

  const { data: docsResult } = useQuery({
    queryKey: ['client-docs', id],
    queryFn: () => api.paginated<DocType>(`/clients/${id}/documents`),
    enabled: !!id && activeTab === 'Documents',
  });

  const { data: timelineResult } = useQuery({
    queryKey: ['client-timeline', id],
    queryFn: () => api.paginated<ActivityLogEntry>(`/clients/${id}/timeline`),
    enabled: !!id && activeTab === 'Timeline',
  });

  const client = clientResult?.success ? clientResult.data : null;

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-sm text-slate-400">Loading...</div>;
  }

  if (!client) {
    return <div className="flex items-center justify-center h-full text-sm text-slate-400">Client not found</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with breadcrumb */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2">
          <Link to="/clients" className="text-xs text-slate-400 hover:text-slate-600">Clients</Link>
          <span className="text-xs text-slate-300">/</span>
          <h1 className="text-base font-semibold text-slate-900">{client.name}</h1>
          <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded ${stageBadgeColors[client.stage] ?? ''}`}>
            Stage {client.stage}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/clients/${id}/edit`}
            className="px-3 py-1.5 border border-slate-300 text-xs font-medium rounded hover:bg-slate-50 transition-colors"
          >
            Edit
          </Link>
        </div>
      </div>

      {/* Client summary bar — Aconex-style top-level data row */}
      <div className="grid grid-cols-6 gap-0 border-b border-slate-200 bg-slate-50">
        {[
          { label: 'Type', value: client.type ?? '—' },
          { label: 'Status', value: client.status },
          { label: 'Contact', value: client.primary_contact_name ?? '—' },
          { label: 'Email', value: client.primary_contact_email ?? '—' },
          { label: 'Annual Income', value: client.annual_income ? `£${client.annual_income.toLocaleString()}` : '—' },
          { label: 'Reg. Number', value: client.registered_number ?? '—' },
        ].map((item) => (
          <div key={item.label} className="px-4 py-2 border-r border-slate-200 last:border-r-0">
            <div className="text-[10px] text-slate-400 uppercase font-medium">{item.label}</div>
            <div className="text-xs text-slate-800 font-medium mt-0.5 truncate">{item.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs — Aconex bottom panel style */}
      <div className="flex items-center gap-0 px-4 border-b border-slate-200 bg-white">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-teal-500 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'Overview' && (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 rounded p-4">
                <h3 className="text-xs font-semibold text-slate-700 mb-2">Contact Details</h3>
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Name</dt>
                    <dd className="text-slate-700">{client.primary_contact_name ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Email</dt>
                    <dd className="text-slate-700">{client.primary_contact_email ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Phone</dt>
                    <dd className="text-slate-700">{client.primary_contact_phone ?? '—'}</dd>
                  </div>
                </dl>
              </div>
              <div className="bg-white border border-slate-200 rounded p-4">
                <h3 className="text-xs font-semibold text-slate-700 mb-2">Policies Held</h3>
                {client.policies_held && client.policies_held.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {client.policies_held.map((p) => (
                      <span key={p} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]">{p}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">None recorded</p>
                )}
              </div>
            </div>
            {client.notes && (
              <div className="bg-white border border-slate-200 rounded p-4">
                <h3 className="text-xs font-semibold text-slate-700 mb-2">Notes</h3>
                <p className="text-xs text-slate-600 whitespace-pre-wrap">{client.notes}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'Applications' && (
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className="bg-slate-100 border-b border-slate-300">
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Funder</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Project</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Status</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600">Amount</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Deadline</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Gates</th>
              </tr>
            </thead>
            <tbody>
              {appsResult?.success && appsResult.data.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-slate-400 italic text-center">No applications yet</td></tr>
              )}
              {appsResult?.success && appsResult.data.map((app) => (
                <tr key={app.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1.5 font-medium text-slate-800">
                    <Link to={`/applications/${app.id}`} className="hover:text-teal-600">{app.funder_name}</Link>
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">{app.project_name ?? '—'}</td>
                  <td className="px-3 py-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium">
                      {app.status}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-600">
                    {app.amount_requested ? `£${app.amount_requested.toLocaleString()}` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">
                    {app.deadline ? new Date(app.deadline).toLocaleDateString('en-GB') : '—'}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex gap-1">
                      <span className={`w-4 h-4 rounded text-center text-[9px] font-bold leading-4 ${app.gate1_passed ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>1</span>
                      <span className={`w-4 h-4 rounded text-center text-[9px] font-bold leading-4 ${app.gate2_passed ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>2</span>
                      <span className={`w-4 h-4 rounded text-center text-[9px] font-bold leading-4 ${app.gate3_passed ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>3</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === 'Documents' && (
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className="bg-slate-100 border-b border-slate-300">
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Name</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Type</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Status</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600">Size</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {docsResult?.success && docsResult.data.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-4 text-slate-400 italic text-center">No documents uploaded</td></tr>
              )}
              {docsResult?.success && docsResult.data.map((doc) => (
                <tr key={doc.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1.5 font-medium text-slate-800">{doc.name}</td>
                  <td className="px-3 py-1.5 text-slate-600">{doc.type}</td>
                  <td className="px-3 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      doc.processing_status === 'processed' ? 'bg-green-100 text-green-700' :
                      doc.processing_status === 'failed' ? 'bg-red-100 text-red-600' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {doc.processing_status}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-600">
                    {doc.file_size ? `${(doc.file_size / 1024).toFixed(0)} KB` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">
                    {new Date(doc.created_at).toLocaleDateString('en-GB')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === 'Timeline' && (
          <div className="p-4">
            {timelineResult?.success && timelineResult.data.length === 0 && (
              <p className="text-xs text-slate-400 italic">No activity recorded yet</p>
            )}
            {timelineResult?.success && timelineResult.data.map((entry) => (
              <div key={entry.id} className="flex gap-3 py-2 border-b border-slate-100 last:border-0">
                <div className="w-2 h-2 rounded-full bg-teal-400 mt-1 shrink-0" />
                <div>
                  <div className="text-xs text-slate-700">{entry.action}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {new Date(entry.created_at).toLocaleString('en-GB')}
                    {entry.actor_type !== 'user' && ` — ${entry.actor_type}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

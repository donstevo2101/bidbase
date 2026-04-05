import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface Enquiry {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string | null;
  expected_clients: number | null;
  message: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'closed';
  created_at: string;
}

const STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'closed'] as const;

function statusBadge(status: string) {
  const colours: Record<string, string> = {
    new: 'bg-blue-50 text-blue-700',
    contacted: 'bg-yellow-50 text-yellow-700',
    qualified: 'bg-green-50 text-green-700',
    closed: 'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${colours[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status}
    </span>
  );
}

export default function AdminEnquiriesPage() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-enquiries'],
    queryFn: () => api.get<{ enquiries: Enquiry[] }>('/admin/enquiries'),
  });

  const enquiries = data?.success ? data.data.enquiries : [];

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/admin/enquiries/${id}`, { status }),
    onSuccess: (res) => {
      if (res.success) {
        toast.success('Status updated');
        queryClient.invalidateQueries({ queryKey: ['admin-enquiries'] });
      } else {
        toast.error(res.error?.message ?? 'Update failed');
      }
    },
    onError: () => toast.error('Update failed'),
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-slate-800">Enterprise Enquiries</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          {enquiries.length} enquiries
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="aconex-grid w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2 font-semibold text-slate-600 w-6"></th>
              <th className="text-left px-3 py-2 font-semibold text-slate-600">Name</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-600">Company</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-600">Email</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-600">Expected Clients</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-600">Status</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-600">Date</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-600 w-32">Update Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                  Loading enquiries...
                </td>
              </tr>
            ) : enquiries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                  No enquiries yet.
                </td>
              </tr>
            ) : (
              enquiries.map((enquiry) => {
                const isExpanded = expandedId === enquiry.id;
                return (
                  <tbody key={enquiry.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : enquiry.id)}
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2 text-slate-400">
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">{enquiry.name}</td>
                      <td className="px-3 py-2 text-slate-600">{enquiry.company}</td>
                      <td className="px-3 py-2 text-slate-600">{enquiry.email}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{enquiry.expected_clients ?? '-'}</td>
                      <td className="px-3 py-2">{statusBadge(enquiry.status)}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {new Date(enquiry.created_at).toLocaleDateString('en-GB')}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={enquiry.status}
                          onChange={(e) =>
                            updateStatusMutation.mutate({ id: enquiry.id, status: e.target.value })
                          }
                          className="w-full px-1.5 py-1 text-[10px] border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-orange-500"
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s.charAt(0).toUpperCase() + s.slice(1)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/50">
                        <td colSpan={8} className="px-6 py-4">
                          <div className="grid grid-cols-3 gap-4 text-xs">
                            <div>
                              <p className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Phone</p>
                              <p className="text-slate-700">{enquiry.phone ?? 'Not provided'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Expected Clients</p>
                              <p className="text-slate-700">{enquiry.expected_clients ?? 'Not specified'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Submitted</p>
                              <p className="text-slate-700">
                                {new Date(enquiry.created_at).toLocaleString('en-GB')}
                              </p>
                            </div>
                            <div className="col-span-3">
                              <p className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Message</p>
                              <p className="text-slate-700 whitespace-pre-wrap">
                                {enquiry.message ?? 'No message provided.'}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

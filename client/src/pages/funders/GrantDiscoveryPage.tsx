import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useSessionStore } from '../../stores/session';
import { toast } from 'sonner';
import type { Client } from '@shared/types/database';

interface GrantOpportunity {
  id: string;
  title: string;
  funder: string;
  amount: string;
  deadline: string;
  eligibilitySummary: string;
  sourceUrl: string;
  scrapedAt: string;
}

interface GrantSearchFilters {
  clientType?: string;
  geography?: string;
  sector?: string;
}

export default function GrantDiscoveryPage() {
  const user = useSessionStore((s) => s.user);
  const isAdmin = user?.role === 'org_admin' || user?.role === 'super_admin';

  const [clientType, setClientType] = useState('');
  const [geography, setGeography] = useState('');
  const [sector, setSector] = useState('');
  const [grants, setGrants] = useState<GrantOpportunity[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [matchDropdownOpen, setMatchDropdownOpen] = useState<string | null>(null);

  const { data: clientsResult } = useQuery({
    queryKey: ['clients-list'],
    queryFn: () => api.paginated<Client>('/clients'),
  });

  const clients = clientsResult?.success ? clientsResult.data : [];

  const searchMutation = useMutation({
    mutationFn: (filters: GrantSearchFilters) =>
      api.post<GrantOpportunity[]>('/enrichment/grants/search', filters),
    onSuccess: (result) => {
      setHasSearched(true);
      if (result.success) {
        setGrants(result.data);
      } else {
        toast.error('Grant search failed');
      }
    },
    onError: () => {
      toast.error('Grant search request failed');
    },
  });

  const scrapeMutation = useMutation({
    mutationFn: () => api.post<GrantOpportunity[]>('/enrichment/grants/scrape', {}),
    onSuccess: (result) => {
      if (result.success) {
        setGrants(result.data);
        setHasSearched(true);
        toast.success('Scrape complete — results updated');
      } else {
        toast.error('Scrape failed');
      }
    },
    onError: () => {
      toast.error('Scrape request failed');
    },
  });

  const handleSearch = () => {
    const filters: GrantSearchFilters = {};
    if (clientType) filters.clientType = clientType;
    if (geography) filters.geography = geography;
    if (sector) filters.sector = sector;
    searchMutation.mutate(filters);
  };

  const handleMatchToClient = (grantId: string, clientId: string) => {
    api.post('/enrichment/grants/match', { grantId, clientId }).then((result) => {
      if (result.success) {
        toast.success('Grant matched to client');
      } else {
        toast.error('Failed to match grant');
      }
    });
    setMatchDropdownOpen(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-slate-200 bg-white">
        <h1 className="text-lg font-semibold text-slate-900">Grant Discovery</h1>
        <p className="text-xs text-slate-500 mt-1">
          Search open grant opportunities across UK funding portals
        </p>
      </div>

      {/* Search bar */}
      <div className="px-6 py-4 bg-white border-b border-slate-200">
        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-[180px]">
            <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">Client Type</label>
            <select
              value={clientType}
              onChange={(e) => setClientType(e.target.value)}
              className="w-full h-8 px-2 text-xs border border-slate-300 rounded-[6px] bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
            >
              <option value="">All types</option>
              <option value="CIC">CIC</option>
              <option value="charity">Charity</option>
              <option value="social_enterprise">Social Enterprise</option>
            </select>
          </div>
          <div className="flex-1 max-w-[200px]">
            <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">Geography</label>
            <input
              type="text"
              value={geography}
              onChange={(e) => setGeography(e.target.value)}
              placeholder="e.g. North West England"
              className="w-full h-8 px-2 text-xs border border-slate-300 rounded-[6px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
            />
          </div>
          <div className="flex-1 max-w-[200px]">
            <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">Sector</label>
            <input
              type="text"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              placeholder="e.g. Youth services"
              className="w-full h-8 px-2 text-xs border border-slate-300 rounded-[6px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searchMutation.isPending}
            className="h-8 px-4 bg-[#2563eb] text-white text-xs font-medium rounded-[6px] hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {searchMutation.isPending && (
              <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            Search Grants
          </button>
          {isAdmin && (
            <button
              onClick={() => scrapeMutation.mutate()}
              disabled={scrapeMutation.isPending}
              className="h-8 px-4 border border-slate-300 text-xs font-medium text-slate-700 rounded-[6px] hover:bg-slate-50 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {scrapeMutation.isPending && (
                <svg className="animate-spin h-3.5 w-3.5 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              Scrape All Portals
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {!hasSearched && grants.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-slate-400">
              Search for grants or scrape funding portals to discover opportunities
            </p>
          </div>
        ) : grants.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-slate-400">No grants found matching your criteria</p>
          </div>
        ) : (
          <table className="data-grid w-full text-xs">
            <thead className="sticky top-0">
              <tr className="bg-slate-100 border-b border-slate-300">
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Title</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Funder</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600">Amount</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Deadline</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Eligibility</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Source</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Scraped</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600 w-[120px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((grant) => (
                <tr key={grant.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1.5 font-medium text-slate-800">{grant.title}</td>
                  <td className="px-3 py-1.5 text-slate-600">{grant.funder}</td>
                  <td className="px-3 py-1.5 text-right text-slate-600">{grant.amount}</td>
                  <td className="px-3 py-1.5 text-slate-600">
                    {grant.deadline ? new Date(grant.deadline).toLocaleDateString('en-GB') : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600 max-w-[200px] truncate">{grant.eligibilitySummary}</td>
                  <td className="px-3 py-1.5">
                    {grant.sourceUrl ? (
                      <a
                        href={grant.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#2563eb] hover:underline"
                      >
                        Link
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-slate-400 text-[10px]">
                    {grant.scrapedAt ? new Date(grant.scrapedAt).toLocaleDateString('en-GB') : '—'}
                  </td>
                  <td className="px-3 py-1.5 relative">
                    <button
                      onClick={() => setMatchDropdownOpen(matchDropdownOpen === grant.id ? null : grant.id)}
                      className="px-2 py-1 border border-slate-300 text-[10px] font-medium text-slate-600 rounded hover:bg-slate-50 transition-colors"
                    >
                      Match to Client
                    </button>
                    {matchDropdownOpen === grant.id && (
                      <div className="absolute right-3 top-8 z-10 w-48 bg-white border border-slate-200 rounded-[6px] shadow-lg py-1 max-h-48 overflow-auto">
                        {clients.length === 0 ? (
                          <div className="px-3 py-2 text-[10px] text-slate-400 italic">No clients available</div>
                        ) : (
                          clients.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => handleMatchToClient(grant.id, c.id)}
                              className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                              {c.name}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Client } from '@shared/types/database';

const stageDotColor: Record<string, string> = {
  A: 'var(--color-accent)',
  B: 'var(--color-success)',
  C: 'var(--color-warning)',
};

const statusBadge: Record<string, { bg: string; text: string }> = {
  lead: { bg: '#fef3c7', text: '#92400e' },
  active: { bg: '#d1fae5', text: '#065f46' },
  paused: { bg: '#f3f4f6', text: '#374151' },
  offboarded: { bg: '#fee2e2', text: '#991b1b' },
};

export default function ClientsListPage() {
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['clients', page, stageFilter, statusFilter, search],
    queryFn: () =>
      api.paginated<Client>(
        `/clients?page=${page}&limit=25${stageFilter !== 'all' ? `&stage=${stageFilter}` : ''}${statusFilter !== 'all' ? `&status=${statusFilter}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`
      ),
  });

  const clients = data?.success ? data.data : [];
  const pagination = data?.success && 'pagination' in data ? data.pagination : null;
  const totalCount = pagination?.total ?? clients.length;

  const selectStyle: React.CSSProperties = {
    height: 32,
    padding: '0 28px 0 10px',
    fontSize: 13,
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    background: 'var(--color-surface)',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
  };

  const inputStyle: React.CSSProperties = {
    height: 32,
    padding: '0 10px',
    fontSize: 13,
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    background: 'var(--color-surface)',
    outline: 'none',
    width: 220,
  };

  return (
    <div style={{ padding: 24, background: 'var(--color-surface-subtle)', minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0, lineHeight: '28px' }}>
            Clients
          </h1>
          <p style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)', margin: '4px 0 0 0' }}>
            {totalCount} client{totalCount !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          to="/clients/new"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 14px',
            height: 32,
            background: 'var(--color-accent)',
            color: '#ffffff',
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 6,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          + Add Client
        </Link>
      </div>

      {/* Filters bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 16,
      }}>
        <select
          value={stageFilter}
          onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}
          style={selectStyle}
        >
          <option value="all">All Stages</option>
          <option value="A">Stage A</option>
          <option value="B">Stage B</option>
          <option value="C">Stage C</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          style={selectStyle}
        >
          <option value="all">All Statuses</option>
          <option value="lead">Lead</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="offboarded">Offboarded</option>
        </select>
        <div style={{ marginLeft: 'auto' }}>
          <input
            type="text"
            placeholder="Search clients..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={inputStyle}
          />
        </div>
      </div>

      {/* Table card */}
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        overflow: 'hidden',
      }}>
        <table className="data-grid" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', width: 60 }}>Stage</th>
              <th style={{ textAlign: 'left' }}>Name</th>
              <th style={{ textAlign: 'left' }}>Type</th>
              <th style={{ textAlign: 'left' }}>Status</th>
              <th style={{ textAlign: 'left' }}>Contact</th>
              <th style={{ textAlign: 'right' }}>Annual Income</th>
              <th style={{ textAlign: 'left', width: 80 }}>Portal</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--color-text-muted)', fontSize: 13 }}>
                  Loading clients...
                </td>
              </tr>
            )}

            {!isLoading && clients.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--color-text-muted)', fontSize: 12, fontStyle: 'italic' }}>
                  No clients found. Add your first client to get started.
                </td>
              </tr>
            )}

            {clients.map((client) => {
              const badge = statusBadge[client.status] ?? { bg: '#f3f4f6', text: '#374151' };
              return (
                <tr key={client.id}>
                  <td>
                    <span style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: stageDotColor[client.stage] ?? '#9ca3af',
                      verticalAlign: 'middle',
                      marginRight: 6,
                    }} />
                    <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{client.stage}</span>
                  </td>
                  <td>
                    <Link
                      to={`/clients/${client.id}`}
                      style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', textDecoration: 'none' }}
                    >
                      {client.name}
                    </Link>
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{client.type ?? '\u2014'}</td>
                  <td>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 500,
                      background: badge.bg,
                      color: badge.text,
                      textTransform: 'capitalize',
                    }}>
                      {client.status}
                    </span>
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{client.primary_contact_name ?? '\u2014'}</td>
                  <td style={{ textAlign: 'right', fontSize: 13, color: 'var(--color-text-primary)' }}>
                    {client.annual_income ? `\u00A3${client.annual_income.toLocaleString()}` : '\u2014'}
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 500,
                      background: client.portal_enabled ? '#d1fae5' : '#f3f4f6',
                      color: client.portal_enabled ? '#065f46' : '#6b7280',
                    }}>
                      {client.portal_enabled ? 'Enabled' : 'Off'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.total > pagination.limit && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 0 0 0',
          fontSize: 12,
          color: 'var(--color-text-muted)',
        }}>
          <span>
            Showing {(pagination.page - 1) * pagination.limit + 1}\u2013{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                background: 'var(--color-surface)',
                color: 'var(--color-text-secondary)',
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
                opacity: page <= 1 ? 0.4 : 1,
              }}
            >
              Prev
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page * pagination.limit >= pagination.total}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                background: 'var(--color-surface)',
                color: 'var(--color-text-secondary)',
                cursor: page * pagination.limit >= pagination.total ? 'not-allowed' : 'pointer',
                opacity: page * pagination.limit >= pagination.total ? 0.4 : 1,
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

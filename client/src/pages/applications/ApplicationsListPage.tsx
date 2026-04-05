import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Application } from '@shared/types/database';

const statusBadge: Record<string, { bg: string; text: string }> = {
  researching: { bg: '#f3f4f6', text: '#374151' },
  gate1_pending: { bg: '#dbeafe', text: '#1e40af' },
  gate1_failed: { bg: '#fee2e2', text: '#991b1b' },
  gate2_pending: { bg: '#dbeafe', text: '#1e40af' },
  gate2_high_risk: { bg: '#fef3c7', text: '#92400e' },
  drafting: { bg: '#fef3c7', text: '#92400e' },
  gate3_pending: { bg: '#dbeafe', text: '#1e40af' },
  draft_ready: { bg: '#fef3c7', text: '#92400e' },
  awaiting_approval: { bg: '#fef3c7', text: '#92400e' },
  submitted: { bg: '#dbeafe', text: '#1e40af' },
  successful: { bg: '#d1fae5', text: '#065f46' },
  unsuccessful: { bg: '#fee2e2', text: '#991b1b' },
  withdrawn: { bg: '#f3f4f6', text: '#374151' },
};

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ApplicationsListPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['applications', page, statusFilter, search],
    queryFn: () =>
      api.paginated<Application>(
        `/applications?page=${page}&limit=25${statusFilter !== 'all' ? `&status=${statusFilter}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`
      ),
  });

  const applications = data?.success ? data.data : [];
  const pagination = data?.success && 'pagination' in data ? data.pagination : null;
  const totalCount = pagination?.total ?? applications.length;

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

  function renderGateCircle(passed: boolean | null | undefined, failed: boolean): React.ReactNode {
    if (passed === true) {
      return (
        <span style={{
          display: 'inline-block',
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: 'var(--color-success)',
        }} />
      );
    }
    if (failed) {
      return (
        <span style={{
          display: 'inline-block',
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: 'var(--color-danger)',
        }} />
      );
    }
    return (
      <span style={{
        display: 'inline-block',
        width: 14,
        height: 14,
        borderRadius: '50%',
        border: '2px solid #d1d5db',
        background: 'transparent',
        boxSizing: 'border-box',
      }} />
    );
  }

  return (
    <div style={{ padding: 24, background: 'var(--color-surface-subtle)', minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0, lineHeight: '28px' }}>
            Applications
          </h1>
          <p style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)', margin: '4px 0 0 0' }}>
            {totalCount} application{totalCount !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          to="/applications/new"
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
          + New Application
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
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          style={selectStyle}
        >
          <option value="all">All Statuses</option>
          <option value="researching">Researching</option>
          <option value="gate1_pending">Gate 1 Pending</option>
          <option value="gate2_pending">Gate 2 Pending</option>
          <option value="drafting">Drafting</option>
          <option value="gate3_pending">Gate 3 Pending</option>
          <option value="draft_ready">Draft Ready</option>
          <option value="awaiting_approval">Awaiting Approval</option>
          <option value="submitted">Submitted</option>
          <option value="successful">Successful</option>
          <option value="unsuccessful">Unsuccessful</option>
        </select>
        <div style={{ marginLeft: 'auto' }}>
          <input
            type="text"
            placeholder="Search applications..."
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
              <th style={{ textAlign: 'left' }}>Funder</th>
              <th style={{ textAlign: 'left' }}>Project</th>
              <th style={{ textAlign: 'left' }}>Status</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th style={{ textAlign: 'left' }}>Deadline</th>
              <th style={{ textAlign: 'left', width: 80 }}>Gates</th>
              <th style={{ textAlign: 'left' }}>Approval</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--color-text-muted)', fontSize: 13 }}>
                  Loading applications...
                </td>
              </tr>
            )}

            {!isLoading && applications.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--color-text-muted)', fontSize: 12, fontStyle: 'italic' }}>
                  No applications found.
                </td>
              </tr>
            )}

            {applications.map((app) => {
              const badge = statusBadge[app.status] ?? { bg: '#f3f4f6', text: '#374151' };
              const gate1Failed = app.gate1_passed === false;
              const gate2Failed = app.gate2_risk_level === 'high_risk' && !app.gate2_passed;
              const gate3Failed = app.gate3_passed === false;

              return (
                <tr key={app.id}>
                  <td>
                    <Link
                      to={`/applications/${app.id}`}
                      style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', textDecoration: 'none' }}
                    >
                      {app.funder_name}
                    </Link>
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{app.project_name ?? '\u2014'}</td>
                  <td>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 500,
                      background: badge.bg,
                      color: badge.text,
                      whiteSpace: 'nowrap',
                    }}>
                      {formatStatusLabel(app.status)}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 13, color: 'var(--color-text-primary)' }}>
                    {app.amount_requested ? `\u00A3${app.amount_requested.toLocaleString()}` : '\u2014'}
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    {app.deadline ? new Date(app.deadline).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {renderGateCircle(app.gate1_passed, gate1Failed)}
                      {renderGateCircle(app.gate2_passed, gate2Failed)}
                      {renderGateCircle(app.gate3_passed, gate3Failed)}
                    </div>
                  </td>
                  <td>
                    {app.operator_approval ? (
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 500,
                        background: '#d1fae5',
                        color: '#065f46',
                      }}>
                        Approved
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        Pending
                      </span>
                    )}
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

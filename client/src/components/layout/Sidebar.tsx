import { NavLink, useLocation } from 'react-router-dom';
import { useState } from 'react';

interface StageItem {
  id: string;
  title: string;
  subtitle: string;
  count: number;
  variant: 'complete' | 'partial';
}

const stages: StageItem[] = [
  { id: 'stage-a', title: 'Stage A — Leads', subtitle: 'New enquiries', count: 8, variant: 'complete' },
  { id: 'stage-b', title: 'Stage B — Active', subtitle: 'Onboarded clients', count: 12, variant: 'complete' },
  { id: 'stage-c', title: 'Stage C — Managed', subtitle: 'Full service clients', count: 3, variant: 'partial' },
];

const quickLinks = [
  { label: 'All Clients', href: '/clients' },
  { label: 'Pipeline', href: '/pipeline' },
  { label: 'Funders', href: '/funders' },
  { label: 'Grant Discovery', href: '/grants' },
  { label: 'Agent Workspace', href: '/agents' },
];

/**
 * Sidebar — SyncCostX Pro design: white background, pipeline stages,
 * search input, and quick links section.
 */
export default function Sidebar() {
  const [search, setSearch] = useState('');
  const location = useLocation();

  return (
    <aside
      className="w-[232px] flex flex-col h-full overflow-y-auto shrink-0"
      style={{
        background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
      }}
    >
      {/* Section header */}
      <div
        className="px-4 pt-4 pb-2 text-[11px] font-medium uppercase tracking-wide"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        Pipeline
      </div>

      {/* Search input */}
      <div className="px-4 pb-3">
        <input
          type="text"
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-8 px-3 text-[13px] rounded-md outline-none transition-colors"
          style={{
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
          }}
        />
      </div>

      {/* Stage items */}
      <div className="flex-1">
        {stages
          .filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
          .map((stage) => {
            const isActive = location.pathname === `/pipeline/${stage.id}`;

            return (
              <NavLink
                key={stage.id}
                to={`/pipeline/${stage.id}`}
                className="block px-4 py-3 transition-colors"
                style={{
                  background: isActive ? '#eff6ff' : undefined,
                  borderLeft: isActive ? '3px solid var(--color-accent)' : '3px solid transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.background = '#f9fafb';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.background = '';
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div
                      className="text-[13px] font-medium"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {stage.title}
                    </div>
                    <div
                      className="text-[12px] mt-0.5"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {stage.subtitle}
                    </div>
                  </div>
                  <span
                    className="text-[11px] font-medium px-2 py-0.5 rounded-sm"
                    style={{
                      background: stage.variant === 'complete'
                        ? 'var(--color-badge-complete)'
                        : 'var(--color-badge-partial)',
                      color: stage.variant === 'complete'
                        ? 'var(--color-badge-complete-text)'
                        : 'var(--color-badge-partial-text)',
                    }}
                  >
                    {stage.count}
                  </span>
                </div>
              </NavLink>
            );
          })}

        {/* Divider */}
        <div className="mx-4 my-3" style={{ borderTop: '1px solid var(--color-border)' }} />

        {/* Quick Links section */}
        <div
          className="px-4 pb-2 text-[11px] font-medium uppercase tracking-wide"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Quick Links
        </div>

        {quickLinks.map((link) => {
          const isActive = location.pathname.startsWith(link.href);

          return (
            <NavLink
              key={link.href}
              to={link.href}
              className="block px-4 py-2 text-[13px] transition-colors"
              style={{
                color: isActive ? 'var(--color-accent)' : 'var(--color-text-primary)',
                fontWeight: isActive ? 500 : 400,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = '#f9fafb';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = '';
              }}
            >
              {link.label}
            </NavLink>
          );
        })}
      </div>
    </aside>
  );
}

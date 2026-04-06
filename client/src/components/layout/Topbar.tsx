import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useSessionStore } from '../../stores/session';

const tabs = [
  { label: 'Home', path: '/dashboard' },
  { label: 'Clients', path: '/clients' },
  { label: 'Applications', path: '/applications' },
  { label: 'Agents', path: '/agents' },
  { label: 'Documents', path: '/documents' },
  { label: 'Funders', path: '/funders' },
  { label: 'Grants', path: '/grants' },
  { label: 'Reports', path: '/reports' },
  { label: 'Settings', path: '/settings' },
];

/**
 * Top bar — SyncCostX Pro design: dark navy shell with blue accent logo,
 * centered org name, and AI Assistant pill on the right.
 */
export default function Topbar() {
  useAuth(); // auth context available
  const organisation = useSessionStore((s) => s.organisation);
  const location = useLocation();

  return (
    <header className="shrink-0 flex flex-col" style={{ background: 'var(--color-shell-bg)' }}>
      {/* Primary bar — 52px */}
      <div className="h-[52px] flex items-center px-4 relative">
        {/* Left: logo + brand */}
        <div className="flex items-center gap-3">
          {/* Blue square logo */}
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center text-white text-sm font-bold"
            style={{ background: 'var(--color-accent)' }}
          >
            B
          </div>
          <span className="text-sm font-medium" style={{ color: 'var(--color-shell-text)' }}>
            BidBase
          </span>
        </div>

        {/* Center: org name — absolutely centered */}
        {organisation && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[15px] font-medium text-white">
              {organisation.name}
            </span>
          </div>
        )}

        {/* Right: AI Assistant pill */}
        <div className="ml-auto flex items-center gap-3">
          <button
            className="rounded-full text-[13px] font-medium transition-colors"
            style={{
              color: '#a5b4fc',
              border: '1px solid #3b4f6b',
              padding: '6px 14px',
            }}
          >
            AI Assistant
          </button>
        </div>
      </div>

      {/* Tab bar — 40px */}
      <nav
        className="h-10 flex items-center px-4 gap-0"
        style={{ borderTop: '1px solid var(--color-shell-border)' }}
      >
        {tabs.map((tab) => {
          const isActive = tab.path === '/dashboard'
            ? location.pathname === '/' || location.pathname.startsWith('/dashboard')
            : location.pathname.startsWith(tab.path);

          return (
            <Link
              key={tab.label}
              to={tab.path}
              className="h-full flex items-center px-4 text-[13px] font-medium transition-colors"
              style={{
                color: isActive ? '#ffffff' : 'var(--color-shell-muted)',
                fontWeight: isActive ? 500 : 400,
                borderBottom: isActive ? '2px solid var(--color-shell-active)' : '2px solid transparent',
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

import { NavLink, Outlet } from 'react-router-dom';
import { useSessionStore } from '../../stores/session';
import { useAuth } from '../../hooks/useAuth';

const PORTAL_TABS = [
  { to: '/portal', label: 'Dashboard', end: true },
  { to: '/portal/documents', label: 'Documents', end: false },
];

/**
 * Portal layout for client users (client_admin, client_member).
 * Simpler than AppShell: top bar with brand + client org + logout,
 * tab navigation, single-column content area, no sidebar.
 */
export default function PortalLayout() {
  const { logout } = useAuth();
  const organisation = useSessionStore((s) => s.organisation);
  const user = useSessionStore((s) => s.user);

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
      {/* Top bar */}
      <header className="h-11 bg-slate-900 border-b border-slate-700 flex items-center px-4 justify-between shrink-0">
        {/* Left: brand + client org */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-teal-400 tracking-tight">BidBase</span>
          {organisation && (
            <>
              <span className="text-slate-600">|</span>
              <span className="text-sm text-slate-300">{organisation.name}</span>
            </>
          )}
        </div>

        {/* Right: user + logout */}
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-[12px] font-medium text-slate-200">
              {user?.fullName ?? user?.email}
            </div>
            <div className="text-[10px] text-slate-500 capitalize">
              {user?.role?.replace('_', ' ')}
            </div>
          </div>
          <button
            onClick={logout}
            className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Tab navigation */}
      <nav className="flex items-center gap-0.5 px-4 py-1.5 border-b border-slate-200 bg-white">
        {PORTAL_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `px-3 py-1 text-xs font-medium rounded transition-colors ${
                isActive
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

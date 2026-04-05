import { NavLink, Outlet, Navigate, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../stores/session';
import { supabase } from '../../lib/supabase';
import {
  Building2,
  BarChart3,
  MessageSquare,
  Settings,
  LogOut,
  ShieldAlert,
} from 'lucide-react';

const navItems = [
  { to: '/admin/organisations', label: 'Organisations', icon: Building2 },
  { to: '/admin/metrics', label: 'Metrics', icon: BarChart3 },
  { to: '/admin/enquiries', label: 'Enquiries', icon: MessageSquare },
  { to: '/admin/settings', label: 'Platform Settings', icon: Settings },
];

export default function AdminLayout() {
  const { user, clearSession } = useSessionStore();
  const navigate = useNavigate();

  if (user?.role !== 'super_admin') {
    return <Navigate to="/dashboard" replace />;
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
    clearSession();
    navigate('/auth/login');
  };

  return (
    <div className="h-screen flex flex-col bg-slate-100 overflow-hidden">
      {/* Top bar — red/orange accent to distinguish from regular app */}
      <header className="h-12 bg-slate-900 border-b border-orange-600/40 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-orange-500" />
          <span className="text-sm font-semibold text-orange-400 tracking-wide">
            BidBase Admin
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400">
            {user.fullName ?? user.email}
          </span>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <nav className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col py-4 shrink-0">
          <div className="px-3 mb-4">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Administration
            </span>
          </div>
          <ul className="flex flex-col gap-0.5 px-2">
            {navItems.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-orange-600/15 text-orange-400'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`
                  }
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="mt-auto px-3">
            <NavLink
              to="/dashboard"
              className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              &larr; Back to App
            </NavLink>
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

import { Outlet } from 'react-router-dom';
import Topbar from './Topbar';
import Sidebar from './Sidebar';

/**
 * Application shell — SyncCostX Pro layout:
 * - Dark navy top bar with branding and tab navigation
 * - White sidebar with pipeline stages
 * - Light content area
 */
export default function AppShell() {
  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--color-surface-subtle)' }}>
      <Topbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto" style={{ background: 'var(--color-surface-subtle)' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

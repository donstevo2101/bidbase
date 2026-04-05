import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import AppShell from '../components/layout/AppShell';
import ProtectedRoute from '../components/layout/ProtectedRoute';
import LoginPage from '../pages/auth/LoginPage';
import RegisterPage from '../pages/auth/RegisterPage';
import DashboardPage from '../pages/dashboard/DashboardPage';
import ClientsListPage from '../pages/clients/ClientsListPage';
import ClientDetailPage from '../pages/clients/ClientDetailPage';
import ApplicationsListPage from '../pages/applications/ApplicationsListPage';
import OnboardingPage from '../pages/onboarding/OnboardingPage';
import ClientCreatePage from '../pages/clients/ClientCreatePage';
import ApplicationCreatePage from '../pages/applications/ApplicationCreatePage';
import DocumentsPage from '../pages/documents/DocumentsPage';
import AgentWorkspacePage from '../pages/agents/AgentWorkspacePage';
import FundersPage from '../pages/funders/FundersPage';
import SettingsPage from '../pages/settings/SettingsPage';
import ReportsPage from '../pages/reports/ReportsPage';
import PortalLayout from '../pages/portal/PortalLayout';
import PortalDashboard from '../pages/portal/PortalDashboard';
import PortalDocuments from '../pages/portal/PortalDocuments';
import AdminLayout from '../pages/admin/AdminLayout';
import AdminOrgsPage from '../pages/admin/AdminOrgsPage';
import AdminOrgDetailPage from '../pages/admin/AdminOrgDetailPage';
import AdminMetricsPage from '../pages/admin/AdminMetricsPage';
import AdminEnquiriesPage from '../pages/admin/AdminEnquiriesPage';
import EnterpriseLandingPage from '../pages/enterprise/EnterpriseLandingPage';
import { useSessionStore } from '../stores/session';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function AuthInit() {
  const { setSession, clearSession } = useSessionStore();

  useEffect(() => {
    // Check for existing session on app load
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        // Fetch profile
        fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
          .then((r) => r.json())
          .then((result) => {
            if (result.success) {
              setSession({
                accessToken: session.access_token,
                refreshToken: session.refresh_token ?? '',
                user: {
                  id: result.data.user.id,
                  email: result.data.user.email,
                  fullName: result.data.user.fullName,
                  role: result.data.user.role,
                  avatarUrl: result.data.user.avatarUrl,
                },
                organisation: result.data.organisation
                  ? {
                      id: result.data.organisation.id,
                      name: result.data.organisation.name,
                      slug: result.data.organisation.slug,
                      plan: result.data.organisation.plan,
                      active: result.data.organisation.active,
                      onboardingComplete: result.data.organisation.onboarding_complete,
                      branding: result.data.organisation.branding,
                    }
                  : null,
              });
            } else {
              clearSession();
            }
          })
          .catch(() => clearSession());
      } else {
        clearSession();
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        clearSession();
      }
    });

    return () => subscription.unsubscribe();
  }, [setSession, clearSession]);

  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthInit />
        <Routes>
          {/* Auth routes — no shell */}
          <Route path="/auth/login" element={<LoginPage />} />
          <Route path="/auth/register" element={<RegisterPage />} />

          {/* Onboarding — no shell, but requires auth */}
          <Route path="/onboarding" element={
            <ProtectedRoute><OnboardingPage /></ProtectedRoute>
          } />

          {/* Protected routes — wrapped in AppShell */}
          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/clients" element={<ClientsListPage />} />
            <Route path="/clients/new" element={<ClientCreatePage />} />
            <Route path="/clients/:id" element={<ClientDetailPage />} />
            <Route path="/applications" element={<ApplicationsListPage />} />
            <Route path="/applications/new" element={<ApplicationCreatePage />} />
            <Route path="/pipeline" element={<PlaceholderPage title="Pipeline" />} />
            <Route path="/funders" element={<FundersPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/agents" element={<AgentWorkspacePage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          {/* Super admin panel — separate layout, not inside AppShell */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<AdminOrgsPage />} />
            <Route path="organisations" element={<AdminOrgsPage />} />
            <Route path="organisations/:id" element={<AdminOrgDetailPage />} />
            <Route path="metrics" element={<AdminMetricsPage />} />
            <Route path="enquiries" element={<AdminEnquiriesPage />} />
          </Route>

          {/* Enterprise public landing page — no auth required */}
          <Route path="/enterprise" element={<EnterpriseLandingPage />} />

          {/* Client portal — separate layout, no sidebar */}
          <Route
            path="/portal"
            element={
              <ProtectedRoute>
                <PortalLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<PortalDashboard />} />
            <Route path="documents" element={<PortalDocuments />} />
          </Route>

          {/* Default redirect */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" richColors />
    </QueryClientProvider>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-slate-700">{title}</h2>
        <p className="text-sm text-slate-400 mt-1">Coming in Phase 2</p>
      </div>
    </div>
  );
}

import { create } from 'zustand';
import type { UserRole } from '@shared/types/database';

interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  avatarUrl: string | null;
}

interface SessionOrg {
  id: string;
  name: string;
  slug: string;
  plan: string;
  active: boolean;
  onboardingComplete: boolean;
  branding: Record<string, unknown>;
}

interface SessionState {
  accessToken: string | null;
  refreshToken: string | null;
  user: SessionUser | null;
  organisation: SessionOrg | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setSession: (params: {
    accessToken: string;
    refreshToken: string;
    user: SessionUser;
    organisation: SessionOrg | null;
  }) => void;

  clearSession: () => void;
  setLoading: (loading: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  organisation: null,
  isAuthenticated: false,
  isLoading: true,

  setSession: ({ accessToken, refreshToken, user, organisation }) =>
    set({
      accessToken,
      refreshToken,
      user,
      organisation,
      isAuthenticated: true,
      isLoading: false,
    }),

  clearSession: () =>
    set({
      accessToken: null,
      refreshToken: null,
      user: null,
      organisation: null,
      isAuthenticated: false,
      isLoading: false,
    }),

  setLoading: (isLoading) => set({ isLoading }),
}));

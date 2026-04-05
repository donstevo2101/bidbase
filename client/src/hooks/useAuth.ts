import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useSessionStore } from '../stores/session';

export function useAuth() {
  const navigate = useNavigate();
  const { setSession, clearSession, isAuthenticated, user, organisation } = useSessionStore();

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      user: {
        id: string;
        email: string;
        fullName: string | null;
        role: string;
        organisationId: string | null;
      };
    }>('/auth/login', { email, password });

    if (!result.success) {
      throw new Error(result.error.message);
    }

    const token = result.data.accessToken;

    // Fetch full profile with org data — pass token directly since store isn't set yet
    const meRes = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meResult = await meRes.json();

    if (!meResult.success) {
      throw new Error(meResult.error?.message ?? 'Failed to fetch profile');
    }

    const { user: userData, organisation: orgData } = meResult.data as {
      user: {
        id: string;
        email: string;
        fullName: string | null;
        role: string;
        avatarUrl: string | null;
      };
      organisation: {
        id: string;
        name: string;
        slug: string;
        plan: string;
        active: boolean;
        onboarding_complete: boolean;
        branding: Record<string, unknown>;
      } | null;
    };

    setSession({
      accessToken: result.data.accessToken,
      refreshToken: result.data.refreshToken,
      user: {
        id: userData.id,
        email: userData.email,
        fullName: userData.fullName,
        role: userData.role as any,
        avatarUrl: userData.avatarUrl,
      },
      organisation: orgData
        ? {
            id: orgData.id,
            name: orgData.name,
            slug: orgData.slug,
            plan: orgData.plan,
            active: orgData.active,
            onboardingComplete: orgData.onboarding_complete,
            branding: orgData.branding,
          }
        : null,
    });

    // Route based on state
    if (!orgData) {
      navigate('/onboarding');
    } else {
      navigate('/dashboard');
    }
  }, [navigate, setSession]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout', {});
    clearSession();
    navigate('/auth/login');
  }, [navigate, clearSession]);

  const register = useCallback(async (email: string, password: string, fullName: string) => {
    const result = await api.post<{ userId: string; message: string }>('/auth/register', {
      email,
      password,
      fullName,
    });

    if (!result.success) {
      throw new Error(result.error.message);
    }

    return result.data;
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const result = await api.post<{ message: string }>('/auth/reset-password', { email });

    if (!result.success) {
      throw new Error(result.error.message);
    }

    return result.data;
  }, []);

  return {
    login,
    logout,
    register,
    resetPassword,
    isAuthenticated,
    user,
    organisation,
  };
}

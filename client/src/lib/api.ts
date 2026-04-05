import type { ApiResponse, ApiPaginatedResponse } from '@shared/types/api';

// In production, VITE_API_URL points to the Railway backend (e.g. https://bidbase-api.up.railway.app/api)
// In development, Vite proxy handles /api → localhost:3001
export const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function getAccessToken(): Promise<string | null> {
  // Read from Zustand store — avoids localStorage for tokens
  const { useSessionStore } = await import('../stores/session');
  return useSessionStore.getState().accessToken;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = await getAccessToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  return res.json() as Promise<ApiResponse<T>>;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),

  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),

  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),

  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  paginated: async <T>(path: string): Promise<ApiPaginatedResponse<T>> => {
    const token = await getAccessToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, { headers });
    return res.json() as Promise<ApiPaginatedResponse<T>>;
  },
};

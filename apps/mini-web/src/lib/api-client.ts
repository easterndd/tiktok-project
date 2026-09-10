import type { ApiErrorResponse } from '@breezereels/shared-types';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

class ApiClient {
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = sessionStorage.getItem('breezereels_access_token');
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as ApiErrorResponse | null;
      throw new Error(body?.error.message ?? 'The request could not be completed.');
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  get<T>(path: string) { return this.request<T>(path); }
  post<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) }); }
  put<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) }); }
}

export const apiClient = new ApiClient();

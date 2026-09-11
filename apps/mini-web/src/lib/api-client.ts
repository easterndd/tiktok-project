import type { ApiErrorResponse } from '@breezereels/shared-types';
import { mockApiRequest } from './mock-api';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';
const useMockApi = import.meta.env.VITE_USE_MOCK_API === 'true' || import.meta.env.VITE_DEMO_MODE !== 'false';
const enableMockFallback = import.meta.env.VITE_ENABLE_MOCK_FALLBACK !== 'false';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class ApiClient {
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const parsedBody = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    if (useMockApi) return mockApiRequest<T>({ method, path, body: parsedBody });

    const token = sessionStorage.getItem('breezereels_access_token');
    try {
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
        throw new ApiError(
          body?.error.message ?? 'The request could not be completed.',
          response.status,
          body?.error.code
        );
      }
      if (response.status === 204) return undefined as T;
      return response.json() as Promise<T>;
    } catch (error) {
      if (!enableMockFallback || error instanceof ApiError) throw error;
      return mockApiRequest<T>({ method, path, body: parsedBody });
    }
  }

  get<T>(path: string) { return this.request<T>(path); }
  post<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) }); }
  put<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) }); }
  patch<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }); }
}

export const apiClient = new ApiClient();

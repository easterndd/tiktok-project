import type { ApiErrorResponse } from '@quickreels/shared-types';
import { mockApiRequest } from './mock-api';
import { getSessionToken } from './storage';
import { reportDiagnostic } from './diagnostics';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
  ?? (import.meta.env.VITE_APP_KEY && import.meta.env.VITE_APP_KEY !== 'main' ? `http://localhost:3000/api/${import.meta.env.VITE_APP_KEY}/v1` : 'http://localhost:3000/api/v1');
const useMockApi = import.meta.env.VITE_USE_MOCK_API === 'true' || import.meta.env.VITE_DEMO_MODE === 'true';
const enableMockFallback = import.meta.env.VITE_ENABLE_MOCK_FALLBACK === 'true';

type UnauthorizedHandler = () => Promise<void>;
let unauthorizedHandler: UnauthorizedHandler | null = null;
let pendingUnauthorizedRecovery: Promise<void> | null = null;

export function registerUnauthorizedHandler(handler: UnauthorizedHandler) {
  unauthorizedHandler = handler;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class ApiClient {
  async request<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
    const method = options.method ?? 'GET';
    const parsedBody = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    if (useMockApi) return mockApiRequest<T>({ method, path, body: parsedBody });

    const token = getSessionToken();
    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await fetch(`${apiBaseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers
        }
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as ApiErrorResponse | null;
        if (response.status === 401 && !retried && path !== '/auth/anonymous/session' && unauthorizedHandler) {
          pendingUnauthorizedRecovery ??= unauthorizedHandler().finally(() => { pendingUnauthorizedRecovery = null; });
          await pendingUnauthorizedRecovery;
          return this.request<T>(path, options, true);
        }
        throw new ApiError(
          body?.error.message ?? 'The request could not be completed.',
          response.status,
          body?.error.code,
          body?.error.requestId
        );
      }
      if (response.status === 204) return undefined as T;
      return response.json() as Promise<T>;
    } catch (error) {
      if (!/\/(ad-events|playback-quality-events|runtime-errors)(?:\?|$)/.test(path) && (timedOut || !controller.signal.aborted)) {
        reportDiagnostic({ kind: path.includes('/auth/') || path.includes('/app-entry-ad-sessions') ? 'STARTUP' : path.includes('/episodes') ? 'PLAYBACK' : 'API',
          phase: `${method} ${path.split('?')[0]}`.slice(0, 80), path,
          message: timedOut ? 'Request timed out after 20 seconds' : error instanceof Error ? error.message : String(error),
          statusCode: error instanceof ApiError ? error.status : 0,
          requestId: error instanceof ApiError ? error.requestId : undefined, durationMs: Date.now() - startedAt });
      }
      if (!enableMockFallback || error instanceof ApiError) throw error;
      return mockApiRequest<T>({ method, path, body: parsedBody });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  get<T>(path: string) { return this.request<T>(path); }
  post<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) }); }
  put<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) }); }
  patch<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }); }
}

export const apiClient = new ApiClient();

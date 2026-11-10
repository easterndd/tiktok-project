import type { ApiErrorResponse } from '@quickreels/shared-types';
import { mockApiRequest } from './mock-api';
import { getSessionToken } from './storage';
import { reportDiagnostic, reportPerformance } from './diagnostics';
import { recordDebugRequest } from './analytics';
import { boundedDebugValue, debugHeaders, debugQueryParams, debugResponseDetails } from './debug-network';
import { debugPanelActive } from './debug-panel';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
  ?? (import.meta.env.VITE_APP_KEY && import.meta.env.VITE_APP_KEY !== 'main' ? `http://localhost:3000/api/${import.meta.env.VITE_APP_KEY}/v1` : 'http://localhost:3000/api/v1');
const useMockApi = import.meta.env.VITE_USE_MOCK_API === 'true' || import.meta.env.VITE_DEMO_MODE === 'true';
const enableMockFallback = import.meta.env.VITE_ENABLE_MOCK_FALLBACK === 'true';
const debugEnabled = debugPanelActive;

function shouldMeasureRequest(path: string) {
  const route = path.split('?', 1)[0];
  return route === '/home'
    || route === '/home/progress'
    || route === '/auth/anonymous/session'
    || route === '/app-entry-ad-sessions'
    || /^\/app-entry-ad-sessions\/[^/]+\/complete$/.test(route)
    || route === '/ad-events'
    || route === '/episode-interstitial/config'
    || /^\/albums\/[^/]+$/.test(route)
    || /^\/albums\/[^/]+\/episodes$/.test(route)
    || /^\/episodes\/[^/]+\/play$/.test(route)
    || /\/episodes\/[^/]+\/reward-session(?:\/[^/]+\/complete)?$/.test(route);
}

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
    public readonly requestId?: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class ApiClient {
  async request<T>(path: string, options: RequestInit = {}, retried = false, authenticate = true): Promise<T> {
    const method = options.method ?? 'GET';
    let parsedBody: unknown;
    if (useMockApi || enableMockFallback || debugEnabled()) {
      try { parsedBody = typeof options.body === 'string' ? JSON.parse(options.body) : options.body; }
      catch { parsedBody = options.body; }
    }
    if (useMockApi) return mockApiRequest<T>({ method, path, body: parsedBody });

    const token = getSessionToken();
    const startedAt = Date.now();
    const requestUrl = debugEnabled() ? new URL(`${apiBaseUrl}${path}`, window.location.origin) : undefined;
    const crossOrigin = requestUrl ? requestUrl.origin !== window.location.origin : undefined;
    const headers = new Headers({ Accept: 'application/json' });
    if (options.body) headers.set('Content-Type', 'application/json');
    if (authenticate && token) headers.set('Authorization', `Bearer ${token}`);
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    const preflightRequired = crossOrigin === true && (headers.has('authorization') || Boolean(options.body) || !['GET', 'HEAD', 'POST'].includes(method.toUpperCase()));
    const requestSnapshot = requestUrl ? {
      startedAt: new Date(startedAt).toISOString(),
      url: requestUrl.origin + requestUrl.pathname,
      queryParams: boundedDebugValue(debugQueryParams(requestUrl)),
      requestHeaders: boundedDebugValue(debugHeaders(headers)),
      requestBody: boundedDebugValue(parsedBody)
    } : {};
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
    const abort = () => controller.abort();
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener('abort', abort, { once: true });
    let response: Response | undefined;
    let responseBody: unknown;
    try {
      response = await fetch(`${apiBaseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers
      });
      if (!response.ok) {
        let body: ApiErrorResponse | null = null;
        if (debugEnabled()) {
          const rawBody = await response.text().catch(() => '');
          try { body = JSON.parse(rawBody) as ApiErrorResponse; } catch { /* A gateway may return HTML or plain text. */ }
          responseBody = body ?? rawBody;
        } else body = await response.json().catch(() => null) as ApiErrorResponse | null;
        if (authenticate && response.status === 401 && !retried && !path.startsWith('/auth/') && unauthorizedHandler) {
          const responseDurationMs = Date.now() - startedAt;
          if (debugEnabled()) recordDebugRequest({
            method, path: path.split('?', 1)[0], statusCode: response.status, durationMs: responseDurationMs,
            errorCode: body?.error?.code, error: body?.error?.message ?? 'HTTP 401', ...requestSnapshot,
            ...debugResponseDetails(response, responseBody)
          });
          pendingUnauthorizedRecovery ??= unauthorizedHandler().finally(() => { pendingUnauthorizedRecovery = null; });
          await pendingUnauthorizedRecovery;
          return this.request<T>(path, options, true, authenticate);
        }
        throw new ApiError(
          body?.error?.message ?? 'The request could not be completed.',
          response.status,
          body?.error?.code,
          body?.error?.requestId ?? response.headers.get('x-request-id') ?? undefined,
          response.status === 429 || response.status === 503 ? parseRetryAfter(response.headers.get('Retry-After')) : undefined
        );
      }
      const data = response.status === 204 ? undefined as T : await response.json() as T;
      if (debugEnabled()) recordDebugRequest({
        method, path: path.split('?', 1)[0], statusCode: response.status, durationMs: Date.now() - startedAt,
        ...requestSnapshot, ...debugResponseDetails(response, data)
      });
      if (shouldMeasureRequest(path)) {
        reportPerformance('API_RESPONSE', `${method} ${path}`, Date.now() - startedAt, {
          statusCode: response.status,
          serverTiming: response.headers.get('server-timing')
        });
      }
      return data;
    } catch (error) {
      if (debugEnabled()) recordDebugRequest({
        method, path: path.split('?', 1)[0], statusCode: error instanceof ApiError ? error.status : response?.status ?? 0,
        durationMs: Date.now() - startedAt, errorCode: error instanceof ApiError ? error.code : undefined,
        error: error instanceof Error ? error.message : String(error), errorName: error instanceof Error ? error.name : undefined,
        pageOrigin: window.location.origin, apiOrigin: requestUrl?.origin, crossOrigin, preflightRequired,
        browserOnline: navigator.onLine, timedOut, aborted: controller.signal.aborted,
        ...requestSnapshot, ...debugResponseDetails(response, responseBody),
        requestId: error instanceof ApiError ? error.requestId : response?.headers.get('x-request-id')
      });
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
      options.signal?.removeEventListener('abort', abort);
    }
  }

  get<T>(path: string) { return this.request<T>(path); }
  getPublic<T>(path: string) { return this.request<T>(path, {}, false, false); }
  post<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) }); }
  put<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) }); }
  patch<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }); }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(300, Math.ceil(seconds));
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.min(300, Math.max(0, Math.ceil((date - Date.now()) / 1000)));
}

export const apiClient = new ApiClient();

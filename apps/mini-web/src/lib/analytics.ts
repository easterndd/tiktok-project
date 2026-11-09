import { appKey, storagePrefix } from './app-brand';
import { getSessionToken } from './storage';
import { boundedDebugValue, debugHeaders, debugResponseDetails } from './debug-network';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
  ?? (import.meta.env.VITE_APP_KEY && import.meta.env.VITE_APP_KEY !== 'main' ? `http://localhost:3000/api/${import.meta.env.VITE_APP_KEY}/v1` : 'http://localhost:3000/api/v1');
const releaseId = import.meta.env.VITE_MINI_RELEASE_ID || 'default';
const appVersion = import.meta.env.VITE_APP_VERSION || releaseId;
const debugEnabled = import.meta.env.VITE_DEBUG_PANEL === 'true';
const instrumentedApps = new Set(['dramaflicks', 'heartreel', 'zenclip', 'sweetreel', 'luxereel']);
const maxQueueSize = 50;
const flushSize = 10;
const flushDelayMs = 2_000;
const maxBatchSize = 10;
const maxUploadAttempts = 3;

export type AnalyticsEventKey = 'app_open' | 'ad_config' | 'ad_load' | 'ad_show' | 'ad_close';
export type AnalyticsResult = 'success' | 'fail' | 'timeout' | 'unsupported';
export type SdkErrorDetails = {
  errorCode?: string;
  errorMsg?: string;
  subErrorCode?: string;
  errorExtra?: unknown;
};
export type SdkCallbackSnapshot = {
  name: string;
  payload: unknown;
  capturedAt: string;
};
export type AnalyticsEvent = {
  eventId: string;
  eventKey: AnalyticsEventKey;
  releaseId: string;
  launchId: string;
  clientSessionId: string;
  eventTs: string;
  platform: 'android' | 'ios' | 'web' | 'unknown';
  appVersion: string;
  tiktokClientVersion?: string;
  sdkVersion?: string;
  placementId?: string;
  adType?: 'REWARDED' | 'INTERSTITIAL';
  adSeq?: number;
  operationId?: string;
  attemptNo?: number;
  adPhase?: string;
  errorOrigin?: 'SDK_CALLBACK' | 'SDK_PROMISE' | 'APP_TIMEOUT' | 'API_HTTP' | 'UNKNOWN';
  strategyVariant?: string;
  placementRole?: 'PRIMARY' | 'BACKUP';
  result?: AnalyticsResult;
  isEnded?: boolean | null;
  durationMs?: number;
  shouldShow?: number | null;
  errorCode?: string;
  errorMsg?: string;
  subErrorCode?: string;
  errorExtra?: unknown;
  path?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
};

export type DebugRecord = {
  id: number;
  at: string;
  kind: 'event' | 'request' | 'runtime';
  data: Record<string, unknown>;
};

const queue: Array<{ event: AnalyticsEvent; attempts: number }> = [];
const debugRecords: DebugRecord[] = [];
const debugListeners = new Set<() => void>();
let flushTimer: number | undefined;
let flushing = false;
let adSequence = 0;
let debugSequence = 0;

export function nextAdSequence() {
  adSequence += 1;
  return adSequence;
}

export function newAdOperationId(kind: string, adSeq: number) {
  return kind + '-' + adSeq + '-' + uuid('operation');
}

function scheduleFlush(delayMs: number) {
  if (flushTimer !== undefined || queue.length === 0) return;
  flushTimer = window.setTimeout(() => { flushTimer = undefined; void flushAnalytics(); }, delayMs);
}

function redactText(value: string) {
  return value.replace(/https?:\/\/[^\s]+/gi, '[URL]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:token|password|secret|authorization|auth.?code|cookie|signature|ttclid|ttoclid|click_id)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 1_000);
}

function uuid(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreateSessionId() {
  const key = `${storagePrefix}_analytics_session_id`;
  const saved = sessionStorage.getItem(key);
  if (saved) return saved;
  const value = uuid('session');
  sessionStorage.setItem(key, value);
  return value;
}

function getLaunchId() {
  const key = releaseId === 'default' ? `${storagePrefix}_launch_id` : `${storagePrefix}_${releaseId}_launch_id`;
  const saved = sessionStorage.getItem(key);
  if (saved) return saved;
  const value = uuid('launch');
  sessionStorage.setItem(key, value);
  return value;
}

function systemInfo() {
  try {
    const minis = window.TTMinis as unknown as { game?: { getSystemInfoSync?: () => Record<string, unknown> }; getSystemInfoSync?: () => Record<string, unknown> } | undefined;
    const info = minis?.game?.getSystemInfoSync?.() ?? minis?.getSystemInfoSync?.() ?? {};
    const rawPlatform = String(info.platform ?? info.OS ?? '').toLowerCase();
    const platform: AnalyticsEvent['platform'] = rawPlatform.includes('android') ? 'android' : rawPlatform.includes('ios') ? 'ios' : rawPlatform ? 'unknown' : userAgentPlatform();
    return { platform, tiktokClientVersion: stringValue(info.version ?? info.clientVersion ?? info.appVersion), sdkVersion: stringValue(info.SDKVersion ?? info.sdkVersion ?? info.sdk_version) };
  } catch {
    return { platform: userAgentPlatform() };
  }
}

function userAgentPlatform(): AnalyticsEvent['platform'] {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
  return 'web';
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.length <= 64 ? value : undefined;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null || typeof value !== 'object') return typeof value === 'string' ? redactText(value) : value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeValue(item, depth + 1));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
    if (/(?:token|secret|password|authorization|auth.?code|openid|open_id|cookie|signature|signed.?url|ttclid|ttoclid|click_id|session.?id|user.?id|email|phone)/i.test(key)) {
      output[key] = '[REDACTED]';
    } else if (key.toLowerCase() === 'access-control-allow-origin' && typeof item === 'string') {
      try { output[key] = item === '*' ? '*' : new URL(item).origin; } catch { output[key] = '[REDACTED]'; }
    } else if (/^url$/i.test(key) && typeof item === 'string') {
      try { output[key] = new URL(item).origin + new URL(item).pathname; } catch { output[key] = '[URL]'; }
    } else output[key] = sanitizeValue(item, depth + 1);
  }
  return output;
}

function boundedErrorExtra(value: unknown) {
  if (value === undefined) return undefined;
  const sanitized = sanitizeValue(value);
  try {
    const encoded = JSON.stringify(sanitized);
    if (!encoded) return undefined;
    return encoded.length <= 4_096 ? sanitized : { truncated: true, preview: encoded.slice(0, 3_000) };
  } catch {
    return { truncated: true, preview: '[Unserializable SDK error_extra]' };
  }
}

function callbackPayload(value: unknown): unknown {
  try {
    if (value instanceof Error) {
      const errorRecord: Record<string, unknown> = {
        name: value.name,
        message: value.message,
        stack: value.stack
      };
      for (const key of Object.getOwnPropertyNames(value)) {
        try { errorRecord[key] = (value as unknown as Record<string, unknown>)[key]; } catch { errorRecord[key] = '[Unreadable]'; }
      }
      return sanitizeValue(errorRecord);
    }
    if (value && typeof value === 'object') {
      const source = value as Record<string, unknown>;
      const entries = Object.getOwnPropertyNames(value).map((key) => {
        try { return [key, source[key]] as const; } catch { return [key, '[Unreadable]'] as const; }
      });
      return sanitizeValue(Object.fromEntries(entries));
    }
    return sanitizeValue(value);
  } catch {
    return '[Unserializable SDK callback]';
  }
}

export function captureSdkCallback(name: string, payload: unknown = null): SdkCallbackSnapshot {
  const sanitized = callbackPayload(payload);
  try {
    const encoded = JSON.stringify(sanitized);
    return { name, payload: encoded && encoded.length > 4_096 ? { truncated: true, preview: encoded.slice(0, 3_000) } : sanitized, capturedAt: new Date().toISOString() };
  } catch {
    return { name, payload: { truncated: true, preview: '[Unserializable SDK callback]' }, capturedAt: new Date().toISOString() };
  }
}

function callbackMetadata(metadata: Record<string, unknown> | undefined, callback: SdkCallbackSnapshot | undefined) {
  if (!callback) return metadata;
  return { ...metadata, sdkCallback: callback };
}

export function normalizeSdkError(error: unknown): SdkErrorDetails {
  if (error == null) return {};
  if (error && typeof error === 'object') {
    const outer = error as Record<string, unknown>;
    const value = outer.error && typeof outer.error === 'object' ? outer.error as Record<string, unknown> : outer;
    const code = value.error_code ?? value.errorCode ?? value.errCode ?? value.code;
    const message = value.error_msg ?? value.errorMsg ?? value.errMsg ?? value.message;
    const subCode = value.sub_error_code ?? value.subErrorCode;
    const extra = value.error_extra ?? value.errorExtra ?? value.inner_error ?? value.innerError
      ?? ((value.inner_error_code != null || value.inner_error_msg != null) ? { inner_error_code: value.inner_error_code, inner_error_msg: value.inner_error_msg } : undefined);
    return {
      errorCode: code == null ? undefined : redactText(String(code)).slice(0, 256),
      errorMsg: message == null ? undefined : redactText(String(message)),
      subErrorCode: subCode == null ? undefined : redactText(String(subCode)).slice(0, 256),
      errorExtra: boundedErrorExtra(extra)
    };
  }
  return { errorMsg: redactText(String(error)) };
}

function addDebugRecord(kind: DebugRecord['kind'], data: Record<string, unknown>) {
  if (!debugEnabled) return;
  debugRecords.push({ id: ++debugSequence, at: new Date().toISOString(), kind, data: sanitizeValue(data) as Record<string, unknown> });
  while (debugRecords.length > 200) debugRecords.shift();
  debugListeners.forEach((listener) => listener());
}

export function subscribeDebugRecords(listener: () => void) {
  debugListeners.add(listener);
  return () => { debugListeners.delete(listener); };
}

export function getDebugRecords() {
  return [...debugRecords];
}

export function getDebugEnvironment() {
  const { platform, tiktokClientVersion, sdkVersion } = systemInfo();
  const endpoint = new URL(apiBaseUrl, window.location.origin);
  return { appKey, releaseId, appVersion, platform, tiktokClientVersion: tiktokClientVersion ?? 'unavailable', sdkVersion: sdkVersion ?? 'unavailable', apiEndpoint: endpoint.origin + endpoint.pathname };
}

export function clearDebugRecords() {
  debugRecords.splice(0, debugRecords.length);
  debugListeners.forEach((listener) => listener());
}

export function recordDebugRequest(data: Record<string, unknown>) {
  addDebugRecord('request', data);
}

export function recordDebugRuntime(data: Record<string, unknown>) {
  addDebugRecord('runtime', data);
}

type AdAnalyticsContext = Pick<AnalyticsEvent, 'adType' | 'operationId' | 'attemptNo' | 'adPhase' | 'errorOrigin' | 'strategyVariant' | 'placementRole'>;

export function recordAdLoadResult(input: { adSeq?: number; placementId: string; supported: boolean; durationMs: number; callback?: SdkCallbackSnapshot; loadMode?: string } & AdAnalyticsContext) {
  recordAdLoad({ ...input, result: input.supported ? 'success' : 'unsupported' });
}

export function recordAnalyticsEvent(input: Omit<AnalyticsEvent, 'eventId' | 'releaseId' | 'launchId' | 'clientSessionId' | 'eventTs' | 'platform' | 'appVersion'>) {
  if (!instrumentedApps.has(appKey)) return;
  const info = systemInfo();
  const event: AnalyticsEvent = {
    ...input,
    eventId: uuid('event'),
    releaseId,
    launchId: getLaunchId(),
    clientSessionId: getOrCreateSessionId(),
    eventTs: new Date().toISOString(),
    platform: info.platform,
    appVersion,
    tiktokClientVersion: info.tiktokClientVersion,
    sdkVersion: info.sdkVersion
  };
  addDebugRecord('event', event as unknown as Record<string, unknown>);
  const sdkCallback = event.metadata?.sdkCallback;
  if (sdkCallback) {
    addDebugRecord('runtime', { phase: 'SDK_CALLBACK', eventKey: event.eventKey, sdkCallback });
    if (debugEnabled) console.debug('[TikTok Minis SDK callback]', event.eventKey, sdkCallback);
  }
  if (import.meta.env.VITE_DEMO_MODE === 'true' || import.meta.env.VITE_USE_MOCK_API === 'true') return event;
  queue.push({ event, attempts: 0 });
  while (queue.length > maxQueueSize) queue.shift();
  if (queue.length >= flushSize) void flushAnalytics();
  else scheduleFlush(flushDelayMs);
  return event;
}

export async function flushAnalytics() {
  if (flushing || queue.length === 0 || import.meta.env.VITE_DEMO_MODE === 'true' || import.meta.env.VITE_USE_MOCK_API === 'true') return;
  const token = getSessionToken();
  if (!token) return;
  flushing = true;
  const batch = queue.splice(0, maxBatchSize);
  const headers = new Headers({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
  const payload = { events: batch.map(({ event }) => event) };
  const startedAt = Date.now();
  const debugEndpoint = debugEnabled ? new URL(`${apiBaseUrl}/analytics/events`, window.location.origin) : undefined;
  const requestSnapshot = debugEndpoint ? {
    startedAt: new Date(startedAt).toISOString(),
    url: debugEndpoint.origin + debugEndpoint.pathname,
    pageOrigin: window.location.origin, apiOrigin: debugEndpoint.origin,
    crossOrigin: debugEndpoint.origin !== window.location.origin,
    preflightRequired: debugEndpoint.origin !== window.location.origin,
    requestHeaders: boundedDebugValue(debugHeaders(headers)), requestBody: boundedDebugValue(payload)
  } : {};
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 5_000);
  let retryDelayMs = flushDelayMs;
  let responseStatus = 0;
  let response: Response | undefined;
  let responseBody: unknown;
  try {
    response = await fetch(`${apiBaseUrl}/analytics/events`, {
      method: 'POST', keepalive: true, headers,
      body: JSON.stringify(payload), signal: controller.signal
    });
    responseStatus = response.status;
    if (debugEnabled) {
      const rawBody = await response.text().catch(() => '');
      try { responseBody = JSON.parse(rawBody); } catch { responseBody = rawBody; }
    }
    if (!response.ok) {
      if (response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('Retry-After'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) retryDelayMs = Math.min(60_000, retryAfter * 1_000);
        throw new Error(`Analytics upload failed with HTTP ${response.status}`);
      }
      if (debugEnabled) addDebugRecord('request', { method: 'POST', path: '/analytics/events', statusCode: response.status, durationMs: Date.now() - startedAt, eventCount: batch.length, error: `HTTP ${response.status}`, ...requestSnapshot, ...debugResponseDetails(response, responseBody) });
      return;
    }
    if (debugEnabled) addDebugRecord('request', { method: 'POST', path: '/analytics/events', statusCode: response.status, durationMs: Date.now() - startedAt, eventCount: batch.length, ...requestSnapshot, ...debugResponseDetails(response, responseBody) });
  } catch (error) {
    if (debugEnabled) addDebugRecord('request', { method: 'POST', path: '/analytics/events', statusCode: responseStatus, durationMs: Date.now() - startedAt, eventCount: batch.length, error: error instanceof Error ? error.message : String(error), browserOnline: navigator.onLine, timedOut, aborted: controller.signal.aborted, ...requestSnapshot, ...debugResponseDetails(response, responseBody) });
    const retryable = batch.filter(({ attempts }) => attempts + 1 < maxUploadAttempts)
      .map(({ event, attempts }) => ({ event, attempts: attempts + 1 }));
    queue.unshift(...retryable);
    queue.splice(maxQueueSize);
    retryDelayMs = Math.max(retryDelayMs, Math.min(30_000, 5_000 * 2 ** (batch[0]?.attempts ?? 0)));
  } finally {
    window.clearTimeout(timeout);
    flushing = false;
    scheduleFlush(retryDelayMs);
  }
}

export function recordAppOpen(metadata: Record<string, unknown> = {}) {
  return recordAnalyticsEvent({ eventKey: 'app_open', metadata });
}

export function recordAdConfig(input: { result: AnalyticsResult; durationMs: number; shouldShow?: number | null; error?: unknown; path?: string }) {
  const error = normalizeSdkError(input.error);
  const requestId = input.error && typeof input.error === 'object' && 'requestId' in input.error && typeof input.error.requestId === 'string' ? input.error.requestId.slice(0, 128) : undefined;
  return recordAnalyticsEvent({ eventKey: 'ad_config', result: input.result, durationMs: Math.max(0, Math.round(input.durationMs)), shouldShow: input.shouldShow, ...error, path: input.path, requestId });
}

export function recordAdLoad(input: { adSeq?: number; placementId?: string; result: AnalyticsResult; durationMs: number; error?: unknown; callback?: SdkCallbackSnapshot; loadMode?: string } & AdAnalyticsContext) {
  const error = normalizeSdkError(input.error);
  return recordAnalyticsEvent({ eventKey: 'ad_load', adSeq: input.adSeq, placementId: input.placementId, adType: input.adType, result: input.result, durationMs: Math.max(0, Math.round(input.durationMs)), operationId: input.operationId, attemptNo: input.attemptNo, adPhase: input.adPhase, errorOrigin: input.errorOrigin, strategyVariant: input.strategyVariant, placementRole: input.placementRole, ...error, metadata: callbackMetadata(input.loadMode ? { loadMode: input.loadMode } : undefined, input.callback) });
}

export function recordAdShow(input: { adSeq?: number; placementId?: string; result: AnalyticsResult; durationMs: number; error?: unknown; callback?: SdkCallbackSnapshot } & AdAnalyticsContext) {
  const error = normalizeSdkError(input.error);
  return recordAnalyticsEvent({ eventKey: 'ad_show', adSeq: input.adSeq, placementId: input.placementId, adType: input.adType, result: input.result, durationMs: Math.max(0, Math.round(input.durationMs)), operationId: input.operationId, attemptNo: input.attemptNo, adPhase: input.adPhase, errorOrigin: input.errorOrigin, strategyVariant: input.strategyVariant, placementRole: input.placementRole, ...error, metadata: callbackMetadata(undefined, input.callback) });
}

export function recordAdClose(input: { adSeq?: number; placementId?: string; isEnded: boolean | null; durationMs: number; error?: unknown; callback?: SdkCallbackSnapshot } & AdAnalyticsContext) {
  const error = normalizeSdkError(input.error);
  return recordAnalyticsEvent({ eventKey: 'ad_close', adSeq: input.adSeq, placementId: input.placementId, adType: input.adType, isEnded: input.isEnded, durationMs: Math.max(0, Math.round(input.durationMs)), operationId: input.operationId, attemptNo: input.attemptNo, adPhase: input.adPhase, errorOrigin: input.errorOrigin, strategyVariant: input.strategyVariant, placementRole: input.placementRole, ...error, metadata: callbackMetadata(undefined, input.callback) });
}

window.addEventListener('pagehide', () => { void flushAnalytics(); });

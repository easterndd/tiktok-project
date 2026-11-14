import { appKey, storagePrefix } from './app-brand';
import { getSessionToken } from './storage';
import { isV006DualRelease, getAdPlatform } from '../features/ads/ad-platform';
import { boundedDebugValue, debugHeaders, debugRequestTarget, debugResponseDetails } from './debug-network';
import { debugRecordCaptureEnabled } from './debug-panel';

type TraceKind = 'SDK_CALL' | 'SDK_CALLBACK' | 'SDK_PROMISE' | 'HTTP_REQUEST' | 'HTTP_RESPONSE' | 'RUNTIME_ERROR' | 'ENTRY_STATE';
type TraceRecord = {
  traceId: string; releaseId: string; platform: string; startedAt: string;
  recordId: string; seq: number; kind: TraceKind; phase: string; eventAt: string;
  operationId?: string; sessionId?: string; requestId?: string; placementId?: string;
  payload: unknown; truncated: boolean;
};

const releaseId = import.meta.env.VITE_MINI_RELEASE_ID || 'default';
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
  ?? (appKey !== 'main' ? `http://localhost:3000/api/${appKey}/v1` : 'http://localhost:3000/api/v1');
const queueKey = `${storagePrefix}_client_trace_queue`;
const traceKey = `${storagePrefix}_${releaseId}_trace_id`;
const traceStartKey = `${traceKey}_started_at`;
const traceSequenceKey = `${traceKey}_sequence`;
const localOnly = import.meta.env.VITE_ENTRY_COMPAT_MODE === 'true';
const maxPending = localOnly ? 500 : 120;
const maxPayloadLength = 16_384;
const sensitiveKey = /(?:authorization|cookie|token|secret|password|auth.?code|openid|open_id|ttclid|ttoclid|click_id|signature|signed.?url|user.?id|email|phone)/i;
let pending: TraceRecord[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let sending = false;
let retryMs = 1_000;
let dropped = 0;
let sequence = 0;
let currentTraceId: string | undefined;
let startedAt = new Date().toISOString();
let debugRequestRecorder: ((data: Record<string, unknown>) => void) | undefined;

try {
  const saved = JSON.parse(localStorage.getItem(queueKey) || '[]') as unknown;
  if (Array.isArray(saved)) pending = saved.filter((item): item is TraceRecord =>
    Boolean(item && typeof item === 'object' && typeof item.traceId === 'string' && typeof item.recordId === 'string'));
} catch { /* Storage can be disabled by the host. */ }

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function traceId() {
  if (currentTraceId) return currentTraceId;
  try {
    const existing = sessionStorage.getItem(traceKey);
    currentTraceId = existing || uuid();
    if (existing) {
      startedAt = sessionStorage.getItem(traceStartKey) || startedAt;
      sequence = Number(sessionStorage.getItem(traceSequenceKey)) || 0;
    } else sessionStorage.setItem(traceStartKey, startedAt);
    sessionStorage.setItem(traceKey, currentTraceId);
  } catch { currentTraceId = uuid(); }
  return currentTraceId;
}

function redactString(value: string) {
  return value.replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:token|password|secret|authorization|auth.?code|cookie|openid|open_id|signature|ttclid|ttoclid|click_id|user.?id|email|phone)\s*[=:]\s*)[^\s,;&]+/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s"']+/gi, (url) => {
      try { const parsed = new URL(url); return parsed.origin + parsed.pathname; }
      catch { return '[URL]'; }
    });
}

function byteLength(value: string) {
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(value).length : value.length * 3;
}

function snapshot(value: unknown) {
  let truncated = false;
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (typeof item === 'string') {
      if (item.length > 8_192) truncated = true;
      return redactString(item.slice(0, 8_192));
    }
    if (typeof item === 'bigint') return item.toString();
    if (typeof item === 'function' || typeof item === 'symbol' || item === undefined) return String(item);
    if (item === null || typeof item !== 'object') return item;
    if (seen.has(item)) return '[Circular]';
    if (depth >= 6) { truncated = true; return '[Depth limit]'; }
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.length > 100) truncated = true;
      return item.slice(0, 100).map((entry) => visit(entry, depth + 1));
    }
    const names = Object.getOwnPropertyNames(item);
    if (names.length > 100) truncated = true;
    const output: Record<string, unknown> = {};
    for (const key of names.slice(0, 100)) {
      if (sensitiveKey.test(key)) { output[key] = '[REDACTED]'; continue; }
      if (/^(?:path|url|requestUrl)$/i.test(key) && typeof (item as Record<string, unknown>)[key] === 'string') {
        try {
          const original = (item as Record<string, string>)[key];
          const parsed = new URL(original, 'https://redaction.invalid');
          output[key] = /^https?:\/\//i.test(original) ? parsed.origin + parsed.pathname : parsed.pathname;
        } catch { output[key] = '[URL]'; }
        continue;
      }
      try { output[key] = visit((item as Record<string, unknown>)[key], depth + 1); }
      catch { output[key] = '[Unreadable]'; }
    }
    return output;
  };
  let payload: unknown;
  try { payload = visit(value, 0); }
  catch { payload = '[Unserializable]'; truncated = true; }
  const encoded = JSON.stringify(payload);
  if (encoded && byteLength(encoded) > maxPayloadLength) {
    const originalBytes = byteLength(encoded);
    let low = 0;
    let high = encoded.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (byteLength(JSON.stringify({ preview: encoded.slice(0, middle), originalBytes })) <= maxPayloadLength) low = middle;
      else high = middle - 1;
    }
    payload = { preview: encoded.slice(0, low), originalBytes };
    truncated = true;
  }
  return { payload, truncated };
}

function persist() {
  try { localStorage.setItem(queueKey, JSON.stringify(pending)); }
  catch { /* In-memory delivery remains available for this launch. */ }
}

function schedulePersist() {
  if (persistTimer || typeof window === 'undefined') return;
  persistTimer = setTimeout(() => { persistTimer = undefined; persist(); }, 0);
}

function schedule(delayMs: number) {
  if (timer || !pending.length || typeof window === 'undefined') return;
  timer = setTimeout(() => { timer = undefined; void flushClientTrace(); }, delayMs);
}

export function getClientTraceStatus() {
  return { enabled: isV006DualRelease(), localOnly,
    traceId: traceId(), pending: pending.length, dropped };
}

export function getClientTraceRecords() {
  return pending.filter((item) => item.traceId === traceId()).map((item) => ({ ...item }));
}

export function setClientTraceDebugRecorder(recorder: (data: Record<string, unknown>) => void) {
  debugRequestRecorder = recorder;
}

export function captureClientTrace(kind: TraceKind, phase: string, value: unknown, context: {
  operationId?: string; sessionId?: string; requestId?: string; placementId?: string;
} = {}) {
  if (!isV006DualRelease()) return;
  const safe = snapshot(value);
  pending.push({
    traceId: traceId(), releaseId, platform: getAdPlatform(), startedAt,
    recordId: uuid(), seq: ++sequence, kind, phase: phase.slice(0, 80), eventAt: new Date().toISOString(),
    ...context, payload: safe.payload, truncated: safe.truncated
  });
  try { sessionStorage.setItem(traceSequenceKey, String(sequence)); } catch { /* Sequence remains monotonic in memory. */ }
  if (pending.length > maxPending) { dropped += pending.length - maxPending; pending.splice(0, pending.length - maxPending); }
  schedulePersist();
  if (!localOnly) schedule(1_000);
}

export async function flushClientTrace() {
  if (localOnly) return;
  if (sending || !pending.length || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  const token = getSessionToken();
  if (!token) { schedule(3_000); return; }
  sending = true;
  const first = pending[0];
  const batch = pending.filter((item) => item.traceId === first.traceId).slice(0, 5);
  const endpoint = `${apiBaseUrl.replace(/\/$/, '')}/client-traces/batches`;
  const target = debugRequestTarget(endpoint, window.location.origin);
  const headers = new Headers({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
  const requestBody = {
    traceId: first.traceId, releaseId: first.releaseId, platform: first.platform, startedAt: first.startedAt,
    records: batch.map(({ recordId, seq, kind, phase, eventAt, operationId, sessionId, requestId, placementId, payload, truncated }) =>
      ({ recordId, seq, kind, phase, eventAt, operationId, sessionId, requestId, placementId, payload, truncated }))
  };
  const startedAtMs = Date.now();
  const requestSnapshot = debugRecordCaptureEnabled() ? {
    method: 'POST', path: '/client-traces/batches', url: target.url,
    startedAt: new Date(startedAtMs).toISOString(), pageOrigin: window.location.origin,
    apiOrigin: target.apiOrigin, crossOrigin: target.crossOrigin,
    preflightRequired: target.crossOrigin,
    requestHeaders: boundedDebugValue(debugHeaders(headers)), requestBody: boundedDebugValue(requestBody),
    recordCount: batch.length
  } : {};
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
  let response: Response | undefined;
  let responseBody: unknown;
  let responseRecorded = false;
  try {
    response = await fetch(endpoint, {
      method: 'POST', headers, signal: controller.signal, body: JSON.stringify(requestBody)
    });
    if (debugRecordCaptureEnabled()) {
      const rawBody = await response.clone().text().catch(() => '');
      try { responseBody = rawBody ? JSON.parse(rawBody) : undefined; }
      catch { responseBody = rawBody; }
      debugRequestRecorder?.({
        ...requestSnapshot, statusCode: response.status, durationMs: Date.now() - startedAtMs,
        ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
        ...debugResponseDetails(response, responseBody)
      });
      responseRecorded = true;
    }
    if (!response.ok && response.status !== 400 && response.status !== 403 && response.status !== 409) throw new Error(`Trace upload HTTP ${response.status}`);
    if (!response.ok) dropped += batch.length;
    const sent = new Set(batch.map((item) => item.recordId));
    pending = pending.filter((item) => !sent.has(item.recordId));
    retryMs = 1_000;
    persist();
  } catch (error) {
    if (debugRecordCaptureEnabled() && !responseRecorded) debugRequestRecorder?.({
      ...requestSnapshot, statusCode: response?.status ?? 0, durationMs: Date.now() - startedAtMs,
      error: error instanceof Error ? error.message : String(error),
      browserOnline: navigator.onLine, timedOut, aborted: controller.signal.aborted,
      ...debugResponseDetails(response, responseBody)
    });
    retryMs = Math.min(60_000, retryMs * 2);
  } finally {
    clearTimeout(timeout);
    sending = false;
    schedule(pending.length ? retryMs : 0);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (!localOnly) schedule(0); });
  window.addEventListener('pagehide', persist);
  if (!localOnly) schedule(1_000);
}

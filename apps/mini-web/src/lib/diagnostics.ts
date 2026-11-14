import { recordDebugConsole, recordDebugRequest, recordDebugRuntime } from './analytics';
import { boundedDebugValue, debugHeaders, debugRequestTarget, debugResponseDetails } from './debug-network';
import { debugRecordCaptureEnabled } from './debug-panel';

const apiBase = import.meta.env.VITE_API_BASE_URL
  ?? (import.meta.env.VITE_APP_KEY && import.meta.env.VITE_APP_KEY !== 'main' ? `http://localhost:3000/api/${import.meta.env.VITE_APP_KEY}/v1` : 'http://localhost:3000/api/v1');
type Diagnostic = {
  kind: 'STARTUP' | 'API' | 'SCRIPT' | 'AD' | 'PLAYBACK'; phase: string; message: string;
  path?: string; requestId?: string; statusCode?: number; durationMs?: number;
};

export function reportPerformance(phase: string, path: string, durationMs: number, details: Record<string, string | number | boolean | null | undefined> = {}) {
  console.info('[MiniPerf]', {
    phase,
    path: path.split(/[?#]/, 1)[0].slice(0, 160),
    durationMs: Number(Math.max(0, durationMs).toFixed(1)),
    ...details
  });
}
const recent = new Map<string, number>();
let windowStart = 0;
let sent = 0;
let diagnosticsInstalled = false;
let consoleCaptureInstalled = false;

function parseResponseBody(raw: string): unknown {
  if (!raw) return undefined;
  try { return JSON.parse(raw); }
  catch { return raw; }
}

async function uploadDiagnostic(payload: Record<string, unknown>, startedAt: number) {
  const endpoint = `${apiBase.replace(/\/$/, '')}/runtime-errors`;
  const target = debugRequestTarget(endpoint, window.location.origin);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const requestSnapshot = debugRecordCaptureEnabled() ? {
    method: 'POST', path: '/runtime-errors', url: target.url,
    startedAt: new Date(startedAt).toISOString(), pageOrigin: window.location.origin,
    apiOrigin: target.apiOrigin, crossOrigin: target.crossOrigin,
    preflightRequired: target.crossOrigin,
    requestHeaders: boundedDebugValue(debugHeaders(headers)), requestBody: boundedDebugValue(payload)
  } : {};
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 5_000);
  let response: Response | undefined;
  let responseBody: unknown;
  try {
    response = await fetch(endpoint, {
      method: 'POST', headers, keepalive: true, body: JSON.stringify(payload), signal: controller.signal
    });
    if (debugRecordCaptureEnabled()) {
      responseBody = parseResponseBody(await response.clone().text().catch(() => ''));
      recordDebugRequest({
        ...requestSnapshot, statusCode: response.status, durationMs: Date.now() - startedAt,
        ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
        ...debugResponseDetails(response, responseBody)
      }, { captureTrace: false });
    }
  } catch (error) {
    if (debugRecordCaptureEnabled()) recordDebugRequest({
      ...requestSnapshot, statusCode: response?.status ?? 0, durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      browserOnline: navigator.onLine, timedOut, aborted: controller.signal.aborted,
      ...debugResponseDetails(response, responseBody)
    }, { captureTrace: false });
  } finally {
    window.clearTimeout(timer);
  }
}

export function reportDiagnostic(input: Diagnostic) {
  recordDebugRuntime({ ...input, releaseId: import.meta.env.VITE_MINI_RELEASE_ID || 'default' });
  if (import.meta.env.VITE_DEMO_MODE === 'true' || import.meta.env.VITE_USE_MOCK_API === 'true') return;
  const now = Date.now();
  if (now - windowStart >= 60_000) { windowStart = now; sent = 0; }
  const key = `${input.kind}:${input.phase}:${input.path ?? ''}:${input.message}`;
  if (sent >= 10 || now - (recent.get(key) ?? 0) < 30_000) return;
  for (const [saved, time] of recent) if (now - time >= 30_000) recent.delete(saved);
  recent.set(key, now); sent++;
  const message = input.message.replace(/https?:\/\/[^\s]+/gi, '[URL]').replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]').slice(0, 500);
  const payload = {
    ...input, message, path: input.path?.split(/[?#]/, 1)[0].slice(0, 200),
    releaseId: import.meta.env.VITE_MINI_RELEASE_ID || 'default', occurredAt: new Date(now).toISOString()
  };
  // 诊断上传绕过 API 客户端，避免上传失败再次触发诊断上报。
  void uploadDiagnostic(payload, now);
}

export function installDebugConsoleCapture() {
  if (consoleCaptureInstalled || !debugRecordCaptureEnabled()) return;
  consoleCaptureInstalled = true;
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[level];
    console[level] = function (...args: unknown[]) {
      Reflect.apply(original, console, args);
      try { recordDebugConsole(level, args); }
      catch { /* Console capture must not interfere with application logging. */ }
    };
  }
}

export function installDiagnostics() {
  if (diagnosticsInstalled) return;
  diagnosticsInstalled = true;
  window.addEventListener('error', (event) => reportDiagnostic({ kind: 'SCRIPT', phase: 'window.error', message: event.message || 'Script resource failed to load' }));
  window.addEventListener('unhandledrejection', (event) => reportDiagnostic({ kind: 'SCRIPT', phase: 'unhandledrejection', message: event.reason instanceof Error ? event.reason.message : String(event.reason) }));
  installDebugConsoleCapture();
}

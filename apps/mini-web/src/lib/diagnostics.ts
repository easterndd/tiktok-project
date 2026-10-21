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

export function reportDiagnostic(input: Diagnostic) {
  if (import.meta.env.VITE_DEMO_MODE === 'true' || import.meta.env.VITE_USE_MOCK_API === 'true') return;
  const now = Date.now();
  if (now - windowStart >= 60_000) { windowStart = now; sent = 0; }
  const key = `${input.kind}:${input.phase}:${input.path ?? ''}:${input.message}`;
  if (sent >= 10 || now - (recent.get(key) ?? 0) < 30_000) return;
  for (const [saved, time] of recent) if (now - time >= 30_000) recent.delete(saved);
  recent.set(key, now); sent++;
  const message = input.message.replace(/https?:\/\/[^\s]+/gi, '[URL]').replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]').slice(0, 500);
  // Use fetch directly: telemetry failures must never recurse through the API client.
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5000);
  try { void fetch(`${apiBase}/runtime-errors`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
    body: JSON.stringify({ ...input, message, path: input.path?.split(/[?#]/, 1)[0].slice(0, 200),
      releaseId: import.meta.env.VITE_MINI_RELEASE_ID || 'default', occurredAt: new Date(now).toISOString() }),
    signal: controller.signal
  }).catch(() => undefined).finally(() => window.clearTimeout(timer));
  } catch { window.clearTimeout(timer); }
}

export function installDiagnostics() {
  window.addEventListener('error', (event) => reportDiagnostic({ kind: 'SCRIPT', phase: 'window.error', message: event.message || 'Script resource failed to load' }));
  window.addEventListener('unhandledrejection', (event) => reportDiagnostic({ kind: 'SCRIPT', phase: 'unhandledrejection', message: event.reason instanceof Error ? event.reason.message : String(event.reason) }));
}

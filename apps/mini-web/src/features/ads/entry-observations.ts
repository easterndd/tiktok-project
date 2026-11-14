import { ApiError, apiClient } from '../../lib/api-client';
import { storagePrefix } from '../../lib/app-brand';
import type { EntryObservation } from './entry-ad-flow-v2';

type Pending = { sessionId: string; observation: EntryObservation };
const storageKey = `${storagePrefix}_entry_observations_v2`;
const maxPending = 200;
let pending: Pending[] = [];
let flushing = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let retryMs = 1_000;

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]') as unknown;
  if (Array.isArray(saved)) pending = saved.filter((item): item is Pending =>
    Boolean(item && typeof item === 'object' && typeof item.sessionId === 'string' && item.observation?.eventId));
} catch { /* Storage may be unavailable in a host WebView. */ }

function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(pending)); }
  catch { /* Keep the in-memory queue for this launch. */ }
}

function schedulePersist() {
  if (persistTimer || typeof window === 'undefined') return;
  persistTimer = setTimeout(() => { persistTimer = undefined; persist(); }, 0);
}

function schedule(delayMs: number) {
  if (timer || !pending.length) return;
  timer = setTimeout(() => { timer = undefined; void flush(); }, delayMs);
}

async function flush() {
  if (flushing || !pending.length) return;
  flushing = true;
  const sessionId = pending[0].sessionId;
  const batch = pending.filter((item) => item.sessionId === sessionId).slice(0, 20);
  try {
    await apiClient.post(`/app-entry-ad-sessions/${encodeURIComponent(sessionId)}/observations`, {
      observations: batch.map((item) => item.observation)
    });
    const sent = new Set(batch.map((item) => `${item.sessionId}:${item.observation.eventId}:${item.observation.eventType}`));
    pending = pending.filter((item) => !sent.has(`${item.sessionId}:${item.observation.eventId}:${item.observation.eventType}`));
    retryMs = 1_000;
    persist();
  } catch (error) {
    if (error instanceof ApiError && [400, 403, 404, 409, 422].includes(error.status)) {
      const rejected = new Set(batch.map((item) => `${item.sessionId}:${item.observation.eventId}:${item.observation.eventType}`));
      pending = pending.filter((item) => !rejected.has(`${item.sessionId}:${item.observation.eventId}:${item.observation.eventType}`));
      retryMs = 1_000;
      persist();
    } else retryMs = Math.min(60_000, retryMs * 2);
  } finally {
    flushing = false;
    schedule(pending.length ? retryMs : 0);
  }
}

export function queueEntryObservation(sessionId: string, observation: EntryObservation) {
  if (!sessionId) return;
  const key = `${sessionId}:${observation.eventId}:${observation.eventType}`;
  if (pending.some((item) => `${item.sessionId}:${item.observation.eventId}:${item.observation.eventType}` === key)) return;
  pending.push({ sessionId, observation });
  if (pending.length > maxPending) pending.splice(0, pending.length - maxPending);
  schedulePersist();
  schedule(1_000);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('pagehide', persist);
  schedule(1_000);
}

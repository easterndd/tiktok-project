import { ApiError } from '../../lib/api-client';
import { storagePrefix } from '../../lib/app-brand';
import { acknowledgeAppEntryAdShown, completeAppEntryAd, recordAppEntryAdEvent } from './app-entry-ad';
import type { EntryObservation } from './entry-ad-flow-v2';

type Pending = {
  sessionId: string;
  countMode: 'SHOWN' | 'COMPLETED';
  observation: EntryObservation;
  queuedAt: number;
};

const storageKey = `${storagePrefix}_entry_legacy_observations`;
const maxPending = 200;
const maxAgeMs = 20 * 60_000;
let pending: Pending[] = [];
let flushing = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let retryMs = 1_000;

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]') as unknown;
  if (Array.isArray(saved)) pending = saved.filter((item): item is Pending =>
    Boolean(item && typeof item === 'object' && typeof item.sessionId === 'string'
      && (item.countMode === 'SHOWN' || item.countMode === 'COMPLETED')
      && item.observation?.eventId && Number.isFinite(item.queuedAt)));
} catch { /* Keep the in-memory queue when storage is unavailable. */ }

function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(pending)); }
  catch { /* The current launch can still deliver pending observations. */ }
}

function schedule(delayMs: number) {
  if (timer || !pending.length || typeof window === 'undefined') return;
  timer = setTimeout(() => { timer = undefined; void flushLegacyEntryObservations(); }, delayMs);
}

async function deliver(item: Pending) {
  const { sessionId, countMode, observation } = item;
  if (observation.eventType === 'SHOWN') {
    if (countMode === 'SHOWN') {
      await acknowledgeAppEntryAdShown(sessionId, observation.eventId, observation.adIndex, observation.placementId);
    } else {
      await recordAppEntryAdEvent({
        eventType: 'SHOWN', clientEventId: observation.eventId, placementId: observation.placementId,
        sessionId, adType: 'REWARDED', adIndex: observation.adIndex
      });
    }
  } else if (countMode === 'COMPLETED') {
    await completeAppEntryAd(sessionId, observation.eventId, observation.eventType === 'CLOSED_COMPLETED');
  }
}

export async function flushLegacyEntryObservations() {
  if (flushing || !pending.length) return;
  flushing = true;
  try {
    while (pending.length) {
      const item = pending[0];
      if (Date.now() - item.queuedAt > maxAgeMs) {
        pending.shift();
        persist();
        continue;
      }
      try {
        await deliver(item);
        pending.shift();
        retryMs = 1_000;
        persist();
      } catch (error) {
        if (error instanceof ApiError && [400, 403, 404, 422].includes(error.status)) {
          pending.shift();
          persist();
          continue;
        }
        retryMs = Math.min(60_000, retryMs * 2);
        break;
      }
    }
  } finally {
    flushing = false;
    schedule(retryMs);
  }
}

export function queueLegacyEntryObservation(sessionId: string, countMode: 'SHOWN' | 'COMPLETED', observation: EntryObservation) {
  if (!sessionId || countMode === 'SHOWN' && observation.eventType !== 'SHOWN') return;
  if (pending.some((item) => item.sessionId === sessionId && item.observation.eventId === observation.eventId
    && item.observation.eventType === observation.eventType)) return;
  pending.push({ sessionId, countMode, observation, queuedAt: Date.now() });
  if (pending.length > maxPending) pending.splice(0, pending.length - maxPending);
  persist();
  schedule(1_000);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('pagehide', persist);
  schedule(1_000);
}

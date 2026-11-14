import type { AppEntryAdSession } from './app-entry-ad';
import { getAdPlatform } from './ad-platform';
import { selectAdPlacement } from './ad-placement-selection';
import { storagePrefix } from '../../lib/app-brand';

export type EntryObservation = {
  eventId: string;
  adIndex: number;
  placementId: string;
  eventType: 'SHOWN' | 'CLOSED_COMPLETED' | 'CLOSED_INCOMPLETE';
  occurredAt: string;
};

type Playback = { clientEventId: string; isEnded: boolean; placementId: string; adType: 'REWARDED' | 'INTERSTITIAL' };
type Actions = {
  show: (input: {
    mode: 'REWARDED_GATED'; placementId: string; placementIds: string[]; adLoadMode?: 'DIRECT_SHOW' | 'EXPLICIT_LOAD';
    strategyVariant?: string; sessionId: string; adIndex: number; requiredCount: number; countMode: 'COMPLETED' | 'SHOWN';
    fastHandoff: boolean; onShown: (playback: Playback) => void;
  }) => Promise<Playback>;
  observe: (observation: EntryObservation) => void;
  isActive: () => boolean;
  onError: (error: unknown) => void;
  wait: (ms: number) => Promise<void>;
};

const activeFlows = new Map<string, Promise<void>>();

function savedProgress(session: AppEntryAdSession) {
  if (!session.sessionId) return 0;
  try {
    const value = JSON.parse(sessionStorage.getItem(`${storagePrefix}_entry_v2_${session.sessionId}`) || 'null') as {
      completed?: number; expiresAt?: string;
    } | null;
    if (!value || !value.expiresAt || Date.parse(value.expiresAt) <= Date.now()) return 0;
    return Number.isInteger(value.completed) ? Math.min(session.requiredCount ?? 0, Math.max(0, value.completed!)) : 0;
  } catch { return 0; }
}

function saveProgress(session: AppEntryAdSession, completed: number) {
  if (!session.sessionId) return;
  try {
    sessionStorage.setItem(`${storagePrefix}_entry_v2_${session.sessionId}`, JSON.stringify({
      completed, expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString()
    }));
  } catch { /* A storage-disabled WebView can still complete this launch in memory. */ }
}

async function run(session: AppEntryAdSession, actions: Actions) {
  if (!session.sessionId || session.mode !== 'REWARDED_GATED' || !session.placementId || !session.requiredCount) {
    throw new Error('ENTRY_AD_SESSION_UNAVAILABLE');
  }
  const placementIds = session.placementIds?.length ? session.placementIds : [session.placementId];
  const platform = getAdPlatform();
  const countMode = session.countMode ?? 'COMPLETED';
  let completed = Math.max(session.completedCount ?? 0, savedProgress(session));
  let failures = 0;
  let busyRetries = 0;
  while (actions.isActive() && completed < session.requiredCount) {
    const adIndex = completed + 1;
    const preferred = selectAdPlacement(session.placementId, placementIds, adIndex, platform, true);
    let shown: Playback | undefined;
    try {
      const playback = await actions.show({
        mode: 'REWARDED_GATED', placementId: preferred, placementIds, adLoadMode: session.adLoadMode,
        strategyVariant: session.strategyVariant, sessionId: session.sessionId, adIndex,
        requiredCount: session.requiredCount, countMode, fastHandoff: platform === 'android',
        onShown: (value) => {
          shown = value;
          actions.observe({ eventId: value.clientEventId, adIndex, placementId: value.placementId, eventType: 'SHOWN', occurredAt: new Date().toISOString() });
        }
      });
      if (!shown) throw new Error('ENTRY_AD_SHOW_NOT_CONFIRMED');
      actions.observe({
        eventId: playback.clientEventId, adIndex, placementId: playback.placementId,
        eventType: playback.isEnded ? 'CLOSED_COMPLETED' : 'CLOSED_INCOMPLETE', occurredAt: new Date().toISOString()
      });
      failures = 0;
      busyRetries = 0;
      if (countMode === 'SHOWN' || playback.isEnded) {
        completed++;
        saveProgress(session, completed);
      }
    } catch (error) {
      if (!actions.isActive()) return;
      actions.onError(error);
      const message = error instanceof Error ? error.message : String(error);
      if (/AD_BUSY|104111006|\b11006\b/.test(message) && ++busyRetries <= 6) {
        await actions.wait(Math.min(750, 100 * busyRetries));
        continue;
      }
      busyRetries = 0;
      if (++failures >= 3) {
        if (session.onUnavailable === 'ALLOW') return;
        throw error;
      }
      await actions.wait(Math.min(500, 150 * failures));
    }
  }
}

export function runEntryAdFlowV2(session: AppEntryAdSession, actions: Actions) {
  const key = session.sessionId ?? 'missing-session';
  const existing = activeFlows.get(key);
  if (existing) return existing;
  let promise: Promise<void>;
  promise = run(session, actions).finally(() => {
    if (activeFlows.get(key) === promise) activeFlows.delete(key);
  });
  activeFlows.set(key, promise);
  return promise;
}

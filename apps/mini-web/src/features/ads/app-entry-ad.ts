import { ApiError, apiClient } from '../../lib/api-client';
import { isDemoMode } from '../../lib/storage';
import { storagePrefix } from '../../lib/app-brand';
import { adTimeout, adErrorMessage } from './ad-timeout';
import { runAdShow } from './ad-show';
import { reportDiagnostic } from '../../lib/diagnostics';
import { createShownAcknowledgement } from './shown-acknowledgement';

export type AppEntryAdSession = {
  required: boolean;
  sessionId?: string;
  mode?: 'INTERSTITIAL' | 'REWARDED_GATED';
  placementId?: string;
  requiredCount?: number;
  countMode?: 'COMPLETED' | 'SHOWN';
  completedCount?: number;
  onUnavailable?: 'ALLOW' | 'BLOCK';
};

function eventId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  // TikTok WebView versions without randomUUID still need IDs accepted by API validation.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export function getLaunchId() {
  const releaseId = import.meta.env.VITE_MINI_RELEASE_ID || 'default';
  const key = releaseId === 'default' ? `${storagePrefix}_launch_id` : `${storagePrefix}_${releaseId}_launch_id`;
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const launchId = eventId();
  sessionStorage.setItem(key, launchId);
  return launchId;
}

export async function startAppEntryAdSession(): Promise<AppEntryAdSession> {
  if (isDemoMode()) return { required: false };
  return apiClient.post<AppEntryAdSession>('/app-entry-ad-sessions', {
    launchId: getLaunchId(),
    releaseId: import.meta.env.VITE_MINI_RELEASE_ID || 'default'
  });
}

const shownAcknowledgements = new Map<string, () => Promise<void>>();

type EntryAdProgress = { shouldContinue: boolean; completedCount: number; requiredCount: number };

export async function completeAppEntryAd(sessionId: string, clientEventId: string, isEnded: boolean) {
  if (isDemoMode()) return { shouldContinue: false, completedCount: 0, requiredCount: 0 };
  const key = `${sessionId}:${clientEventId}`;
  // Retry the same impression, never replay a watched ad because telemetry failed.
  try { await shownAcknowledgements.get(key)?.(); }
  catch (error) {
    reportDiagnostic({ kind: 'API', phase: 'ENTRY_AD_SHOWN_REPORT', message: adErrorMessage(error), path: '/ad-events' });
    throw error;
  }
  const payload = { clientEventId, isEnded };
  try {
    const result = await apiClient.post<EntryAdProgress>(`/app-entry-ad-sessions/${sessionId}/complete`, payload);
    shownAcknowledgements.delete(key);
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) throw error;
    const result = await apiClient.post<EntryAdProgress>(`/app-entry-ad-sessions/${sessionId}/complete`, payload);
    shownAcknowledgements.delete(key);
    return result;
  }
}

export function recordAppEntryAdEvent(input: { eventType: 'REQUESTED' | 'SHOWN' | 'CLOSED_INCOMPLETE' | 'FAILED'; placementId: string; sessionId: string; adType: 'REWARDED' | 'INTERSTITIAL'; adIndex: number; errorCode?: string; clientEventId?: string }) {
  return apiClient.post('/ad-events', { ...input, scope: 'APP_ENTRY', appEntrySessionId: input.sessionId, clientEventId: input.clientEventId ?? eventId() });
}

export async function showAppEntryAd(input: { mode: 'INTERSTITIAL' | 'REWARDED_GATED'; placementId: string; sessionId: string; adIndex: number; onShown?: () => void }): Promise<{ clientEventId: string; isEnded: boolean }> {
  const { mode, placementId, sessionId, adIndex, onShown } = input;
  const adType = mode === 'INTERSTITIAL' ? 'INTERSTITIAL' : 'REWARDED';
  const completionEventId = eventId();
  const key = `${sessionId}:${completionEventId}`;
  const capability = mode === 'INTERSTITIAL' ? 'createInterstitialAd' : 'createRewardedVideoAd';
  if (!window.TTMinis?.canIUse(capability)) throw new Error('ENTRY_AD_UNAVAILABLE');

  // Analytics must not delay the next native ad's show() call.
  void recordAppEntryAdEvent({ eventType: 'REQUESTED', placementId, sessionId, adType, adIndex }).catch(() => undefined);
  const ad = mode === 'INTERSTITIAL'
    ? window.TTMinis.createInterstitialAd({ adUnitId: placementId })
    : window.TTMinis.createRewardedVideoAd({ adUnitId: placementId });
  const isEnded = await new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let closed: boolean | undefined;
    let shown = false;
    const cleanup = () => { timeout.clear(); ad.offClose(onClose); ad.offError(onError); };
    const finishClose = () => {
      if (settled || !shown || closed === undefined) return;
      settled = true;
      cleanup();
      resolve(closed);
    };
    const onClose = (result?: { isEnded: boolean }) => {
      if (settled || closed !== undefined) return;
      closed = mode === 'INTERSTITIAL' || result?.isEnded === true;
      finishClose();
    };
    const onError = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      shownAcknowledgements.delete(key);
      void recordAppEntryAdEvent({ eventType: 'FAILED', placementId, sessionId, adType, adIndex, errorCode: adErrorMessage(error) }).catch(() => undefined);
      reject(new Error(adErrorMessage(error)));
    };
    const timeout = adTimeout(onError);
    ad.onClose(onClose);
    ad.onError(onError);
    void runAdShow(() => ad.show(), async () => {
      if (settled) return;
      timeout.shown();
      // Overlap SHOWN acknowledgement with viewing. Completion still waits for
      // this exact impression to be recorded before asking the server to count it.
      shownAcknowledgements.set(key, createShownAcknowledgement(() => recordAppEntryAdEvent({
        eventType: 'SHOWN', placementId, sessionId, adType, adIndex, clientEventId: completionEventId
      })));
      shown = true;
      onShown?.();
      finishClose();
    }, onError, onError);
  });
  if (!isEnded) void recordAppEntryAdEvent({ eventType: 'CLOSED_INCOMPLETE', placementId, sessionId, adType, adIndex }).catch(() => undefined);
  return { clientEventId: completionEventId, isEnded };
}

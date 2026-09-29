import { ApiError, apiClient } from '../../lib/api-client';
import { isDemoMode } from '../../lib/storage';
import { storagePrefix } from '../../lib/app-brand';

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
  const key = `${storagePrefix}_launch_id`;
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const launchId = eventId();
  sessionStorage.setItem(key, launchId);
  return launchId;
}

export async function startAppEntryAdSession(): Promise<AppEntryAdSession> {
  if (isDemoMode()) return { required: false };
  return apiClient.post<AppEntryAdSession>('/app-entry-ad-sessions', { launchId: getLaunchId() });
}

type EntryAdProgress = { shouldContinue: boolean; completedCount: number; requiredCount: number };

export async function completeAppEntryAd(sessionId: string, clientEventId: string, isEnded: boolean) {
  if (isDemoMode()) return { shouldContinue: false, completedCount: 0, requiredCount: 0 };
  const payload = { clientEventId, isEnded };
  try {
    return await apiClient.post<EntryAdProgress>(`/app-entry-ad-sessions/${sessionId}/complete`, payload);
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) throw error;
    return apiClient.post<EntryAdProgress>(`/app-entry-ad-sessions/${sessionId}/complete`, payload);
  }
}

export function recordAppEntryAdEvent(input: { eventType: 'REQUESTED' | 'SHOWN' | 'CLOSED_INCOMPLETE' | 'FAILED'; placementId: string; sessionId: string; adType: 'REWARDED' | 'INTERSTITIAL'; adIndex: number; errorCode?: string; clientEventId?: string }) {
  return apiClient.post('/ad-events', { ...input, scope: 'APP_ENTRY', appEntrySessionId: input.sessionId, clientEventId: input.clientEventId ?? eventId() });
}

export async function showAppEntryAd(input: { mode: 'INTERSTITIAL' | 'REWARDED_GATED'; placementId: string; sessionId: string; adIndex: number }): Promise<{ clientEventId: string; isEnded: boolean }> {
  const { mode, placementId, sessionId, adIndex } = input;
  const adType = mode === 'INTERSTITIAL' ? 'INTERSTITIAL' : 'REWARDED';
  const completionEventId = eventId();
  await recordAppEntryAdEvent({ eventType: 'REQUESTED', placementId, sessionId, adType, adIndex });
  if (mode === 'INTERSTITIAL') {
    if (!window.TTMinis?.canIUse('createInterstitialAd')) throw new Error('ENTRY_AD_UNAVAILABLE');
    const ad = window.TTMinis.createInterstitialAd({ adUnitId: placementId });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let closed = false;
      let shownRecorded = false;
      const cleanup = () => { ad.offClose(onClose); ad.offError(onError); };
      const onClose = () => {
        if (settled) return;
        closed = true;
        if (shownRecorded) { settled = true; cleanup(); resolve(); }
      };
      const onError = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        void recordAppEntryAdEvent({ eventType: 'FAILED', placementId, sessionId, adType, adIndex, errorCode: error instanceof Error ? error.message : 'ENTRY_AD_SHOW_FAILED' }).catch(() => undefined);
        reject(error);
      };
      ad.onClose(onClose);
      ad.onError(onError);
      void Promise.resolve().then(() => ad.show()).then(async () => {
        if (settled) return;
        await recordAppEntryAdEvent({ eventType: 'SHOWN', placementId, sessionId, adType, adIndex, clientEventId: completionEventId });
        shownRecorded = true;
        if (closed) { settled = true; cleanup(); resolve(); }
      }).catch(onError);
    });
    return { clientEventId: completionEventId, isEnded: true };
  }

  if (!window.TTMinis?.canIUse('createRewardedVideoAd')) throw new Error('ENTRY_AD_UNAVAILABLE');
  const ad = window.TTMinis.createRewardedVideoAd({ adUnitId: placementId });
  const isEnded = await new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let closed: boolean | undefined;
    let shownRecorded = false;
    const cleanup = () => { ad.offClose(onClose); ad.offError(onError); };
    const onClose = (result: { isEnded: boolean }) => {
      if (settled || closed !== undefined) return;
      closed = result?.isEnded === true;
      if (shownRecorded) { settled = true; cleanup(); resolve(closed); }
    };
    const onError = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      void recordAppEntryAdEvent({ eventType: 'FAILED', placementId, sessionId, adType, adIndex, errorCode: error instanceof Error ? error.message : 'ENTRY_AD_SHOW_FAILED' }).catch(() => undefined);
      reject(error);
    };
    ad.onClose(onClose);
    ad.onError(onError);
    void Promise.resolve().then(() => ad.show()).then(async () => {
      if (settled) return;
      await recordAppEntryAdEvent({ eventType: 'SHOWN', placementId, sessionId, adType, adIndex, clientEventId: completionEventId });
      shownRecorded = true;
      if (closed !== undefined) { settled = true; cleanup(); resolve(closed); }
    }).catch(onError);
  });
  if (!isEnded) void recordAppEntryAdEvent({ eventType: 'CLOSED_INCOMPLETE', placementId, sessionId, adType, adIndex }).catch(() => undefined);
  return { clientEventId: completionEventId, isEnded };
}

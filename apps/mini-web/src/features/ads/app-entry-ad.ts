import { ApiError, apiClient } from '../../lib/api-client';
import { isDemoMode } from '../../lib/storage';

export type AppEntryAdSession = {
  required: boolean;
  sessionId?: string;
  mode?: 'INTERSTITIAL' | 'REWARDED_GATED';
  placementId?: string;
  requiredCount?: number;
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
  const key = 'quickreels_launch_id';
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

export async function completeAppEntryAd(sessionId: string, clientEventId: string) {
  if (isDemoMode()) return { shouldContinue: false };
  const payload = { clientEventId, isEnded: true };
  try {
    return await apiClient.post<{ shouldContinue: boolean }>(`/app-entry-ad-sessions/${sessionId}/complete`, payload);
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) throw error;
    return apiClient.post<{ shouldContinue: boolean }>(`/app-entry-ad-sessions/${sessionId}/complete`, payload);
  }
}

export function recordAppEntryAdEvent(input: { eventType: 'REQUESTED' | 'SHOWN' | 'CLOSED_INCOMPLETE' | 'FAILED'; placementId: string; sessionId: string; adType: 'REWARDED' | 'INTERSTITIAL'; adIndex: number; errorCode?: string; clientEventId?: string }) {
  return apiClient.post('/ad-events', { ...input, scope: 'APP_ENTRY', appEntrySessionId: input.sessionId, clientEventId: input.clientEventId ?? eventId() });
}

export async function showAppEntryAd(input: { mode: 'INTERSTITIAL' | 'REWARDED_GATED'; placementId: string; sessionId: string; adIndex: number }) {
  const { mode, placementId, sessionId, adIndex } = input;
  const adType = mode === 'INTERSTITIAL' ? 'INTERSTITIAL' : 'REWARDED';
  const completionEventId = eventId();
  await recordAppEntryAdEvent({ eventType: 'REQUESTED', placementId, sessionId, adType, adIndex });
  if (mode === 'INTERSTITIAL') {
    if (!window.TTMinis?.canIUse('createInterstitialAd')) throw new Error('ENTRY_AD_UNAVAILABLE');
    const ad = window.TTMinis.createInterstitialAd({ adUnitId: placementId });
    await new Promise<void>((resolve, reject) => {
      let shownRecorded: Promise<unknown> | undefined;
      const cleanup = () => { ad.offClose(onClose); ad.offError(onError); };
      const onClose = () => {
        cleanup();
        if (!shownRecorded) return reject(new Error('ENTRY_AD_SHOW_NOT_CONFIRMED'));
        void shownRecorded.then(() => resolve(), reject);
      };
      const onError = (error: unknown) => {
        cleanup();
        void recordAppEntryAdEvent({ eventType: 'FAILED', placementId, sessionId, adType, adIndex, errorCode: error instanceof Error ? error.message : 'ENTRY_AD_SHOW_FAILED' }).catch(() => undefined);
        reject(error);
      };
      ad.onClose(onClose);
      ad.onError(onError);
      ad.show().then(() => { shownRecorded = recordAppEntryAdEvent({ eventType: 'SHOWN', placementId, sessionId, adType, adIndex, clientEventId: completionEventId }); }).catch(onError);
    });
    return completionEventId;
  }

  if (!window.TTMinis?.canIUse('createRewardedVideoAd')) throw new Error('ENTRY_AD_UNAVAILABLE');
  const ad = window.TTMinis.createRewardedVideoAd({ adUnitId: placementId });
  await new Promise<void>((resolve, reject) => {
    let shownRecorded: Promise<unknown> | undefined;
    const cleanup = () => { ad.offClose(onClose); ad.offError(onError); };
    const onClose = ({ isEnded }: { isEnded: boolean }) => {
      cleanup();
      if (!isEnded) {
        void recordAppEntryAdEvent({ eventType: 'CLOSED_INCOMPLETE', placementId, sessionId, adType, adIndex }).catch(() => undefined);
        reject(new Error('ENTRY_AD_NOT_COMPLETED'));
      } else if (!shownRecorded) reject(new Error('ENTRY_AD_SHOW_NOT_CONFIRMED'));
      else void shownRecorded.then(() => resolve(), reject);
    };
    const onError = (error: unknown) => {
      cleanup();
      void recordAppEntryAdEvent({ eventType: 'FAILED', placementId, sessionId, adType, adIndex, errorCode: error instanceof Error ? error.message : 'ENTRY_AD_SHOW_FAILED' }).catch(() => undefined);
      reject(error);
    };
    ad.onClose(onClose);
    ad.onError(onError);
    ad.show().then(() => { shownRecorded = recordAppEntryAdEvent({ eventType: 'SHOWN', placementId, sessionId, adType, adIndex, clientEventId: completionEventId }); }).catch(onError);
  });
  return completionEventId;
}

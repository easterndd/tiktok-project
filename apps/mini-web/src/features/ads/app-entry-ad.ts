import { ApiError, apiClient } from '../../lib/api-client';
import { isDemoMode } from '../../lib/storage';
import { storagePrefix } from '../../lib/app-brand';
import { getMiniLaunchAdId } from '../../lib/launch-context';
import { adTimeout, adErrorMessage } from './ad-timeout';
import { runAdShow } from './ad-show';
import { reportDiagnostic, reportPerformance } from '../../lib/diagnostics';
import { createShownAcknowledgement } from './shown-acknowledgement';
import { getInterstitialAd, getRewardedAd, prewarmInterstitialAd, prewarmRewardedAd, releaseInterstitialAd, releaseRewardedAd } from './ad-instance-cache';
import { claimNativeAd, markRewardedAdClosed } from './ad-activity';

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
  const startedAt = performance.now();
  const session = await apiClient.post<AppEntryAdSession>('/app-entry-ad-sessions', {
    launchId: getLaunchId(),
    releaseId: import.meta.env.VITE_MINI_RELEASE_ID || 'default',
    adId: getMiniLaunchAdId()
  });
  reportPerformance('ENTRY_AD_POLICY_RESPONSE', '/app-entry-ad-sessions', performance.now() - startedAt, { required: session.required, mode: session.mode ?? 'NONE' });
  if (session.required && session.placementId) {
    if (session.mode === 'INTERSTITIAL') prewarmInterstitialAd(session.placementId);
    else if (session.mode === 'REWARDED_GATED') prewarmRewardedAd(session.placementId);
  }
  return session;
}

const shownAcknowledgements = new Map<string, () => Promise<void>>();
const entryAdClosedAt = new Map<string, number>();

type EntryAdProgress = { shouldContinue: boolean; completedCount: number; requiredCount: number };

export async function completeAppEntryAd(sessionId: string, clientEventId: string, isEnded: boolean) {
  if (isDemoMode()) return { shouldContinue: false, completedCount: 0, requiredCount: 0 };
  const key = `${sessionId}:${clientEventId}`;
  const shownAcknowledgement = shownAcknowledgements.get(key);
  const payload = { clientEventId, isEnded };
  const complete = () => apiClient.post<EntryAdProgress>(`/app-entry-ad-sessions/${sessionId}/complete`, payload);
  try {
    let result: EntryAdProgress;
    try {
      result = await complete();
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 409 && error.status !== 425) || (error.status === 409 && error.code !== 'AD_NOT_ACKNOWLEDGED')) throw error;
      // Run completion beside SHOWN telemetry; wait only when the API observes
      // the race and asks us to retry after the impression is persisted.
      try { await shownAcknowledgement?.(); }
      catch (ackError) {
        reportDiagnostic({ kind: 'API', phase: 'ENTRY_AD_SHOWN_REPORT', message: adErrorMessage(ackError), path: '/ad-events' });
        throw ackError;
      }
      result = await complete();
    }
    shownAcknowledgements.delete(key);
    if (!result.shouldContinue) entryAdClosedAt.delete(sessionId);
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) throw error;
    const result = await apiClient.post<EntryAdProgress>(`/app-entry-ad-sessions/${sessionId}/complete`, payload);
    shownAcknowledgements.delete(key);
    if (!result.shouldContinue) entryAdClosedAt.delete(sessionId);
    return result;
  }
}

export function recordAppEntryAdEvent(input: { eventType: 'REQUESTED' | 'SHOWN' | 'CLOSED_INCOMPLETE' | 'FAILED'; placementId: string; sessionId: string; adType: 'REWARDED' | 'INTERSTITIAL'; adIndex: number; errorCode?: string; clientEventId?: string }) {
  const path = '/ad-events';
  const startedAt = performance.now();
  return apiClient.post(path, { ...input, scope: 'APP_ENTRY', appEntrySessionId: input.sessionId, clientEventId: input.clientEventId ?? eventId() }).then((result) => {
    if (input.eventType === 'SHOWN') reportPerformance('ENTRY_AD_SHOWN_ACK_RESPONSE', path, performance.now() - startedAt, { adType: input.adType, adIndex: input.adIndex });
    return result;
  }, (error) => {
    if (input.eventType === 'SHOWN') reportPerformance('ENTRY_AD_SHOWN_ACK_FAILED', path, performance.now() - startedAt, { adType: input.adType, adIndex: input.adIndex });
    throw error;
  });
}

export async function showAppEntryAd(input: { mode: 'INTERSTITIAL' | 'REWARDED_GATED'; placementId: string; sessionId: string; adIndex: number; onShown?: () => void }): Promise<{ clientEventId: string; isEnded: boolean }> {
  const { mode, placementId, sessionId, adIndex, onShown } = input;
  const adType = mode === 'INTERSTITIAL' ? 'INTERSTITIAL' : 'REWARDED';
  const previousClosedAt = entryAdClosedAt.get(sessionId);
  const completionEventId = eventId();
  const key = `${sessionId}:${completionEventId}`;
  const capability = mode === 'INTERSTITIAL' ? 'createInterstitialAd' : 'createRewardedVideoAd';
  if (!window.TTMinis?.canIUse(capability)) throw new Error('ENTRY_AD_UNAVAILABLE');
  const releaseActivity = claimNativeAd(mode === 'REWARDED_GATED' ? 'rewarded' : 'entry');
  if (!releaseActivity) throw new Error('AD_BUSY');

  // Analytics must not delay the next native ad's show() call.
  void recordAppEntryAdEvent({ eventType: 'REQUESTED', placementId, sessionId, adType, adIndex }).catch(() => undefined);
  let ad: InterstitialAd | RewardedVideoAd;
  try { ad = mode === 'INTERSTITIAL' ? getInterstitialAd(placementId) : getRewardedAd(placementId); }
  catch (error) { releaseActivity(); throw error; }
  const isEnded = await new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let closed: boolean | undefined;
    let shown = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseActivity();
      if (mode === 'INTERSTITIAL') releaseInterstitialAd(placementId, ad as InterstitialAd);
      else releaseRewardedAd(placementId, ad as RewardedVideoAd);
    };
    const cleanup = () => { timeout.clear(); ad.offClose(onClose); ad.offError(onError); };
    const finishClose = () => {
      if (settled || !shown || closed === undefined) return;
      settled = true;
      cleanup();
      release();
      resolve(closed);
    };
    const onClose = (result?: { isEnded: boolean }) => {
      if (settled || closed !== undefined) return;
      entryAdClosedAt.set(sessionId, performance.timeOrigin + performance.now());
      if (mode === 'REWARDED_GATED') markRewardedAdClosed();
      closed = mode === 'INTERSTITIAL' || result?.isEnded === true;
      cleanup();
      release();
      if (mode === 'INTERSTITIAL') prewarmInterstitialAd(placementId);
      else prewarmRewardedAd(placementId);
      finishClose();
    };
    const onError = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      release();
      shownAcknowledgements.delete(key);
      void recordAppEntryAdEvent({ eventType: 'FAILED', placementId, sessionId, adType, adIndex, errorCode: adErrorMessage(error) }).catch(() => undefined);
      reject(new Error(adErrorMessage(error)));
    };
    const timeout = adTimeout(onError);
    const showStartedAt = performance.now();
    ad.onClose(onClose);
    ad.onError(onError);
    void runAdShow(() => ad.show(), async () => {
      if (settled) return;
      timeout.shown();
      reportPerformance('ENTRY_AD_SHOW_ACCEPTED', '/native-ads/entry', performance.now() - showStartedAt, { adType, adIndex });
      // Overlap SHOWN acknowledgement with viewing. Completion still waits for
      // this exact impression to be recorded before asking the server to count it.
      shownAcknowledgements.set(key, createShownAcknowledgement(() => recordAppEntryAdEvent({
        eventType: 'SHOWN', placementId, sessionId, adType, adIndex, clientEventId: completionEventId
      })));
      shown = true;
      if (previousClosedAt !== undefined) {
        reportPerformance('ENTRY_AD_CLOSE_TO_NEXT_AD_SHOW_ACCEPTED', '/native-ads/entry', performance.timeOrigin + performance.now() - previousClosedAt, { adIndex });
        if (entryAdClosedAt.get(sessionId) === previousClosedAt) entryAdClosedAt.delete(sessionId);
      }
      onShown?.();
      finishClose();
    }, onError, onError);
  });
  if (!isEnded) void recordAppEntryAdEvent({ eventType: 'CLOSED_INCOMPLETE', placementId, sessionId, adType, adIndex }).catch(() => undefined);
  return { clientEventId: completionEventId, isEnded };
}

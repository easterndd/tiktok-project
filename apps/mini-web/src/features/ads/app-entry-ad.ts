import { ApiError, apiClient } from '../../lib/api-client';
import { isDemoMode } from '../../lib/storage';
import { storagePrefix } from '../../lib/app-brand';
import { getMiniLaunchAdId, getMiniLaunchIds, getMiniLaunchRef } from '../../lib/launch-context';
import { adTimeout, adErrorMessage } from './ad-timeout';
import { runAdShow } from './ad-show';
import { reportDiagnostic, reportPerformance } from '../../lib/diagnostics';
import { createShownAcknowledgement } from './shown-acknowledgement';
import { adLoadCallback, adLoadDurationMs, adLoadSupported, getInterstitialAd, getRewardedAd, prewarmInterstitialAd, prewarmInterstitialPlacements, prewarmRewardedAd, prewarmRewardedPlacements, primeEntryRewardedPool, readyRewardedPlacement, refillEntryRewardedPool, releaseInterstitialAd, releaseRewardedAd, returnRewardedAd, waitForAdReady } from './ad-instance-cache';
import { claimNativeAd, markRewardedAdClosed } from './ad-activity';
import { captureSdkCallback, newAdOperationId, nextAdSequence, recordAdClose, recordAdConfig, recordAdLoad, recordAdLoadResult, recordAdShow, recordEntryAdDecision } from '../../lib/analytics';
import { getAdPlatform, getDefaultAdLoadMode, getMiniReleaseId, isV006DualRelease, isV006Release } from './ad-platform';
import { classifyAdFailure, normalizeErrorOrigin, taggedAdFailure, type AdErrorOrigin } from './ad-error-policy';
import { restrictToPublicManifest, type AdPlacementType } from './ad-placement-manifest';
import { selectAdPlacement } from './ad-placement-selection';
import { captureClientTrace } from '../../lib/client-trace';

export type AppEntryAdSession = {
  required: boolean;
  sessionId?: string;
  mode?: 'INTERSTITIAL' | 'REWARDED_GATED';
  placementId?: string;
  placementIds?: string[];
  placementPolicyVersion?: number;
  adLoadMode?: 'DIRECT_SHOW' | 'EXPLICIT_LOAD';
  strategyVariant?: string;
  requiredCount?: number;
  countMode?: 'COMPLETED' | 'SHOWN';
  completedCount?: number;
  onUnavailable?: 'ALLOW' | 'BLOCK';
  entryFlowVersion?: number;
  legacyObservationProtocol?: boolean;
  expiresAt?: string;
  decisionId?: string;
  decision?: 'SHOW' | 'SUPPRESS';
  decisionReason?: string;
  launchRef?: string;
};

export type EpisodeInterstitialPolicy = {
  enabled: boolean;
  placementId: string | null;
  placementIds?: string[];
  placementPolicyVersion?: number;
  adLoadMode?: 'DIRECT_SHOW' | 'EXPLICIT_LOAD';
  strategyVariant?: string;
  initialDelaySeconds: number;
  intervalSeconds: number;
  minIntervalSeconds: number;
  maxPerSession: number;
  initialSkipTransitions: number;
  everyTransitions: number;
  rewardedCooldownSeconds: number;
};

export async function startEpisodeInterstitialPolicy(releaseId = getMiniReleaseId()) {
  const params = new URLSearchParams({ releaseId, platform: getAdPlatform() });
  const policy = await apiClient.get<EpisodeInterstitialPolicy>(`/episode-interstitial/config?${params}`);
  if (policy.placementId) {
    policy.placementIds = restrictToPublicManifest('INTERSTITIAL', policy.placementIds?.length ? policy.placementIds : [policy.placementId]);
    if (!policy.placementIds.includes(policy.placementId)) policy.enabled = false;
  }
  policy.adLoadMode ??= getDefaultAdLoadMode();
  policy.strategyVariant ??= 'CONTROL';
  return policy;
}

function eventId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  // TikTok WebView versions without randomUUID still need IDs accepted by API validation.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export function getLaunchId() {
  if (isV006DualRelease()) return getMiniLaunchIds().launchId;
  const releaseId = getMiniReleaseId();
  const key = releaseId === 'default' ? `${storagePrefix}_launch_id` : `${storagePrefix}_${releaseId}_launch_id`;
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const launchId = eventId();
  sessionStorage.setItem(key, launchId);
  return launchId;
}

const activeEntryAdSessions = new Map<string, Promise<AppEntryAdSession>>();

async function startAppEntryAdSessionInternal(launchRef?: string): Promise<AppEntryAdSession> {
  if (isDemoMode()) return { required: false };
  const startedAt = performance.now();
  try {
    const session = await apiClient.post<AppEntryAdSession>('/app-entry-ad-sessions', {
      launchId: getLaunchId(),
      releaseId: getMiniReleaseId(),
      ...(isV006DualRelease() ? { launchRef: launchRef ?? getMiniLaunchRef() } : { adId: getMiniLaunchAdId() }),
      platform: getAdPlatform(),
      ...(isV006DualRelease() ? { entryFlowVersion: 2 } : {})
    });
    if (isV006DualRelease() && import.meta.env?.VITE_ENTRY_COMPAT_MODE === 'true'
      && session.required && session.mode === 'REWARDED_GATED') {
      session.entryFlowVersion = 2;
      session.legacyObservationProtocol = true;
    }
    const durationMs = performance.now() - startedAt;
    reportPerformance('ENTRY_AD_POLICY_RESPONSE', '/app-entry-ad-sessions', durationMs, { required: session.required, mode: session.mode ?? 'NONE' });
    recordAdConfig({ result: 'success', durationMs, shouldShow: session.required ? session.requiredCount ?? 1 : 0, path: '/app-entry-ad-sessions' });
    if (isV006DualRelease()) recordEntryAdDecision({ launchRef: session.launchRef ?? launchRef, decisionId: session.decisionId,
      decision: session.decision, reason: session.decisionReason, required: session.required });
    if (session.required && session.placementId) {
      const type: AdPlacementType = session.mode === 'INTERSTITIAL' ? 'INTERSTITIAL' : 'REWARDED';
      session.placementIds = restrictToPublicManifest(type, session.placementIds?.length ? session.placementIds : [session.placementId]);
      const loadMode = session.adLoadMode ?? getDefaultAdLoadMode();
      if (session.placementIds.includes(session.placementId)) {
        if (session.entryFlowVersion === 2 && session.mode === 'REWARDED_GATED') primeEntryRewardedPool(session.placementIds, loadMode);
        else if (session.mode === 'INTERSTITIAL') prewarmInterstitialPlacements(session.placementIds, loadMode);
        else if (session.mode === 'REWARDED_GATED') prewarmRewardedPlacements(session.placementIds, loadMode);
      }
    }
    return session;
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    recordAdConfig({ result: /timeout|abort/i.test(message) ? 'timeout' : 'fail', durationMs, shouldShow: null, error, path: '/app-entry-ad-sessions' });
    throw error;
  }
}

export function startAppEntryAdSession(launchRef?: string): Promise<AppEntryAdSession> {
  const key = `${getMiniReleaseId()}:${getLaunchId()}`;
  const existing = activeEntryAdSessions.get(key);
  if (existing) return existing;
  let promise: Promise<AppEntryAdSession>;
  promise = startAppEntryAdSessionInternal(launchRef).finally(() => {
    if (activeEntryAdSessions.get(key) === promise) activeEntryAdSessions.delete(key);
  });
  activeEntryAdSessions.set(key, promise);
  return promise;
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

export async function acknowledgeAppEntryAdShown(sessionId: string, clientEventId: string, adIndex: number, placementId?: string, adType: 'REWARDED' | 'INTERSTITIAL' = 'REWARDED') {
  const path = `/app-entry-ad-sessions/${sessionId}/shown`;
  const startedAt = performance.now();
  if (placementId) await recordAppEntryAdEvent({ eventType: 'SHOWN', clientEventId, placementId, sessionId, adType, adIndex });
  const result = await apiClient.post<EntryAdProgress>(path, { clientEventId, adIndex, ...(placementId ? { placementId } : {}) });
  reportPerformance('ENTRY_AD_SHOWN_COUNT_RESPONSE', path, performance.now() - startedAt, { adIndex });
  return result;
}

export function recordAppEntryAdEvent(input: { eventType: 'SHOWN' | 'CLOSED_INCOMPLETE' | 'FAILED'; placementId: string; sessionId: string; adType: 'REWARDED' | 'INTERSTITIAL'; adIndex: number; errorCode?: string; clientEventId?: string }) {
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

type AppEntryAdShowInput = { mode: 'INTERSTITIAL' | 'REWARDED_GATED'; placementId: string; placementIds?: string[]; attemptNo?: number; adLoadMode?: 'DIRECT_SHOW' | 'EXPLICIT_LOAD'; strategyVariant?: string; sessionId: string; adIndex: number; requiredCount?: number; countMode?: 'COMPLETED' | 'SHOWN'; fastHandoff?: boolean; onShown?: (playback: { clientEventId: string; isEnded: boolean; placementId: string; adType: 'REWARDED' | 'INTERSTITIAL' }) => void };

async function showAppEntryAdInternal(input: AppEntryAdShowInput): Promise<{ clientEventId: string; isEnded: boolean; placementId: string; adType: 'REWARDED' | 'INTERSTITIAL' }> {
  const { mode, placementId, sessionId, adIndex, requiredCount, countMode = 'COMPLETED', onShown } = input;
  const placementIds = input.placementIds ?? [placementId];
  if (!placementIds.length || !placementIds.includes(placementId)) throw new Error('AD_PLACEMENT_CONFIGURATION_MISMATCH');
  const loadMode = input.adLoadMode ?? getDefaultAdLoadMode();
  const strategyVariant = input.strategyVariant ?? 'CONTROL';
  const adSeq = nextAdSequence();
  const adType: 'INTERSTITIAL' | 'REWARDED' = mode === 'INTERSTITIAL' ? 'INTERSTITIAL' : 'REWARDED';
  const operationId = newAdOperationId('entry', adSeq);
  const placementRole: 'PRIMARY' | 'BACKUP' = placementId === placementIds[0] ? 'PRIMARY' : 'BACKUP';
  const attemptNo = input.attemptNo ?? 1;
  const previousClosedAt = entryAdClosedAt.get(sessionId);
  const completionEventId = eventId();
  const key = `${sessionId}:${completionEventId}`;
  const capability = mode === 'INTERSTITIAL' ? 'createInterstitialAd' : 'createRewardedVideoAd';
  if (!window.TTMinis?.canIUse(capability)) throw new Error('ENTRY_AD_UNAVAILABLE');
  const releaseActivity = claimNativeAd(input.fastHandoff ? 'entry' : mode === 'REWARDED_GATED' ? 'rewarded' : 'entry', { entryHandoff: input.fastHandoff });
  if (!releaseActivity) throw new Error('AD_BUSY');

  let ad: InterstitialAd | RewardedVideoAd | undefined;
  const loadStartedAt = performance.now();
  try {
    const prewarmNext = requiredCount === undefined || adIndex < requiredCount;
    ad = mode === 'INTERSTITIAL' ? getInterstitialAd(placementId, prewarmNext, loadMode) : getRewardedAd(placementId, prewarmNext, loadMode);
    await waitForAdReady(ad);
    recordAdLoadResult({ adSeq, adType, placementId, supported: adLoadSupported(ad), loadMode, durationMs: adLoadDurationMs(ad, performance.now() - loadStartedAt), callback: adLoadCallback(ad), operationId, attemptNo, adPhase: 'LOAD', strategyVariant, placementRole });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const callback = ad ? (adLoadCallback(ad) ?? captureSdkCallback('load.wait.reject', error, { operationId, sessionId, placementId })) : captureSdkCallback('load.create.reject', error, { operationId, sessionId, placementId });
    recordAdLoad({ adSeq, adType, placementId, result: /timeout|abort/i.test(message) ? 'timeout' : 'fail', durationMs: ad ? adLoadDurationMs(ad, performance.now() - loadStartedAt) : performance.now() - loadStartedAt, error, callback, operationId, attemptNo, adPhase: 'LOAD', strategyVariant, placementRole, errorOrigin: normalizeErrorOrigin(error, callback.name === 'onError' ? 'onError' : 'load.reject') });
    if (ad) {
      if (mode === 'INTERSTITIAL') releaseInterstitialAd(placementId, ad as InterstitialAd);
      else releaseRewardedAd(placementId, ad as RewardedVideoAd);
    }
    releaseActivity();
    void recordAppEntryAdEvent({ eventType: 'FAILED', placementId, sessionId, adType, adIndex, errorCode: adErrorMessage(error) }).catch(() => undefined);
    throw error;
  }
  const isEnded = await new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let closed: boolean | undefined;
    let shown = false;
    let shownAt = 0;
    let released = false;
    const release = (deferDisposal = false, keepReady = false) => {
      if (released) return;
      released = true;
      releaseActivity();
      const dispose = () => {
        if (mode === 'INTERSTITIAL') releaseInterstitialAd(placementId, ad as InterstitialAd);
        else releaseRewardedAd(placementId, ad as RewardedVideoAd);
      };
      if (keepReady && mode === 'REWARDED_GATED' && returnRewardedAd(placementId, ad as RewardedVideoAd, loadMode)) return;
      if (deferDisposal) window.setTimeout(dispose, 0);
      else dispose();
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
      const closeEvent = { adSeq, adType, placementId, isEnded: mode === 'INTERSTITIAL' ? null : result?.isEnded === true,
        durationMs: performance.now() - (shownAt || showStartedAt), callback: captureSdkCallback('onClose', result, { operationId, sessionId, placementId }),
        operationId, attemptNo, adPhase: 'CLOSE' as const, strategyVariant, placementRole };
      if (input.fastHandoff) window.setTimeout(() => recordAdClose(closeEvent), 0);
      else recordAdClose(closeEvent);
      entryAdClosedAt.set(sessionId, performance.timeOrigin + performance.now());
      if (mode === 'REWARDED_GATED') markRewardedAdClosed();
      closed = mode === 'INTERSTITIAL' || result?.isEnded === true;
      cleanup();
      release(input.fastHandoff && getAdPlatform() === 'android');
      if (!input.fastHandoff && (requiredCount === undefined || adIndex < requiredCount)) {
        if (mode === 'INTERSTITIAL') prewarmInterstitialPlacements(placementIds, loadMode);
        else prewarmRewardedPlacements(placementIds, loadMode);
      }
      finishClose();
    };
    const failShow = (error: unknown, origin: AdErrorOrigin) => {
      if (settled) return;
      const message = adErrorMessage(error);
      recordAdShow({ adSeq, adType, placementId, result: /timeout|abort/i.test(message) ? 'timeout' : 'fail', durationMs: performance.now() - showStartedAt, error, callback: captureSdkCallback(origin === 'SDK_CALLBACK' ? 'onError' : origin === 'APP_TIMEOUT' ? 'app.timeout' : 'show.reject', error, { operationId, sessionId, placementId }), operationId, attemptNo, adPhase: 'SHOW', strategyVariant, placementRole, errorOrigin: origin });
      settled = true;
      cleanup();
      release(false, input.fastHandoff && mode === 'REWARDED_GATED' && /AD_BUSY|104111006|\b11006\b/i.test(message));
      shownAcknowledgements.delete(key);
      void recordAppEntryAdEvent({ eventType: 'FAILED', placementId, sessionId, adType, adIndex, errorCode: adErrorMessage(error) }).catch(() => undefined);
      reject(taggedAdFailure(message, origin));
    };
    const onError = (error: unknown) => failShow(error, 'SDK_CALLBACK');
    const onReportError = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      release();
      shownAcknowledgements.delete(key);
      reportDiagnostic({ kind: 'API', phase: 'ENTRY_AD_SHOWN_ACK', message: adErrorMessage(error), path: '/ad-events' });
      reject(error);
    };
    const timeout = adTimeout((error) => failShow(error, 'APP_TIMEOUT'));
    const showStartedAt = performance.now();
    ad.onClose(onClose);
    ad.onError(onError);
    void runAdShow(() => {
      captureClientTrace('SDK_CALL', 'show', { adType, adIndex, placementId, loadMode }, { operationId, sessionId, placementId });
      return ad.show();
    }, async () => {
      if (settled) return;
      timeout.shown();
      shownAt = performance.now();
      recordAdShow({ adSeq, adType, placementId, result: 'success', durationMs: performance.now() - showStartedAt, callback: captureSdkCallback('show.resolve', null, { operationId, sessionId, placementId }), operationId, attemptNo, adPhase: 'SHOW', strategyVariant, placementRole });
      if (input.fastHandoff && mode === 'REWARDED_GATED') {
        refillEntryRewardedPool(placementIds, loadMode);
      } else if (getAdPlatform() === 'android' && isV006Release() && adIndex < (requiredCount ?? adIndex)) {
        const nextId = selectAdPlacement(placementIds[0], placementIds, adIndex + 1, 'android', true);
        if (nextId !== placementId) {
          if (mode === 'INTERSTITIAL') prewarmInterstitialAd(nextId, 1, loadMode);
          else prewarmRewardedAd(nextId, 1, loadMode);
        }
      }
      reportPerformance('ENTRY_AD_SHOW_ACCEPTED', '/native-ads/entry', performance.now() - showStartedAt, { adType, adIndex });
      if (countMode === 'COMPLETED') {
        // The completion endpoint still requires a persisted impression and full watch.
        shownAcknowledgements.set(key, createShownAcknowledgement(() => recordAppEntryAdEvent({
          eventType: 'SHOWN', placementId, sessionId, adType, adIndex, clientEventId: completionEventId
        })));
      }
      shown = true;
      if (previousClosedAt !== undefined) {
        reportPerformance('ENTRY_AD_CLOSE_TO_NEXT_AD_SHOW_ACCEPTED', '/native-ads/entry', performance.timeOrigin + performance.now() - previousClosedAt, { adIndex });
        if (entryAdClosedAt.get(sessionId) === previousClosedAt) entryAdClosedAt.delete(sessionId);
      }
      onShown?.({ clientEventId: completionEventId, isEnded: false, placementId, adType });
      finishClose();
    }, (error) => failShow(error, 'SDK_PROMISE'), onReportError);
  });
  if (!isEnded && countMode !== 'SHOWN') {
    void recordAppEntryAdEvent({ eventType: 'CLOSED_INCOMPLETE', placementId, sessionId, adType, adIndex }).catch(() => undefined);
  }
  return { clientEventId: completionEventId, isEnded, placementId, adType };
}

const activeEntryAdShows = new Map<string, Promise<{ clientEventId: string; isEnded: boolean; placementId: string; adType: 'REWARDED' | 'INTERSTITIAL' }>>();

async function showAppEntryAdWithFallback(input: AppEntryAdShowInput) {
  try {
    return await showAppEntryAdInternal(input);
  } catch (error) {
    const backup = input.placementIds?.find((id) => id !== input.placementId);
    if (getAdPlatform() !== 'android' || !backup || classifyAdFailure(error, normalizeErrorOrigin(error)) !== 'TRY_BACKUP_ONCE') throw error;
    if (!input.fastHandoff) await new Promise((resolve) => window.setTimeout(resolve, 650));
    return showAppEntryAdInternal({ ...input, placementId: backup, attemptNo: 2 });
  }
}

export function showAppEntryAd(input: AppEntryAdShowInput) {
  const preferred = selectAdPlacement(input.placementIds?.[0] ?? input.placementId, input.placementIds ?? [input.placementId], input.adIndex, getAdPlatform(), isV006Release(getMiniReleaseId()));
  const placementId = input.fastHandoff && input.mode === 'REWARDED_GATED' && getAdPlatform() === 'android'
    ? readyRewardedPlacement(input.placementIds ?? [preferred], preferred, input.adLoadMode) : preferred;
  const selected = { ...input, placementId };
  const placementIds = selected.placementIds ?? [selected.placementId];
  if (!selected.fastHandoff) {
    if (selected.mode === 'INTERSTITIAL') prewarmInterstitialPlacements(placementIds, selected.adLoadMode);
    else prewarmRewardedPlacements(placementIds, selected.adLoadMode);
  }
  const key = `${selected.mode}:${selected.placementId}:${selected.sessionId}:${selected.adIndex}`;
  const existing = activeEntryAdShows.get(key);
  if (existing) return existing;
  let promise: Promise<{ clientEventId: string; isEnded: boolean; placementId: string; adType: 'REWARDED' | 'INTERSTITIAL' }>;
  promise = showAppEntryAdWithFallback(selected).finally(() => {
    if (activeEntryAdShows.get(key) === promise) activeEntryAdShows.delete(key);
  });
  activeEntryAdShows.set(key, promise);
  return promise;
}

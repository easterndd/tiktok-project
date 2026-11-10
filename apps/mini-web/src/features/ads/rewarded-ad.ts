import { ApiError, apiClient } from '../../lib/api-client';
import { isDemoMode } from '../../lib/storage';
import { reportDiagnostic, reportPerformance } from '../../lib/diagnostics';
import { adTimeout, adErrorMessage } from './ad-timeout';
import { adLoadCallback, adLoadDurationMs, adLoadSupported, getRewardedAd, prewarmRewardedAd, prewarmRewardedPlacements, releaseRewardedAd, waitForAdReady } from './ad-instance-cache';
import { claimNativeAd, markRewardedAdClosed } from './ad-activity';
import { captureSdkCallback, newAdOperationId, nextAdSequence, recordAdClose, recordAdLoad, recordAdLoadResult, recordAdShow } from '../../lib/analytics';
import { getAdPlatform, getDefaultAdLoadMode, getMiniReleaseId, isV006Release } from './ad-platform';
import { classifyAdFailure, normalizeErrorOrigin, taggedAdFailure, type AdErrorOrigin } from './ad-error-policy';
import { restrictToPublicManifest } from './ad-placement-manifest';
import { selectAdPlacement } from './ad-placement-selection';

const clientEventId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `client-${Date.now()}`;

type RewardSession = {
  access: 'PLAYABLE' | 'REWARDED_AD_REQUIRED';
  sessionId?: string;
  placementId?: string;
  placementIds?: string[];
  placementPolicyVersion?: number;
  adLoadMode?: 'DIRECT_SHOW' | 'EXPLICIT_LOAD';
  strategyVariant?: string;
  completedCount?: number;
  requiredCount?: number;
};

type RewardComplete = {
  access: 'PLAYABLE' | 'REWARDED_AD_REQUIRED';
  shouldContinue: boolean;
  completedCount?: number;
  requiredCount?: number;
};

const rewardSessions = new Map<string, { promise: Promise<RewardSession>; expiresAt: number }>();
type RewardPurpose = 'EPISODE_UNLOCK' | 'EXIT_RETENTION';
type RewardOptions = { purpose?: RewardPurpose; releaseId?: string };
const sessionKey = (episodeId: string, options: RewardOptions, releaseId: string) => `${options.purpose ?? 'EPISODE_UNLOCK'}:${releaseId}:${episodeId}`;

export function prepareRewardedUnlockSession(episodeId: string, options: RewardOptions = {}) {
  const releaseId = options.releaseId ?? getMiniReleaseId();
  const key = sessionKey(episodeId, options, releaseId);
  const cached = rewardSessions.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const entry = {
    promise: Promise.resolve({ access: 'PLAYABLE' } as RewardSession),
    expiresAt: Date.now() + 25 * 60 * 1000
  };
  entry.promise = apiClient.post<RewardSession>(`/episodes/${episodeId}/reward-session`, {
    purpose: options.purpose ?? 'EPISODE_UNLOCK', releaseId, platform: getAdPlatform()
  }).then((session) => {
    if (session.access === 'REWARDED_AD_REQUIRED' && session.placementId) {
      session.placementIds = restrictToPublicManifest('REWARDED', session.placementIds?.length ? session.placementIds : [session.placementId]);
      if (!session.placementIds.includes(session.placementId)) throw new Error('AD_PLACEMENT_CONFIGURATION_MISMATCH');
      session.adLoadMode ??= getDefaultAdLoadMode();
      session.strategyVariant ??= 'CONTROL';
      prewarmRewardedPlacements(session.placementIds, session.adLoadMode);
      if (rewardSessions.get(key) === entry) {
        rewardSessions.set(key, { promise: Promise.resolve(session), expiresAt: entry.expiresAt });
      }
    } else if (rewardSessions.get(key) === entry) {
      rewardSessions.delete(key);
    }
    return session;
  }).catch((error) => {
    if (rewardSessions.get(key) === entry) rewardSessions.delete(key);
    throw error;
  });
  rewardSessions.set(key, entry);
  return entry.promise;
}

async function completeReward(episodeId: string, sessionId: string, eventId: string) {
  const payload = { clientEventId: eventId, isEnded: true };
  const path = `/episodes/${episodeId}/reward-session/${sessionId}/complete`;
  for (let attempt = 0; ; attempt++) {
    const startedAt = performance.now();
    try {
      const result = await apiClient.post<RewardComplete>(path, payload);
      reportPerformance('REWARDED_COMPLETE_RESPONSE', path, performance.now() - startedAt, { attempt: attempt + 1 });
      return result;
    } catch (error) {
      const retryable = !(error instanceof ApiError)
        || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
      reportPerformance('REWARDED_COMPLETE_FAILED', path, performance.now() - startedAt, { attempt: attempt + 1, statusCode: error instanceof ApiError ? error.status : 0, retryable });
      if (!retryable || attempt >= 2) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

async function recordAdEvent(input: { clientEventId: string; eventType: 'SHOWN' | 'CLOSED_INCOMPLETE' | 'FAILED'; placementId: string; episodeId: string; sessionId: string; adIndex: number; scope: RewardPurpose; errorCode?: string }, required = false) {
  for (let attempt = 0; ; attempt += 1) {
    const startedAt = performance.now();
    try {
      await apiClient.post('/ad-events', { adType: 'REWARDED', ...input, rewardSessionId: input.sessionId });
      if (input.eventType === 'SHOWN') reportPerformance('REWARDED_SHOWN_ACK_RESPONSE', '/ad-events', performance.now() - startedAt, { adIndex: input.adIndex, attempt: attempt + 1 });
      return true;
    } catch (error) {
      if (input.eventType === 'SHOWN') reportPerformance('REWARDED_SHOWN_ACK_FAILED', '/ad-events', performance.now() - startedAt, { adIndex: input.adIndex, attempt: attempt + 1, statusCode: error instanceof ApiError ? error.status : 0 });
      const retryable = required && (!(error instanceof ApiError) || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500);
      if (!retryable || attempt >= 2) {
        if (required) throw error;
        return false;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

async function showOneRewardedAd(input: { adUnitId: string; placementIds: string[]; attemptNo?: number; requiredCount?: number; adLoadMode: 'DIRECT_SHOW' | 'EXPLICIT_LOAD'; strategyVariant: string; episodeId: string; sessionId: string; adIndex: number; rewardEventId: string; scope: RewardPurpose; previousClosedAt?: number }) {
  const { adUnitId, placementIds, adLoadMode, strategyVariant, episodeId, sessionId, adIndex, rewardEventId, scope, previousClosedAt } = input;
  const adSeq = nextAdSequence();
  const operationId = newAdOperationId('reward', adSeq);
  const placementRole = adUnitId === placementIds[0] ? 'PRIMARY' : 'BACKUP';
  const attemptNo = input.attemptNo ?? 1;
  const releaseActivity = claimNativeAd('rewarded');
  if (!releaseActivity) throw new Error('AD_BUSY');
  let ad;
  const loadStartedAt = performance.now();
  try {
    ad = getRewardedAd(adUnitId, true, adLoadMode);
    await waitForAdReady(ad);
    recordAdLoadResult({ adSeq, adType: 'REWARDED', placementId: adUnitId, supported: adLoadSupported(ad), loadMode: adLoadMode, durationMs: adLoadDurationMs(ad, performance.now() - loadStartedAt), callback: adLoadCallback(ad), operationId, attemptNo, adPhase: 'LOAD', strategyVariant, placementRole });
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const callback = ad ? (adLoadCallback(ad) ?? captureSdkCallback('load.wait.reject', error)) : captureSdkCallback('load.create.reject', error);
    recordAdLoad({ adSeq, adType: 'REWARDED', placementId: adUnitId, result: /timeout|abort/i.test(message) ? 'timeout' : 'fail', durationMs: ad ? adLoadDurationMs(ad, performance.now() - loadStartedAt) : performance.now() - loadStartedAt, error, callback, operationId, attemptNo, adPhase: 'LOAD', strategyVariant, placementRole, errorOrigin: normalizeErrorOrigin(error, callback.name === 'onError' ? 'onError' : 'load.reject') });
    if (ad) releaseRewardedAd(adUnitId, ad);
    releaseActivity();
    reportDiagnostic({ kind: 'AD', phase: 'REWARDED_CREATE', message, path: `/episodes/${episodeId}` });
    throw error;
  }
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    let closedAt = 0;
    let shownAt = 0;
    const cleanup = () => { timeout.clear(); ad.offClose(onClose); ad.offError(onError); };
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseRewardedAd(adUnitId, ad);
      releaseActivity();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      release();
      reject(error);
    };
    const onClose = (result?: { isEnded: boolean }) => {
      const isEnded = result?.isEnded === true;
      closedAt = performance.timeOrigin + performance.now();
      recordAdClose({ adSeq, adType: 'REWARDED', placementId: adUnitId, isEnded, durationMs: performance.now() - (shownAt || showStartedAt), callback: captureSdkCallback('onClose', result), operationId, attemptNo, adPhase: 'CLOSE', strategyVariant, placementRole });
      markRewardedAdClosed();
      if (!settled) {
        cleanup();
        release();
        prewarmRewardedPlacements(placementIds, adLoadMode);
      }
      if (!isEnded) {
        void recordAdEvent({ clientEventId: `${rewardEventId}:incomplete`, eventType: 'CLOSED_INCOMPLETE', placementId: adUnitId, episodeId, sessionId, adIndex, scope });
        fail(new Error('AD_REWARD_NOT_EARNED'));
      }
      else void shownConfirmation.then(() => {
        if (settled) return;
        settled = true;
        cleanup();
        release();
      resolve(closedAt || Date.now());
      }, fail);
    };
    const onFailure = (error: unknown, origin: AdErrorOrigin) => {
      if (settled) return;
      const errorCode = adErrorMessage(error);
      recordAdShow({ adSeq, adType: 'REWARDED', placementId: adUnitId, result: /timeout|abort/i.test(errorCode) ? 'timeout' : 'fail', durationMs: performance.now() - showStartedAt, error, callback: captureSdkCallback(origin === 'SDK_CALLBACK' ? 'onError' : origin === 'APP_TIMEOUT' ? 'app.timeout' : 'show.reject', error), operationId, attemptNo, adPhase: 'SHOW', strategyVariant, placementRole, errorOrigin: origin });
      reportDiagnostic({ kind: 'AD', phase: 'REWARDED_SHOW', message: errorCode, path: `/episodes/${episodeId}` });
      void recordAdEvent({ clientEventId: `${rewardEventId}:failed`, eventType: 'FAILED', placementId: adUnitId, episodeId, sessionId, adIndex, scope, errorCode });
      fail(taggedAdFailure(errorCode, origin));
    };
    const onError = (error: unknown) => onFailure(error, 'SDK_CALLBACK');
    const timeout = adTimeout((error) => onFailure(error, 'APP_TIMEOUT'));
    const showStartedAt = performance.now();
    let showAccepted = false;
    const shownConfirmation = Promise.resolve().then(() => ad.show()).then(() => {
      if (settled) return false;
      showAccepted = true;
      timeout.shown();
      shownAt = performance.now();
      recordAdShow({ adSeq, adType: 'REWARDED', placementId: adUnitId, result: 'success', durationMs: performance.now() - showStartedAt, callback: captureSdkCallback('show.resolve'), operationId, attemptNo, adPhase: 'SHOW', strategyVariant, placementRole });
      if (getAdPlatform() === 'android' && isV006Release() && adIndex < (input.requiredCount ?? adIndex)) {
        const nextId = selectAdPlacement(placementIds[0], placementIds, adIndex + 1, 'android', true);
        if (nextId !== adUnitId) prewarmRewardedAd(nextId, 1, adLoadMode);
      }
      reportPerformance('REWARDED_AD_SHOW_ACCEPTED', '/native-ads/rewarded', performance.now() - showStartedAt, { adIndex });
      if (previousClosedAt !== undefined) reportPerformance('REWARDED_CLOSE_TO_NEXT_AD_SHOW_ACCEPTED', '/native-ads/rewarded', performance.timeOrigin + performance.now() - previousClosedAt, { adIndex });
      return recordAdEvent({ clientEventId: rewardEventId, eventType: 'SHOWN', placementId: adUnitId, episodeId, sessionId, adIndex, scope }, true);
    });
    ad.onClose(onClose);
    ad.onError(onError);
    void shownConfirmation.catch((error) => {
      if (showAccepted) {
        reportDiagnostic({ kind: 'API', phase: 'REWARDED_SHOWN_ACK', message: adErrorMessage(error), path: '/ad-events' });
        fail(error);
      } else onFailure(error, 'SDK_PROMISE');
    });
  });
}

export async function unlockEpisodeByRewardedAd(episodeId: string, options: RewardOptions = {}): Promise<number | undefined> {
  const sessionWaitStartedAt = performance.now();
  const session = await prepareRewardedUnlockSession(episodeId, options);
  reportPerformance('REWARDED_UNLOCK_SESSION_READY', `/episodes/${episodeId}/reward-session`, performance.now() - sessionWaitStartedAt, { access: session.access });
  if (session.access === 'PLAYABLE') return undefined;
  if (!session.sessionId || !session.placementId) throw new Error('REWARDED_SESSION_UNAVAILABLE');

  if (isDemoMode()) {
    let shouldContinue = true;
    while (shouldContinue) {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      const result = await completeReward(episodeId, session.sessionId, clientEventId());
      shouldContinue = result.shouldContinue;
    }
    return;
  }
  if (!window.TTMinis?.canIUse('createRewardedVideoAd')) {
    reportDiagnostic({ kind: 'AD', phase: 'REWARDED_UNAVAILABLE', message: 'REWARDED_AD_UNAVAILABLE', path: `/episodes/${episodeId}` });
    throw new Error('REWARDED_AD_UNAVAILABLE');
  }

  // Construct the native object before the first show() call. The reference
  // package does this at module/view setup, removing synchronous SDK creation
  // from the user click path while keeping server placement authoritative.
  const releaseId = options.releaseId ?? getMiniReleaseId();
  const placementIds = session.placementIds?.length ? session.placementIds : [session.placementId];
  const allowedPlacementIds = restrictToPublicManifest('REWARDED', placementIds);
  if (!allowedPlacementIds.includes(session.placementId)) throw new Error('AD_PLACEMENT_CONFIGURATION_MISMATCH');
  const adLoadMode = session.adLoadMode ?? getDefaultAdLoadMode();
  const strategyVariant = session.strategyVariant ?? 'CONTROL';
  const canTryBackup = isV006Release(releaseId) && getAdPlatform() === 'android' && allowedPlacementIds.length > 1;
  let adIndex = (session.completedCount ?? 0) + 1;
  prewarmRewardedPlacements(allowedPlacementIds, adLoadMode);

  let shouldContinue = true;
  let previousClosedAt: number | undefined;
  while (shouldContinue) {
    let eventId = clientEventId();
    let closedAt: number;
    const selectedId = selectAdPlacement(session.placementId, allowedPlacementIds, adIndex, getAdPlatform(), isV006Release(releaseId));
    try {
      closedAt = await showOneRewardedAd({ adUnitId: selectedId, placementIds: allowedPlacementIds, requiredCount: session.requiredCount, adLoadMode, strategyVariant, episodeId, sessionId: session.sessionId, adIndex, rewardEventId: eventId, scope: options.purpose ?? 'EPISODE_UNLOCK', previousClosedAt });
    } catch (error) {
      const backup = allowedPlacementIds.find((id) => id !== selectedId);
      if (!canTryBackup || !backup || classifyAdFailure(error, normalizeErrorOrigin(error)) !== 'TRY_BACKUP_ONCE') throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      eventId = clientEventId();
      closedAt = await showOneRewardedAd({ adUnitId: backup, placementIds: allowedPlacementIds, attemptNo: 2, requiredCount: session.requiredCount, adLoadMode, strategyVariant, episodeId, sessionId: session.sessionId, adIndex, rewardEventId: eventId, scope: options.purpose ?? 'EPISODE_UNLOCK', previousClosedAt });
    }
    const result = await completeReward(episodeId, session.sessionId, eventId);
    shouldContinue = result.shouldContinue;
    session.completedCount = result.completedCount ?? adIndex;
    session.requiredCount = result.requiredCount ?? session.requiredCount;
    previousClosedAt = closedAt;
    if (!shouldContinue) rewardSessions.delete(sessionKey(episodeId, options, releaseId));
    adIndex += 1;
  }
  return previousClosedAt;
}

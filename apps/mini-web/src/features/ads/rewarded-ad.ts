import { ApiError, apiClient } from '../../lib/api-client';
import { isDemoMode } from '../../lib/storage';
import { reportDiagnostic, reportPerformance } from '../../lib/diagnostics';
import { adTimeout, adErrorMessage } from './ad-timeout';
import { getRewardedAd, prewarmRewardedAd, releaseRewardedAd } from './ad-instance-cache';
import { claimNativeAd, markRewardedAdClosed } from './ad-activity';

const clientEventId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `client-${Date.now()}`;

type RewardSession = {
  access: 'PLAYABLE' | 'REWARDED_AD_REQUIRED';
  sessionId?: string;
  placementId?: string;
};

type RewardComplete = {
  access: 'PLAYABLE' | 'REWARDED_AD_REQUIRED';
  shouldContinue: boolean;
};

const rewardSessions = new Map<string, { promise: Promise<RewardSession>; expiresAt: number }>();

export function prepareRewardedUnlockSession(episodeId: string) {
  const cached = rewardSessions.get(episodeId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const entry = {
    promise: Promise.resolve({ access: 'PLAYABLE' } as RewardSession),
    expiresAt: Date.now() + 25 * 60 * 1000
  };
  entry.promise = apiClient.post<RewardSession>(`/episodes/${episodeId}/reward-session`, {}).then((session) => {
    if (session.access === 'REWARDED_AD_REQUIRED' && session.placementId) {
      prewarmRewardedAd(session.placementId);
      if (rewardSessions.get(episodeId) === entry) {
        rewardSessions.set(episodeId, { promise: Promise.resolve(session), expiresAt: entry.expiresAt });
      }
    } else if (rewardSessions.get(episodeId) === entry) {
      rewardSessions.delete(episodeId);
    }
    return session;
  }).catch((error) => {
    if (rewardSessions.get(episodeId) === entry) rewardSessions.delete(episodeId);
    throw error;
  });
  rewardSessions.set(episodeId, entry);
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

async function recordAdEvent(input: { clientEventId: string; eventType: 'REQUESTED' | 'SHOWN' | 'CLOSED_INCOMPLETE' | 'FAILED'; placementId: string; episodeId: string; sessionId: string; adIndex: number; errorCode?: string }, required = false) {
  const startedAt = performance.now();
  try {
    await apiClient.post('/ad-events', { adType: 'REWARDED', ...input, rewardSessionId: input.sessionId });
    if (input.eventType === 'SHOWN') reportPerformance('REWARDED_SHOWN_ACK_RESPONSE', '/ad-events', performance.now() - startedAt, { adIndex: input.adIndex });
    return true;
  } catch (error) {
    if (input.eventType === 'SHOWN') reportPerformance('REWARDED_SHOWN_ACK_FAILED', '/ad-events', performance.now() - startedAt, { adIndex: input.adIndex, statusCode: error instanceof ApiError ? error.status : 0 });
    if (required) throw error;
    return false;
  }
}

async function showOneRewardedAd(input: { adUnitId: string; episodeId: string; sessionId: string; adIndex: number; rewardEventId: string; previousClosedAt?: number }) {
  const { adUnitId, episodeId, sessionId, adIndex, rewardEventId, previousClosedAt } = input;
  const releaseActivity = claimNativeAd('rewarded');
  if (!releaseActivity) throw new Error('AD_BUSY');
  // REQUESTED is analytics only; network latency must not block the native ad.
  void recordAdEvent({ clientEventId: `${rewardEventId}:requested`, eventType: 'REQUESTED', placementId: adUnitId, episodeId, sessionId, adIndex });
  let ad;
  try { ad = getRewardedAd(adUnitId); }
  catch (error) { releaseActivity(); reportDiagnostic({ kind: 'AD', phase: 'REWARDED_CREATE', message: error instanceof Error ? error.message : String(error), path: `/episodes/${episodeId}` }); throw error; }
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    let closedAt = 0;
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
    const onClose = ({ isEnded }: { isEnded: boolean }) => {
      closedAt = performance.timeOrigin + performance.now();
      markRewardedAdClosed();
      if (!settled) {
        cleanup();
        release();
        prewarmRewardedAd(adUnitId);
      }
      if (!isEnded) {
        void recordAdEvent({ clientEventId: `${rewardEventId}:incomplete`, eventType: 'CLOSED_INCOMPLETE', placementId: adUnitId, episodeId, sessionId, adIndex });
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
    const onError = (error: unknown) => {
      if (settled) return;
      const errorCode = adErrorMessage(error);
      reportDiagnostic({ kind: 'AD', phase: 'REWARDED_SHOW', message: errorCode, path: `/episodes/${episodeId}` });
      void recordAdEvent({ clientEventId: `${rewardEventId}:failed`, eventType: 'FAILED', placementId: adUnitId, episodeId, sessionId, adIndex, errorCode });
      fail(new Error(errorCode));
    };
    const timeout = adTimeout(onError);
    const showStartedAt = performance.now();
    const shownConfirmation = Promise.resolve().then(() => ad.show()).then(() => {
      if (settled) return false;
      timeout.shown();
      reportPerformance('REWARDED_AD_SHOW_ACCEPTED', '/native-ads/rewarded', performance.now() - showStartedAt, { adIndex });
      if (previousClosedAt !== undefined) reportPerformance('REWARDED_CLOSE_TO_NEXT_AD_SHOW_ACCEPTED', '/native-ads/rewarded', performance.timeOrigin + performance.now() - previousClosedAt, { adIndex });
      return recordAdEvent({ clientEventId: rewardEventId, eventType: 'SHOWN', placementId: adUnitId, episodeId, sessionId, adIndex }, true);
    });
    ad.onClose(onClose);
    ad.onError(onError);
    void shownConfirmation.catch(onError);
  });
}

export async function unlockEpisodeByRewardedAd(episodeId: string): Promise<number | undefined> {
  const sessionWaitStartedAt = performance.now();
  const session = await prepareRewardedUnlockSession(episodeId);
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
  prewarmRewardedAd(session.placementId);

  let shouldContinue = true;
  let adIndex = 1;
  let previousClosedAt: number | undefined;
  while (shouldContinue) {
    const eventId = clientEventId();
    const closedAt = await showOneRewardedAd({ adUnitId: session.placementId, episodeId, sessionId: session.sessionId, adIndex, rewardEventId: eventId, previousClosedAt });
    const result = await completeReward(episodeId, session.sessionId, eventId);
    shouldContinue = result.shouldContinue;
    previousClosedAt = closedAt;
    if (!shouldContinue) rewardSessions.delete(episodeId);
    adIndex += 1;
  }
  return previousClosedAt;
}

import { ApiError, apiClient } from '../../lib/api-client';
import { isDemoMode } from '../../lib/storage';

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

async function completeReward(episodeId: string, sessionId: string, eventId: string) {
  const payload = { clientEventId: eventId, isEnded: true };
  try {
    return await apiClient.post<RewardComplete>(`/episodes/${episodeId}/reward-session/${sessionId}/complete`, payload);
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) throw error;
    return apiClient.post<RewardComplete>(`/episodes/${episodeId}/reward-session/${sessionId}/complete`, payload);
  }
}

async function recordAdEvent(input: { clientEventId: string; eventType: 'REQUESTED' | 'SHOWN' | 'CLOSED_INCOMPLETE' | 'FAILED'; placementId: string; episodeId: string; sessionId: string; adIndex: number; errorCode?: string }, required = false) {
  try {
    await apiClient.post('/ad-events', { adType: 'REWARDED', ...input, rewardSessionId: input.sessionId });
    return true;
  } catch (error) {
    if (required) throw error;
    return false;
  }
}

async function showOneRewardedAd(input: { adUnitId: string; episodeId: string; sessionId: string; adIndex: number; rewardEventId: string }) {
  const { adUnitId, episodeId, sessionId, adIndex, rewardEventId } = input;
  await recordAdEvent({ clientEventId: `${rewardEventId}:requested`, eventType: 'REQUESTED', placementId: adUnitId, episodeId, sessionId, adIndex });
  const ad = window.TTMinis!.createRewardedVideoAd({ adUnitId });
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => { ad.offClose(onClose); ad.offError(onError); };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onClose = ({ isEnded }: { isEnded: boolean }) => {
      if (!isEnded) {
        void recordAdEvent({ clientEventId: `${rewardEventId}:incomplete`, eventType: 'CLOSED_INCOMPLETE', placementId: adUnitId, episodeId, sessionId, adIndex });
        fail(new Error('AD_REWARD_NOT_EARNED'));
      }
      else void shownConfirmation.then(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      }, fail);
    };
    const onError = (error: unknown) => {
      const errorCode = error instanceof Error ? error.message : 'AD_SHOW_FAILED';
      void recordAdEvent({ clientEventId: `${rewardEventId}:failed`, eventType: 'FAILED', placementId: adUnitId, episodeId, sessionId, adIndex, errorCode });
      fail(error);
    };
    ad.onClose(onClose);
    ad.onError(onError);
    const shownConfirmation = ad.show().then(() => recordAdEvent({ clientEventId: rewardEventId, eventType: 'SHOWN', placementId: adUnitId, episodeId, sessionId, adIndex }, true));
    void shownConfirmation.catch(onError);
  });
}

export async function unlockEpisodeByRewardedAd(episodeId: string) {
  const session = await apiClient.post<RewardSession>(`/episodes/${episodeId}/reward-session`, {});
  if (session.access === 'PLAYABLE') return;
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
  if (!window.TTMinis?.canIUse('createRewardedVideoAd')) throw new Error('REWARDED_AD_UNAVAILABLE');

  let shouldContinue = true;
  let adIndex = 1;
  while (shouldContinue) {
    const eventId = clientEventId();
    await showOneRewardedAd({ adUnitId: session.placementId, episodeId, sessionId: session.sessionId, adIndex, rewardEventId: eventId });
    const result = await completeReward(episodeId, session.sessionId, eventId);
    shouldContinue = result.shouldContinue;
    adIndex += 1;
  }
}

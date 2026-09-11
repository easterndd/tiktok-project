import { apiClient } from '../../lib/api-client';
import { isDemoMode } from '../../lib/storage';

const placementId = import.meta.env.VITE_REWARDED_AD_UNIT_ID;
const clientEventId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `client-${Date.now()}`;

export async function unlockEpisodeByRewardedAd(episodeId: string) {
  if (isDemoMode()) {
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    await apiClient.post(`/episodes/${episodeId}/reward-unlock`, { placementId: placementId || 'mock-rewarded-placement', clientEventId: clientEventId(), isEnded: true }).catch(() => undefined);
    return;
  }
  if (!placementId || !window.TTMinis?.canIUse('createRewardedVideoAd')) throw new Error('Rewarded ads are unavailable on this TikTok version.');
  const ad = window.TTMinis.createRewardedVideoAd({ adUnitId: placementId });
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { ad.offClose(onClose); ad.offError(onError); };
    const onClose = async ({ isEnded }: { isEnded: boolean }) => {
      cleanup();
      if (!isEnded) return reject(new Error('Finish the ad to unlock this episode.'));
      try {
        await apiClient.post(`/episodes/${episodeId}/reward-unlock`, { placementId, clientEventId: clientEventId(), isEnded: true });
        resolve();
      } catch (error) { reject(error); }
    };
    const onError = (error: unknown) => { cleanup(); reject(error); };
    ad.onClose(onClose);
    ad.onError(onError);
    ad.show().catch(onError);
  });
}

import { apiClient } from '../../lib/api-client';

const placementId = import.meta.env.VITE_REWARDED_AD_UNIT_ID;

export async function unlockEpisodeByRewardedAd(episodeId: string) {
  if (!placementId || !window.TTMinis?.canIUse('createRewardedVideoAd')) throw new Error('Rewarded ads are unavailable on this TikTok version.');
  const ad = window.TTMinis.createRewardedVideoAd({ adUnitId: placementId });
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { ad.offClose(onClose); ad.offError(onError); };
    const onClose = async ({ isEnded }: { isEnded: boolean }) => {
      cleanup();
      if (!isEnded) return reject(new Error('Finish the ad to unlock this episode.'));
      try {
        await apiClient.post(`/episodes/${episodeId}/reward-unlock`, { placementId, clientEventId: crypto.randomUUID() });
        resolve();
      } catch (error) { reject(error); }
    };
    const onError = (error: unknown) => { cleanup(); reject(error); };
    ad.onClose(onClose);
    ad.onError(onError);
    ad.show().catch(onError);
  });
}

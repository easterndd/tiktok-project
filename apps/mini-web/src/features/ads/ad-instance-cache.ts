// TikTok creates the native ad object synchronously. Keep the next object
// ready while the current impression is being completed on the server.
const rewardedAds = new Map<string, { ad: RewardedVideoAd; host: NonNullable<Window['TTMinis']> }>();
const interstitialAds = new Map<string, { ad: InterstitialAd; host: NonNullable<Window['TTMinis']> }>();

function canUse(apiName: string) {
  try {
    return Boolean(window.TTMinis?.canIUse(apiName));
  } catch {
    return false;
  }
}

export function prewarmRewardedAd(adUnitId: string) {
  if (!adUnitId || !window.TTMinis || !canUse('createRewardedVideoAd')) return;
  const host = window.TTMinis;
  const existing = rewardedAds.get(adUnitId);
  if (existing?.host === host) return;
  if (existing) rewardedAds.delete(adUnitId);
  try {
    rewardedAds.set(adUnitId, { ad: host.createRewardedVideoAd({ adUnitId }), host });
  } catch {
    // The show path creates a fresh instance and reports the real SDK error.
  }
}

export function getRewardedAd(adUnitId: string) {
  prewarmRewardedAd(adUnitId);
  const prepared = rewardedAds.get(adUnitId);
  if (prepared && prepared.host === window.TTMinis) {
    rewardedAds.delete(adUnitId);
    return prepared.ad;
  }
  if (prepared) rewardedAds.delete(adUnitId);
  return window.TTMinis!.createRewardedVideoAd({ adUnitId });
}

export function releaseRewardedAd(adUnitId: string, ad: RewardedVideoAd) {
  if (rewardedAds.get(adUnitId)?.ad === ad) rewardedAds.delete(adUnitId);
}

export function prewarmInterstitialAd(adUnitId: string) {
  if (!adUnitId || !window.TTMinis || !canUse('createInterstitialAd')) return;
  const host = window.TTMinis;
  const existing = interstitialAds.get(adUnitId);
  if (existing?.host === host) return;
  if (existing) interstitialAds.delete(adUnitId);
  try {
    interstitialAds.set(adUnitId, { ad: host.createInterstitialAd({ adUnitId }), host });
  } catch {
    // The show path creates a fresh instance and reports the real SDK error.
  }
}

export function getInterstitialAd(adUnitId: string) {
  prewarmInterstitialAd(adUnitId);
  const prepared = interstitialAds.get(adUnitId);
  if (prepared && prepared.host === window.TTMinis) {
    interstitialAds.delete(adUnitId);
    return prepared.ad;
  }
  if (prepared) interstitialAds.delete(adUnitId);
  return window.TTMinis!.createInterstitialAd({ adUnitId });
}

export function releaseInterstitialAd(adUnitId: string, ad: InterstitialAd) {
  if (interstitialAds.get(adUnitId)?.ad === ad) interstitialAds.delete(adUnitId);
  try { ad.destroy?.(); } catch { /* SDK cleanup is best effort. */ }
}

type NativeAdKind = 'entry' | 'rewarded' | 'episode-interstitial';

let activeAd: NativeAdKind | null = null;
let lastRewardedEndedAt = 0;

export function claimNativeAd(kind: NativeAdKind): (() => void) | null {
  if (activeAd) return null;
  activeAd = kind;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (activeAd === kind) activeAd = null;
  };
}

export function nativeAdActive() { return activeAd !== null; }
export function rewardedEndedRecently(cooldownMs: number) { return Date.now() - lastRewardedEndedAt < cooldownMs; }
export function markRewardedAdClosed() { lastRewardedEndedAt = Date.now(); }

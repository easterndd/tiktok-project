type NativeAdKind = 'entry' | 'rewarded' | 'episode-interstitial';

import { getAdPlatform } from './ad-platform';

let activeAd: NativeAdKind | null = null;
let lastRewardedEndedAt = 0;
let nativeCooldownUntil = 0;
const idleListeners = new Set<() => void>();

export function claimNativeAd(kind: NativeAdKind): (() => void) | null {
  if (activeAd || Date.now() < nativeCooldownUntil) return null;
  activeAd = kind;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (activeAd === kind) {
      activeAd = null;
      const cooldownMs = getAdPlatform() === 'ios' ? 500 : 300;
      nativeCooldownUntil = Date.now() + cooldownMs;
      if (idleListeners.size) setTimeout(() => {
        if (!nativeAdActive()) for (const listener of idleListeners) listener();
      }, cooldownMs);
    }
  };
}

export function nativeAdActive() { return activeAd !== null || Date.now() < nativeCooldownUntil; }
export function subscribeNativeAdIdle(listener: () => void) {
  idleListeners.add(listener);
  return () => { idleListeners.delete(listener); };
}
export function rewardedEndedRecently(cooldownMs: number) { return Date.now() - lastRewardedEndedAt < cooldownMs; }
export function markRewardedAdClosed() { lastRewardedEndedAt = Date.now(); }

export function resetAdActivityForTests() {
  activeAd = null;
  lastRewardedEndedAt = 0;
  nativeCooldownUntil = 0;
  idleListeners.clear();
}

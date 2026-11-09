import assert from 'node:assert/strict';
import { after, it } from 'node:test';
import { getInterstitialAd, getRewardedAd, prewarmInterstitialAd, prewarmRewardedAd, releaseInterstitialAd, releaseRewardedAd, waitForAdReady } from '../src/features/ads/ad-instance-cache.ts';

const previousWindow = globalThis.window;
after(() => { globalThis.window = previousWindow; });

it('loads a single next rewarded instance and waits for its onLoad callback', async () => {
  const ads = [];
  globalThis.window = { TTMinis: {
    canIUse: () => true,
    createRewardedVideoAd: () => {
      const ad = {
        loaded: false,
        onLoad: (callback) => { ad.loadCallback = callback; },
        offLoad: () => { ad.loadCallback = undefined; },
        onError: (callback) => { ad.errorCallback = callback; },
        offError: () => { ad.errorCallback = undefined; },
        load: () => { ad.loadCalls = (ad.loadCalls ?? 0) + 1; setImmediate(() => { ad.loaded = true; ad.loadCallback?.(); }); },
        onClose: () => {}, offClose: () => {},
        show: async () => {}
      };
      ads.push(ad);
      return ad;
    }
  } };

  prewarmRewardedAd('load-test-placement');
  assert.equal(ads.length, 1);
  assert.equal(ads[0].loadCalls, 1);
  const first = getRewardedAd('load-test-placement');
  await waitForAdReady(first);
  assert.equal(first.loaded, true);
  assert.equal(ads.length, 2);
  assert.equal(ads[1].loadCalls, 1);
});

it('creates a fresh instance only when direct show is requested', async () => {
  const created = [];
  const create = () => {
    const ad = { loadCalls: 0, load() { ad.loadCalls += 1; }, destroy() { ad.destroyed = true; } };
    created.push(ad);
    return ad;
  };
  globalThis.window = { TTMinis: {
    canIUse: () => true,
    createRewardedVideoAd: create,
    createInterstitialAd: create
  } };
  prewarmRewardedAd('direct-reward', 1, 'DIRECT_SHOW');
  prewarmInterstitialAd('direct-interstitial', 1, 'DIRECT_SHOW');
  assert.equal(created.length, 0);
  const first = getRewardedAd('direct-reward', true, 'DIRECT_SHOW');
  const second = getRewardedAd('direct-reward', true, 'DIRECT_SHOW');
  const interstitial = getInterstitialAd('direct-interstitial', true, 'DIRECT_SHOW');
  await Promise.all([waitForAdReady(first), waitForAdReady(second), waitForAdReady(interstitial)]);
  assert.equal(created.length, 3);
  assert.notEqual(first, second);
  assert.deepEqual(created.map((ad) => ad.loadCalls), [0, 0, 0]);
  releaseRewardedAd('direct-reward', first);
  releaseRewardedAd('direct-reward', second);
  releaseInterstitialAd('direct-interstitial', interstitial);
  assert.ok(created.every((ad) => ad.destroyed));
});

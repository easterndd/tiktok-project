import assert from 'node:assert/strict';
import { after, it } from 'node:test';
import { getRewardedAd, prewarmRewardedAd, waitForAdReady } from '../src/features/ads/ad-instance-cache.ts';

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

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, it } from 'node:test';

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/features/ads/ad-instance-cache.ts') && specifier === './ad-platform') {
      return { url: 'data:text/javascript,export const getAdPlatform = () => globalThis.__cacheTestPlatform ?? "unknown"; export const isV006Release = () => globalThis.__cacheTestV006 ?? false;', shortCircuit: true };
    }
    return next(specifier, context);
  }
});
const { getInterstitialAd, getRewardedAd, prewarmInterstitialAd, prewarmInterstitialPlacements, prewarmRewardedAd, prewarmRewardedPlacements, releaseInterstitialAd, releaseRewardedAd, waitForAdReady } = await import('../src/features/ads/ad-instance-cache.ts');

const previousWindow = globalThis.window;
after(() => { hooks.deregister(); globalThis.window = previousWindow; delete globalThis.__cacheTestPlatform; delete globalThis.__cacheTestV006; });

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
  releaseRewardedAd('load-test-placement', first);
  releaseRewardedAd('load-test-placement', ads[1]);
});

it('prepares both Android placements concurrently and refills the consumed placement after close', async () => {
  globalThis.__cacheTestPlatform = 'android';
  globalThis.__cacheTestV006 = true;
  const created = [];
  const started = [];
  const pending = new Map();
  globalThis.window = { TTMinis: {
    canIUse: () => true,
    createRewardedVideoAd: ({ adUnitId }) => {
      const ad = {
        adUnitId,
        load: () => new Promise((resolve) => { started.push(adUnitId); pending.set(adUnitId, resolve); }),
        onLoad: () => {}, offLoad: () => {}, onError: () => {}, offError: () => {}, destroy: () => {}
      };
      created.push(ad);
      return ad;
    }
  } };
  try {
    prewarmRewardedPlacements(['pair-a', 'pair-b']);
    await new Promise(setImmediate);
    assert.deepEqual(started, ['pair-a', 'pair-b']);
    pending.get('pair-a')();
    pending.get('pair-b')();
    const shown = getRewardedAd('pair-a');
    await waitForAdReady(shown);
    assert.equal(created.length, 2);
    releaseRewardedAd('pair-a', shown);
    prewarmRewardedPlacements(['pair-a', 'pair-b']);
    await new Promise(setImmediate);
    assert.deepEqual(started, ['pair-a', 'pair-b', 'pair-a']);
    pending.get('pair-a')();
    const next = getRewardedAd('pair-a');
    const standby = getRewardedAd('pair-b');
    await Promise.all([waitForAdReady(next), waitForAdReady(standby)]);
    releaseRewardedAd('pair-a', next);
    releaseRewardedAd('pair-b', standby);
  } finally {
    delete globalThis.__cacheTestPlatform;
    delete globalThis.__cacheTestV006;
  }
});

it('prepares only primary rewarded and interstitial placements on iOS', () => {
  globalThis.__cacheTestPlatform = 'ios';
  globalThis.__cacheTestV006 = true;
  const rewardedIds = [];
  const interstitialIds = [];
  const create = (ids) => ({ adUnitId }) => {
    ids.push(adUnitId);
    return { destroy: () => {} };
  };
  globalThis.window = { TTMinis: {
    canIUse: () => true,
    createRewardedVideoAd: create(rewardedIds),
    createInterstitialAd: create(interstitialIds)
  } };
  try {
    prewarmRewardedPlacements(['ios-reward-a', 'ios-reward-b']);
    prewarmInterstitialPlacements(['ios-interstitial-a', 'ios-interstitial-b']);
    assert.deepEqual(rewardedIds, ['ios-reward-a']);
    assert.deepEqual(interstitialIds, ['ios-interstitial-a']);
    releaseRewardedAd('ios-reward-a', getRewardedAd('ios-reward-a', false));
    releaseInterstitialAd('ios-interstitial-a', getInterstitialAd('ios-interstitial-a', false));
  } finally {
    delete globalThis.__cacheTestPlatform;
    delete globalThis.__cacheTestV006;
  }
});

it('destroys stale pools across ad types when the SDK host changes', () => {
  globalThis.__cacheTestPlatform = 'android';
  globalThis.__cacheTestV006 = true;
  const oldAds = [];
  const newAds = [];
  const host = (target) => ({
    canIUse: () => true,
    createRewardedVideoAd: ({ adUnitId }) => {
      const ad = { adUnitId, destroy: () => { ad.destroyed = true; } };
      target.push(ad);
      return ad;
    },
    createInterstitialAd: ({ adUnitId }) => {
      const ad = { adUnitId, destroy: () => { ad.destroyed = true; } };
      target.push(ad);
      return ad;
    }
  });
  try {
    globalThis.window = { TTMinis: host(oldAds) };
    prewarmRewardedPlacements(['host-reward-a', 'host-reward-b']);
    prewarmInterstitialPlacements(['host-interstitial-a', 'host-interstitial-b']);
    assert.equal(oldAds.length, 4);
    globalThis.window = { TTMinis: host(newAds) };
    prewarmRewardedPlacements(['host-reward-a', 'host-reward-b']);
    assert.ok(oldAds.every((ad) => ad.destroyed));
    assert.deepEqual(newAds.map((ad) => ad.adUnitId), ['host-reward-a', 'host-reward-b']);
    for (const ad of newAds) releaseRewardedAd(ad.adUnitId, ad);
  } finally {
    delete globalThis.__cacheTestPlatform;
    delete globalThis.__cacheTestV006;
  }
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

it('serializes Android v0.0.6 loads for one ID while allowing a second ID', async () => {
  globalThis.__cacheTestPlatform = 'android';
  globalThis.__cacheTestV006 = true;
  const started = [];
  const pending = [];
  const create = ({ adUnitId }) => {
    const ad = {
      load: () => new Promise((resolve) => { started.push(adUnitId); pending.push(resolve); }),
      onLoad: () => {}, offLoad: () => {}, onError: () => {}, offError: () => {}, destroy: () => {}
    };
    return ad;
  };
  globalThis.window = { TTMinis: { canIUse: () => true, createRewardedVideoAd: create } };
  try {
    const first = getRewardedAd('gate-a', false);
    const second = getRewardedAd('gate-a', false);
    const other = getRewardedAd('gate-b', false);
    await new Promise(setImmediate);
    assert.deepEqual(started, ['gate-a', 'gate-b']);
    pending[0]();
    await waitForAdReady(first);
    await new Promise(setImmediate);
    assert.deepEqual(started, ['gate-a', 'gate-b', 'gate-a']);
    pending[1]();
    pending[2]();
    await Promise.all([waitForAdReady(second), waitForAdReady(other)]);
    releaseRewardedAd('gate-a', first);
    releaseRewardedAd('gate-a', second);
    releaseRewardedAd('gate-b', other);
  } finally {
    delete globalThis.__cacheTestPlatform;
    delete globalThis.__cacheTestV006;
  }
});

it('does not start a queued Android load after its instance was released', async () => {
  globalThis.__cacheTestPlatform = 'android';
  globalThis.__cacheTestV006 = true;
  const started = [];
  let completeFirst;
  const create = ({ adUnitId }) => ({
    load: () => { started.push(adUnitId); return new Promise((resolve) => { completeFirst ??= resolve; }); },
    onLoad: () => {}, offLoad: () => {}, onError: () => {}, offError: () => {}, destroy: () => {}
  });
  globalThis.window = { TTMinis: { canIUse: () => true, createRewardedVideoAd: create } };
  try {
    const first = getRewardedAd('released-gate', false);
    const queued = getRewardedAd('released-gate', false);
    await new Promise(setImmediate);
    releaseRewardedAd('released-gate', queued);
    completeFirst();
    await waitForAdReady(first);
    await new Promise(setImmediate);
    assert.deepEqual(started, ['released-gate']);
    releaseRewardedAd('released-gate', first);
  } finally {
    delete globalThis.__cacheTestPlatform;
    delete globalThis.__cacheTestV006;
  }
});

it('times out a hung load and advances the same-ID Android queue', async () => {
  globalThis.__cacheTestPlatform = 'android';
  globalThis.__cacheTestV006 = true;
  let calls = 0;
  let firstDestroyed = false;
  globalThis.window = { TTMinis: { canIUse: () => true, createRewardedVideoAd: () => {
    const index = ++calls;
    return {
      load: () => index === 1 ? new Promise(() => {}) : Promise.resolve(),
      onLoad: () => {}, offLoad: () => {}, onError: () => {}, offError: () => {},
      destroy: () => { if (index === 1) firstDestroyed = true; }
    };
  } } };
  try {
    prewarmRewardedAd('hung-placement');
    const first = getRewardedAd('hung-placement', false);
    const second = getRewardedAd('hung-placement', false);
    await assert.rejects(waitForAdReady(first, 9_000), /AD_LOAD_TIMEOUT/);
    await waitForAdReady(second);
    assert.equal(firstDestroyed, true);
    assert.equal(calls, 2);
    releaseRewardedAd('hung-placement', first);
    releaseRewardedAd('hung-placement', second);
  } finally {
    delete globalThis.__cacheTestPlatform;
    delete globalThis.__cacheTestV006;
  }
});

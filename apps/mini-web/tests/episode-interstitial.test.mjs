import assert from 'node:assert/strict';
import { it } from 'node:test';
import { registerHooks } from 'node:module';

const analyticsEvents = [];
globalThis.__interstitialAnalytics = analyticsEvents;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/features/ads/episode-interstitial.ts')) {
      if (specifier === '../../lib/diagnostics') return { url: 'data:text/javascript,export const reportDiagnostic = () => {}; export const reportPerformance = () => {};', shortCircuit: true };
      if (specifier === '../../lib/analytics') return { url: 'data:text/javascript,export const captureSdkCallback = (name, payload = null) => ({ name, payload, capturedAt: new Date().toISOString() }); export const nextAdSequence = () => 1; export const newAdOperationId = (kind, seq) => kind + "-" + seq + "-test"; export const recordAdClose = () => {}; export const recordAdLoad = () => {}; export const recordAdLoadResult = () => {}; export const recordAdShow = (input) => globalThis.__interstitialAnalytics.push(input);', shortCircuit: true };
    }
    if (context.parentURL?.includes('/features/ads/')) {
      if (specifier === '../../lib/client-trace') return { url: 'data:text/javascript,export const captureClientTrace = () => {};', shortCircuit: true };
      if (specifier === './ad-platform') return { url: 'data:text/javascript,export const getAdPlatform = () => "unknown"; export const getDefaultAdLoadMode = () => "EXPLICIT_LOAD"; export const isV006Release = () => false; export const isV006DualRelease = () => false; export const isMiniPageVisible = () => true; export const waitForMiniForeground = async () => true;', shortCircuit: true };
      if (specifier.startsWith('./') && !/\.(?:ts|tsx|js)$/.test(specifier)) return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  }
});
const { configureEpisodeInterstitial, showEpisodeTransitionInterstitial } = await import('../src/features/ads/episode-interstitial.ts');
const { claimNativeAd, markRewardedAdClosed } = await import('../src/features/ads/ad-activity.ts');
const originalNow = Date.now;
const originalWindow = globalThis.window;

it('skips missing placement, frequency and competing ads; closes or fails without blocking', async () => {
  let now = 1_000_000;
  Date.now = () => now;
  configureEpisodeInterstitial({ initialDelaySeconds: 0, intervalSeconds: 1, minIntervalSeconds: 0, maxPerSession: 2, initialSkipTransitions: 2, everyTransitions: 3, rewardedCooldownSeconds: 60, placementIds: ['episode-placement'] });
  const ads = [];
  let failNext = false;
  globalThis.window = { TTMinis: {
    canIUse: () => true,
    createInterstitialAd: () => {
      const ad = {
        show: () => failNext ? (failNext = false, Promise.reject(new Error('NO_FILL'))) : Promise.resolve(),
        onClose: (callback) => { ad.close = callback; },
        offClose: () => { ad.close = undefined; },
        onError: (callback) => { ad.error = callback; },
        offError: () => { ad.error = undefined; },
        destroy: () => { ad.destroyed = true; }
      };
      ads.push(ad);
      return ad;
    }
  } };
  try {
    await showEpisodeTransitionInterstitial(null);
    await showEpisodeTransitionInterstitial('episode-placement');
    await showEpisodeTransitionInterstitial('episode-placement');
    assert.equal(ads.length, 0);
    const releaseEntry = claimNativeAd('entry');
    await showEpisodeTransitionInterstitial('episode-placement');
    assert.equal(ads.length, 0);
    releaseEntry();
    now += 501;
    await showEpisodeTransitionInterstitial('episode-placement');
    await showEpisodeTransitionInterstitial('episode-placement');
    const first = showEpisodeTransitionInterstitial('episode-placement');
    assert.equal(ads.length, 2); // One active impression and one loaded next instance.
    await new Promise(setImmediate);
    ads[0].close();
    const firstClosedAt = await first;
    assert.ok(typeof firstClosedAt === 'number' && firstClosedAt >= performance.timeOrigin);
    assert.equal(ads[0].destroyed, true);
    assert.equal(ads.length, 2); // A fresh instance is prepared after a successful close.
    now += 181_000;
    await showEpisodeTransitionInterstitial('episode-placement');
    await showEpisodeTransitionInterstitial('episode-placement');
    failNext = true;
    await assert.rejects(showEpisodeTransitionInterstitial('episode-placement'), /NO_FILL/);
    assert.equal(analyticsEvents.find((event) => event.result === 'fail')?.errorOrigin, 'SDK_PROMISE');
    assert.equal(analyticsEvents.find((event) => event.result === 'fail')?.callback.name, 'show.reject');
    assert.equal(ads[1].destroyed, true);
    now += 181_000;
    await showEpisodeTransitionInterstitial('episode-placement');
    await showEpisodeTransitionInterstitial('episode-placement');
    const releaseRewarded = claimNativeAd('rewarded');
    markRewardedAdClosed();
    releaseRewarded();
    await showEpisodeTransitionInterstitial('episode-placement');
    assert.equal(ads.length, 3); // The failed impression leaves the preloaded next instance available.
    now += 61_000;
    await showEpisodeTransitionInterstitial('episode-placement');
    await showEpisodeTransitionInterstitial('episode-placement');
    const second = showEpisodeTransitionInterstitial('episode-placement');
    assert.equal(ads.length, 4); // The next impression consumes the prepared instance and preloads another.
    await new Promise(setImmediate);
    const activeSecond = ads.find((ad) => typeof ad.close === 'function');
    assert.ok(activeSecond, 'the second impression should bind a close handler');
    activeSecond.close();
    assert.ok(typeof await second === 'number');
    assert.equal(ads.length, 4); // The session limit prevents a third impression.
  } finally {
    Date.now = originalNow;
    globalThis.window = originalWindow;
    hooks.deregister();
    delete globalThis.__interstitialAnalytics;
  }
});

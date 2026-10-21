import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, it } from 'node:test';

// Exercise the real SDK lifecycle with controlled HTTP responses. Keep browser
// environment modules out of Node; the ad and acknowledgement code is unchanged.
let post;
const performanceReports = [];
globalThis.__entryAdTestPost = (...args) => post(...args);
globalThis.__entryAdTestPerformance = (...args) => performanceReports.push(args);
const mocks = {
  '../../lib/api-client': 'export class ApiError extends Error {} export const apiClient = { post: (...args) => globalThis.__entryAdTestPost(...args) };',
  '../../lib/storage': 'export const isDemoMode = () => false;',
  '../../lib/app-brand': 'export const storagePrefix = "test";',
  '../../lib/diagnostics': 'export const reportDiagnostic = () => {}; export const reportPerformance = (...args) => globalThis.__entryAdTestPerformance(...args);'
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/features/ads/app-entry-ad.ts')) {
      if (mocks[specifier]) return { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true };
      if (specifier.startsWith('./')) return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  }
});
const { showAppEntryAd, completeAppEntryAd } = await import('../src/features/ads/app-entry-ad.ts');
const previousWindow = globalThis.window;
after(() => { hooks.deregister(); globalThis.window = previousWindow; delete globalThis.__entryAdTestPost; delete globalThis.__entryAdTestPerformance; });

function setup() {
  const ads = [];
  const create = () => {
    const ad = {
      close: undefined, error: undefined, shows: 0,
      show: async () => { ad.shows++; },
      onClose: (callback) => { ad.close = callback; },
      offClose: () => { ad.close = undefined; },
      onError: (callback) => { ad.error = callback; },
      offError: () => { ad.error = undefined; }
    };
    ads.push(ad);
    return ad;
  };
  globalThis.window = { TTMinis: { canIUse: () => true, createRewardedVideoAd: create, createInterstitialAd: create } };
  return ads;
}
const input = { mode: 'REWARDED_GATED', placementId: 'placement', sessionId: 'session', adIndex: 1 };
const flush = () => new Promise(setImmediate);

it('shows without waiting for REQUESTED and waits for SHOWN before server completion', async () => {
  const ads = setup();
  let acknowledgeShown;
  const shownResponse = new Promise((resolve) => { acknowledgeShown = resolve; });
  const requests = [];
  post = (path, body) => {
    requests.push({ path, body });
    if (body.eventType === 'REQUESTED') return new Promise(() => {});
    if (body.eventType === 'SHOWN') return shownResponse;
    return Promise.resolve({ shouldContinue: false, completedCount: 1, requiredCount: 1 });
  };
  const playback = showAppEntryAd(input);
  await flush();
  assert.equal(ads[0].shows, 1);
  ads[0].close({ isEnded: true });
  const result = await playback;
  assert.equal(ads[0].close, undefined);
  const completion = completeAppEntryAd('session', result.clientEventId, result.isEnded);
  await flush();
  assert.equal(requests.filter(({ path }) => path.endsWith('/complete')).length, 0);
  acknowledgeShown();
  await completion;
  assert.equal(requests.filter(({ path }) => path.endsWith('/complete')).length, 1);
});

it('retries the same SHOWN ID and prewarms the next ad instance', async () => {
  performanceReports.length = 0;
  const ads = setup();
  const shownIds = [];
  const completed = [];
  post = async (path, body) => {
    if (body.eventType === 'SHOWN') {
      shownIds.push(body.clientEventId);
      if (shownIds.length === 1) throw new Error('network');
    }
    if (path.endsWith('/complete')) completed.push(body);
    return { shouldContinue: true, completedCount: completed.length, requiredCount: 2 };
  };
  const first = showAppEntryAd(input);
  await flush();
  ads[0].close({ isEnded: true });
  const result = await first;
  await completeAppEntryAd('session', result.clientEventId, true);
  assert.deepEqual(shownIds, [result.clientEventId, result.clientEventId]);
  assert.equal(ads.length, 2);
  assert.equal(ads[0].shows, 1);
  const second = showAppEntryAd({ ...input, adIndex: 2 });
  await flush();
  assert.equal(ads.length, 2);
  assert.ok(performanceReports.some(([phase]) => phase === 'ENTRY_AD_CLOSE_TO_NEXT_AD_SHOW_ACCEPTED'));
  ads[1].close({ isEnded: false });
  const earlyClose = await second;
  assert.equal(earlyClose.isEnded, false);
  await completeAppEntryAd('session', earlyClose.clientEventId, false);
  assert.equal(completed[1].isEnded, false);
});

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, it } from 'node:test';

let post;
const performanceReports = [];
globalThis.__rewardedAdTestPost = (...args) => post(...args);
globalThis.__rewardedAdTestPerformance = (...args) => performanceReports.push(args);
const mocks = {
  '../../lib/api-client': 'export class ApiError extends Error {} export const apiClient = { post: (...args) => globalThis.__rewardedAdTestPost(...args) };',
  '../../lib/storage': 'export const isDemoMode = () => false;',
  '../../lib/diagnostics': 'export const reportDiagnostic = () => {}; export const reportPerformance = (...args) => globalThis.__rewardedAdTestPerformance(...args);',
  './ad-timeout': 'export const adTimeout = (onError) => ({ shown: () => {}, clear: () => {} }); export const adErrorMessage = (error) => String(error);'
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/features/ads/rewarded-ad.ts')) {
      if (mocks[specifier]) return { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true };
      if (specifier.startsWith('./')) return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  }
});
const { prepareRewardedUnlockSession, unlockEpisodeByRewardedAd } = await import('../src/features/ads/rewarded-ad.ts');
const previousWindow = globalThis.window;
after(() => { hooks.deregister(); globalThis.window = previousWindow; delete globalThis.__rewardedAdTestPost; delete globalThis.__rewardedAdTestPerformance; });

it('shows the episode ad without waiting for REQUESTED and confirms SHOWN before unlocking', async () => {
  performanceReports.length = 0;
  let close;
  const requests = [];
  const ad = {
    shows: 0,
    show: async () => { ad.shows += 1; },
    onClose: (callback) => { close = callback; }, offClose: () => { close = undefined; },
    onError: () => {}, offError: () => {}
  };
  globalThis.window = { TTMinis: { canIUse: () => true, createRewardedVideoAd: () => ad } };
  post = (path, body) => {
    requests.push({ path, body });
    if (path.endsWith('/reward-session')) return Promise.resolve({ access: 'REWARDED_AD_REQUIRED', sessionId: 'session-1', placementId: 'placement-1' });
    if (body.eventType === 'REQUESTED') return new Promise(() => {});
    if (body.eventType === 'SHOWN') return Promise.resolve({ accepted: true });
    if (path.endsWith('/complete')) return Promise.resolve({ access: 'PLAYABLE', shouldContinue: false });
    return Promise.resolve({ accepted: true });
  };

  const unlock = unlockEpisodeByRewardedAd('episode-1');
  await new Promise(setImmediate);
  assert.equal(ad.shows, 1);
  assert.equal(requests.some(({ body }) => body.eventType === 'REQUESTED'), true);
  close({ isEnded: true });
  await unlock;
  assert.equal(requests.some(({ body }) => body.eventType === 'SHOWN'), true);
  assert.equal(requests.some(({ path }) => path.endsWith('/complete')), true);
  assert.ok(performanceReports.some(([phase]) => phase === 'REWARDED_SHOWN_ACK_RESPONSE'));
  assert.ok(performanceReports.some(([phase]) => phase === 'REWARDED_COMPLETE_RESPONSE'));
});

it('reuses a prepared reward session and prewarmed ad instance on click', async () => {
  performanceReports.length = 0;
  let close;
  const requests = [];
  const ads = [];
  const makeAd = () => {
    const ad = {
      shows: 0,
      show: async () => { ad.shows += 1; },
      onClose: (callback) => { close = callback; }, offClose: () => { close = undefined; },
      onError: () => {}, offError: () => {}, destroy: () => {}
    };
    ads.push(ad);
    return ad;
  };
  globalThis.window = { TTMinis: { canIUse: () => true, createRewardedVideoAd: makeAd } };
  post = (path, body) => {
    requests.push({ path, body });
    if (path.endsWith('/reward-session')) return Promise.resolve({ access: 'REWARDED_AD_REQUIRED', sessionId: 'session-2', placementId: 'placement-2' });
    if (body.eventType === 'SHOWN') return Promise.resolve({ accepted: true });
    if (path.endsWith('/complete')) return Promise.resolve({ access: 'PLAYABLE', shouldContinue: false });
    return Promise.resolve({ accepted: true });
  };

  await prepareRewardedUnlockSession('episode-2');
  assert.equal(requests.filter(({ path }) => path.endsWith('/reward-session')).length, 1);
  assert.equal(ads.length, 1);
  const unlock = unlockEpisodeByRewardedAd('episode-2');
  await new Promise(setImmediate);
  assert.equal(requests.filter(({ path }) => path.endsWith('/reward-session')).length, 1);
  assert.equal(ads.length, 1);
  assert.equal(ads[0].shows, 1);
  close({ isEnded: true });
  await unlock;
});

it('measures rewarded close through SDK acceptance of the next ad', async () => {
  performanceReports.length = 0;
  const closeCallbacks = [];
  const requests = [];
  let shows = 0;
  let completions = 0;
  globalThis.window = { TTMinis: { canIUse: () => true, createRewardedVideoAd: () => ({
    show: async () => { shows += 1; },
    onClose: (callback) => { closeCallbacks.push(callback); }, offClose: () => {},
    onError: () => {}, offError: () => {}, destroy: () => {}
  }) } };
  post = (path, body) => {
    requests.push({ path, body });
    if (path.endsWith('/reward-session')) return Promise.resolve({ access: 'REWARDED_AD_REQUIRED', sessionId: 'session-3', placementId: 'placement-3' });
    if (body.eventType === 'SHOWN') return Promise.resolve({ accepted: true });
    if (path.endsWith('/complete')) return Promise.resolve({ access: 'REWARDED_AD_REQUIRED', shouldContinue: ++completions === 1 });
    return Promise.resolve({ accepted: true });
  };

  const unlock = unlockEpisodeByRewardedAd('episode-3');
  await new Promise(setImmediate);
  assert.equal(shows, 1);
  closeCallbacks[0]({ isEnded: true });
  await new Promise(setImmediate);
  assert.equal(shows, 2);
  closeCallbacks[1]({ isEnded: true });
  await unlock;
  assert.equal(requests.filter(({ path }) => path.endsWith('/complete')).length, 2);
  assert.ok(performanceReports.some(([phase]) => phase === 'REWARDED_CLOSE_TO_NEXT_AD_SHOW_ACCEPTED'));
});

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, it } from 'node:test';

let post;
const performanceReports = [];
const analyticsEvents = [];
globalThis.__rewardedAdTestPost = (...args) => post(...args);
globalThis.__rewardedAdTestPerformance = (...args) => performanceReports.push(args);
globalThis.__rewardedAdTestAnalytics = analyticsEvents;
const mocks = {
  '../../lib/api-client': 'export class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } } globalThis.__rewardedAdApiError = ApiError; export const apiClient = { post: (...args) => globalThis.__rewardedAdTestPost(...args) };',
  '../../lib/storage': 'export const isDemoMode = () => false;',
  '../../lib/diagnostics': 'export const reportDiagnostic = () => {}; export const reportPerformance = (...args) => globalThis.__rewardedAdTestPerformance(...args);',
  '../../lib/client-trace': 'export const captureClientTrace = () => {};',
  '../../lib/analytics': 'export const captureSdkCallback = (name, payload = null) => ({ name, payload, capturedAt: new Date().toISOString() }); export const nextAdSequence = () => 1; export const newAdOperationId = (kind, seq) => kind + "-" + seq + "-test"; export const recordAdClose = (input) => globalThis.__rewardedAdTestAnalytics.push({ kind: "close", input }); export const recordAdLoad = (input) => globalThis.__rewardedAdTestAnalytics.push({ kind: "load", input }); export const recordAdLoadResult = (input) => globalThis.__rewardedAdTestAnalytics.push({ kind: "load", input }); export const recordAdShow = (input) => globalThis.__rewardedAdTestAnalytics.push({ kind: "show", input });',
  './ad-timeout': 'export const adTimeout = (onError) => ({ shown: () => {}, clear: () => {} }); export const adErrorMessage = (error) => String(error);',
  './ad-platform': 'export const getAdPlatform = () => globalThis.__rewardedAdTestPlatform ?? "unknown"; export const getDefaultAdLoadMode = () => "EXPLICIT_LOAD"; export const getMiniReleaseId = () => globalThis.__rewardedAdTestRelease ?? "default"; export const isV006Release = (release = getMiniReleaseId()) => release.includes("-v006-"); export const isV006DualRelease = () => false; export const isMiniPageVisible = () => true; export const waitForMiniForeground = async () => true;',
  './ad-placement-manifest': 'export const restrictToPublicManifest = (_type, ids) => [...ids];',
  './ad-error-policy': 'export const classifyAdFailure = () => globalThis.__rewardedAdTestClassify ?? "STOP"; export const normalizeErrorOrigin = () => "UNKNOWN"; export const taggedAdFailure = (message, origin) => Object.assign(new Error(message), { adErrorOrigin: origin });',
  './ad-activity': 'export const claimNativeAd = () => () => {}; export const markRewardedAdClosed = () => {};'
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.includes('/features/ads/')) {
      if (mocks[specifier]) return { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true };
      if (specifier.startsWith('./') && !/\.(?:ts|tsx|js)$/.test(specifier)) return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  }
});
const { prepareRewardedUnlockSession, unlockEpisodeByRewardedAd } = await import('../src/features/ads/rewarded-ad.ts');
const previousWindow = globalThis.window;
after(() => { hooks.deregister(); globalThis.window = previousWindow; delete globalThis.__rewardedAdTestPost; delete globalThis.__rewardedAdTestPerformance; delete globalThis.__rewardedAdTestAnalytics; delete globalThis.__rewardedAdApiError; delete globalThis.__rewardedAdTestPlatform; delete globalThis.__rewardedAdTestRelease; delete globalThis.__rewardedAdTestClassify; });

it('shows the episode ad without sending REQUESTED and confirms SHOWN before unlocking', async () => {
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
    if (body.eventType === 'SHOWN') return Promise.resolve({ accepted: true });
    if (path.endsWith('/complete')) return Promise.resolve({ access: 'PLAYABLE', shouldContinue: false });
    return Promise.resolve({ accepted: true });
  };

  const unlock = unlockEpisodeByRewardedAd('episode-1');
  await new Promise(setImmediate);
  assert.equal(ad.shows, 1);
  assert.equal(requests.some(({ body }) => body.eventType === 'REQUESTED'), false);
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
  assert.equal(ads.length, 2);
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

it('records a rejected SDK show Promise as SDK_PROMISE', async () => {
  analyticsEvents.length = 0;
  const requests = [];
  globalThis.window = { TTMinis: { canIUse: () => true, createRewardedVideoAd: () => ({
    show: () => Promise.reject(new Error('NO_FILL')),
    onClose: () => {}, offClose: () => {}, onError: () => {}, offError: () => {}, destroy: () => {}
  }) } };
  post = async (path, body) => {
    requests.push({ path, body });
    if (path.endsWith('/reward-session')) return { access: 'REWARDED_AD_REQUIRED', sessionId: 'session-sdk-reject', placementId: 'placement-sdk-reject' };
    return { accepted: true };
  };
  await assert.rejects(unlockEpisodeByRewardedAd('episode-sdk-reject'), /NO_FILL/);
  const failedShow = analyticsEvents.find(({ kind, input }) => kind === 'show' && input.result === 'fail');
  assert.equal(failedShow?.input.errorOrigin, 'SDK_PROMISE');
  assert.equal(failedShow?.input.callback.name, 'show.reject');
  assert.equal(requests.some(({ body }) => body.eventType === 'SHOWN'), false);
});

it('does not turn a rejected SHOWN acknowledgement into an SDK show failure', async () => {
  analyticsEvents.length = 0;
  let shows = 0;
  globalThis.window = { TTMinis: { canIUse: () => true, createRewardedVideoAd: () => ({
    show: async () => { shows += 1; },
    onClose: () => {}, offClose: () => {}, onError: () => {}, offError: () => {}, destroy: () => {}
  }) } };
  post = async (path, body) => {
    if (path.endsWith('/reward-session')) return { access: 'REWARDED_AD_REQUIRED', sessionId: 'session-ack-reject', placementId: 'placement-ack-reject' };
    if (body.eventType === 'SHOWN') throw new globalThis.__rewardedAdApiError('ACK_REJECTED', 400);
    return { accepted: true };
  };
  await assert.rejects(unlockEpisodeByRewardedAd('episode-ack-reject'), /ACK_REJECTED/);
  assert.equal(shows, 1);
  assert.deepEqual(analyticsEvents.filter(({ kind }) => kind === 'show').map(({ input }) => input.result), ['success']);
});

it('rotates completed Android rewards across authorized placements', async () => {
  globalThis.__rewardedAdTestPlatform = 'android';
  globalThis.__rewardedAdTestRelease = 'heartreel-v006-test';
  const ads = [];
  const shown = [];
  const placements = ['primary-reward', 'backup-reward'];
  globalThis.window = { TTMinis: { canIUse: () => true, createRewardedVideoAd: ({ adUnitId }) => {
    const ad = {
      unit: adUnitId,
      show: async () => { shown.push(adUnitId); },
      onClose: (callback) => { ad.close = callback; }, offClose: () => { ad.close = undefined; },
      onError: () => {}, offError: () => {}, destroy: () => {}
    };
    ads.push(ad);
    return ad;
  } } };
  let completions = 0;
  post = async (path) => {
    if (path.endsWith('/reward-session')) return { access: 'REWARDED_AD_REQUIRED', sessionId: 'rotation-session', placementId: placements[0], placementIds: placements, requiredCount: 3 };
    if (path.endsWith('/complete')) return { access: 'REWARDED_AD_REQUIRED', shouldContinue: ++completions < 3, completedCount: completions, requiredCount: 3 };
    return { accepted: true };
  };
  try {
    const running = unlockEpisodeByRewardedAd('episode-rotation');
    for (let index = 1; index <= 3; index++) {
      for (let tick = 0; tick < 20 && shown.length < index; tick++) await new Promise(setImmediate);
      assert.equal(shown.length, index);
      ads.find((ad) => ad.unit === shown[index - 1] && typeof ad.close === 'function')?.close({ isEnded: true });
      await new Promise(setImmediate);
    }
    await running;
    assert.deepEqual(shown, ['primary-reward', 'backup-reward', 'primary-reward']);
    assert.equal(completions, 3);
  } finally {
    delete globalThis.__rewardedAdTestPlatform;
    delete globalThis.__rewardedAdTestRelease;
  }
});

it('never tries a backup reward placement on iOS after SDK no-fill', async () => {
  globalThis.__rewardedAdTestPlatform = 'ios';
  globalThis.__rewardedAdTestRelease = 'heartreel-v006-test';
  globalThis.__rewardedAdTestClassify = 'TRY_BACKUP_ONCE';
  const created = [];
  globalThis.window = { TTMinis: { canIUse: () => true, createRewardedVideoAd: ({ adUnitId }) => {
    created.push(adUnitId);
    return {
      show: () => Promise.reject(new Error('NO_FILL')),
      onClose: () => {}, offClose: () => {}, onError: () => {}, offError: () => {}, destroy: () => {}
    };
  } } };
  post = async (path) => path.endsWith('/reward-session')
    ? { access: 'REWARDED_AD_REQUIRED', sessionId: 'ios-single-session', placementId: 'primary-reward', placementIds: ['primary-reward', 'backup-reward'], requiredCount: 2 }
    : { accepted: true };
  try {
    await assert.rejects(unlockEpisodeByRewardedAd('episode-ios-single'), /NO_FILL/);
    assert.ok(created.length > 0);
    assert.ok(created.every((id) => id === 'primary-reward'));
  } finally {
    delete globalThis.__rewardedAdTestPlatform;
    delete globalThis.__rewardedAdTestRelease;
    delete globalThis.__rewardedAdTestClassify;
  }
});

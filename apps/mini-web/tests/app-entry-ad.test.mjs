import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, it } from 'node:test';

// Exercise the real SDK lifecycle with controlled HTTP responses. Keep browser
// environment modules out of Node; the ad and acknowledgement code is unchanged.
let post;
const performanceReports = [];
globalThis.__entryAdTestPost = (...args) => post(...args);
globalThis.__entryAdTestPerformance = (...args) => performanceReports.push(args);
const analyticsEvents = [];
globalThis.__entryAdTestAnalytics = analyticsEvents;
const traceModes = [];
globalThis.__entryAdTestTraceModes = traceModes;
const mocks = {
  '../../lib/api-client': 'export class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } } globalThis.__entryAdApiError = ApiError; export const apiClient = { post: (...args) => globalThis.__entryAdTestPost(...args) };',
  '../../lib/storage': 'export const isDemoMode = () => false;',
  '../../lib/app-brand': 'export const storagePrefix = "test";',
  '../../lib/launch-context': 'export const getMiniLaunchAdId = () => null; export const getMiniLaunchIds = () => ({ launchId: "00000000-0000-4000-8000-000000000001", entryId: "entry-test" }); export const getMiniLaunchRef = () => undefined;',
  '../../lib/diagnostics': 'export const reportDiagnostic = () => {}; export const reportPerformance = (...args) => globalThis.__entryAdTestPerformance(...args);',
  '../../lib/client-trace': 'export const captureClientTrace = () => {}; export const setClientTraceLocalOnly = (value) => globalThis.__entryAdTestTraceModes.push(value);',
  '../../lib/analytics': 'export const captureSdkCallback = (name, payload = null) => ({ name, payload, capturedAt: new Date().toISOString() }); export const nextAdSequence = () => 1; export const newAdOperationId = (kind, seq) => kind + "-" + seq + "-test"; export const recordAdClose = (input) => globalThis.__entryAdTestAnalytics.push({ kind: "close", input }); export const recordAdConfig = (input) => globalThis.__entryAdTestAnalytics.push({ kind: "config", input }); export const recordAdLoad = (input) => globalThis.__entryAdTestAnalytics.push({ kind: "load", input }); export const recordAdLoadResult = (input) => globalThis.__entryAdTestAnalytics.push({ kind: "load", input }); export const recordAdShow = (input) => globalThis.__entryAdTestAnalytics.push({ kind: "show", input }); export const recordEntryAdDecision = (input) => globalThis.__entryAdTestAnalytics.push({ kind: "entryDecision", input });',
  './ad-platform': 'export const getAdPlatform = () => globalThis.__entryAdTestPlatform ?? "unknown"; export const getDefaultAdLoadMode = () => "EXPLICIT_LOAD"; export const getMiniReleaseId = () => globalThis.__entryAdTestRelease ?? "default"; export const isV006Release = (release = getMiniReleaseId()) => release.includes("-v006-"); export const isV006DualRelease = (release = getMiniReleaseId()) => release.includes("-v006-dual-"); export const isLaunchAttributionRelease = (release = getMiniReleaseId()) => isV006DualRelease(release) || release.includes("-attr1-"); export const isMiniPageVisible = () => true; export const waitForMiniForeground = async () => true;',
  './ad-placement-manifest': 'export const restrictToPublicManifest = (_type, ids) => [...ids];',
  './ad-error-policy': 'export const classifyAdFailure = (error, origin) => globalThis.__entryAdTestClassify?.(error, origin) ?? "STOP"; export const normalizeErrorOrigin = (error) => error?.adErrorOrigin ?? "UNKNOWN"; export const taggedAdFailure = (message, origin) => Object.assign(new Error(message), { adErrorOrigin: origin });',
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
const { showAppEntryAd, completeAppEntryAd, startAppEntryAdSession } = await import('../src/features/ads/app-entry-ad.ts');
const { primeEntryRewardedPool } = await import('../src/features/ads/ad-instance-cache.ts');
const previousWindow = globalThis.window;
const previousSessionStorage = globalThis.sessionStorage;
after(() => { hooks.deregister(); globalThis.window = previousWindow; globalThis.sessionStorage = previousSessionStorage; delete globalThis.__entryAdTestPost; delete globalThis.__entryAdTestPerformance; delete globalThis.__entryAdTestAnalytics; delete globalThis.__entryAdTestTraceModes; delete globalThis.__entryAdApiError; delete globalThis.__entryAdTestClassify; delete globalThis.__entryAdTestPlatform; delete globalThis.__entryAdTestRelease; });

function setup() {
  analyticsEvents.length = 0;
  const ads = [];
  const create = ({ adUnitId } = {}) => {
    const ad = {
      unit: adUnitId,
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
  globalThis.window = { setTimeout, TTMinis: { canIUse: () => true, createRewardedVideoAd: create, createInterstitialAd: create } };
  return ads;
}

const input = { mode: 'REWARDED_GATED', placementId: 'placement', sessionId: 'session', adIndex: 1 };
const flush = () => new Promise(setImmediate);

it('sends the launch reference for attribution-only releases without enabling the dual entry flow', async () => {
  globalThis.__entryAdTestRelease = 'storyworld-attr1-test';
  setup();
  const requests = [];
  post = async (path, body) => {
    requests.push({ path, body });
    return { required: false, launchRef: body.launchRef, decision: 'SUPPRESS', decisionReason: 'UNATTRIBUTED' };
  };
  try {
    await startAppEntryAdSession('11111111-1111-4111-8111-111111111111');
    const request = requests.find(({ path }) => path === '/app-entry-ad-sessions');
    assert.equal(request.body.launchId, '00000000-0000-4000-8000-000000000001');
    assert.equal(request.body.launchRef, '11111111-1111-4111-8111-111111111111');
    assert.equal(request.body.launchAttributionVersion, 1);
    assert.equal('adId' in request.body, false);
    assert.equal('entryFlowVersion' in request.body, false);
    assert.equal(analyticsEvents.find(({ kind }) => kind === 'entryDecision')?.input.reason, 'UNATTRIBUTED');
  } finally {
    delete globalThis.__entryAdTestRelease;
  }
});

it('primes both Android entry placements in parallel and hands off before close telemetry', async () => {
  globalThis.__entryAdTestPlatform = 'android';
  globalThis.__entryAdTestRelease = 'heartreel-v006-dual-test';
  const ads = setup();
  post = async () => ({ accepted: true });
  try {
    primeEntryRewardedPool(['primary-dual', 'backup-dual']);
    assert.deepEqual(ads.slice(0, 2).map((ad) => ad.unit), ['primary-dual', 'backup-dual']);
    await flush();
    const first = showAppEntryAd({ ...input, sessionId: 'dual-handoff', placementId: 'primary-dual', placementIds: ['primary-dual', 'backup-dual'], requiredCount: 2, fastHandoff: true });
    await flush();
    const firstAd = ads.find((ad) => ad.unit === 'primary-dual' && ad.shows === 1);
    assert.ok(firstAd);
    firstAd.close({ isEnded: true });
    await first;
    const second = showAppEntryAd({ ...input, sessionId: 'dual-handoff', placementId: 'primary-dual', placementIds: ['primary-dual', 'backup-dual'], requiredCount: 2, adIndex: 2, fastHandoff: true });
    for (let tick = 0; tick < 10 && !ads.some((ad) => ad.unit === 'backup-dual' && ad.shows === 1); tick++) await Promise.resolve();
    const secondAd = ads.find((ad) => ad.unit === 'backup-dual' && ad.shows === 1);
    assert.ok(secondAd);
    assert.equal(analyticsEvents.some(({ kind }) => kind === 'close'), false);
    secondAd.close({ isEnded: true });
    await second;
  } finally {
    delete globalThis.__entryAdTestPlatform;
    delete globalThis.__entryAdTestRelease;
  }
});

it('retries a busy Android show with the same prepared instance', async () => {
  globalThis.__entryAdTestPlatform = 'android';
  globalThis.__entryAdTestRelease = 'heartreel-v006-dual-test';
  const ads = setup();
  post = async () => ({ accepted: true });
  try {
    primeEntryRewardedPool(['primary-busy', 'backup-busy']);
    await flush();
    const primary = ads[0];
    let busy = true;
    primary.show = async () => {
      primary.shows++;
      if (busy) { busy = false; throw new Error('104111006: ad busy'); }
    };
    const showInput = { ...input, sessionId: 'busy-handoff', placementId: 'primary-busy', placementIds: ['primary-busy', 'backup-busy'], fastHandoff: true };
    await assert.rejects(showAppEntryAd(showInput), /104111006/);
    const retry = showAppEntryAd(showInput);
    await flush();
    assert.equal(primary.shows, 2);
    primary.close({ isEnded: true });
    await retry;
  } finally {
    delete globalThis.__entryAdTestPlatform;
    delete globalThis.__entryAdTestRelease;
  }
});

it('does not send REQUESTED and overlaps SHOWN with completion', async () => {
  const ads = setup();
  let acknowledgeShown;
  const shownResponse = new Promise((resolve) => { acknowledgeShown = resolve; });
  const requests = [];
  let completionAttempts = 0;
  post = (path, body) => {
    requests.push({ path, body });
    if (body.eventType === 'SHOWN') return shownResponse;
    if (path.endsWith('/complete') && ++completionAttempts === 1) {
      throw new globalThis.__entryAdApiError('impression acknowledgement pending', 425);
    }
    return Promise.resolve({ shouldContinue: false, completedCount: 1, requiredCount: 1 });
  };
  const playback = showAppEntryAd(input);
  await flush();
  assert.equal(ads[0].shows, 1);
  assert.equal(requests.some(({ body }) => body.eventType === 'REQUESTED'), false);
  ads[0].close({ isEnded: true });
  const result = await playback;
  const loadEvent = analyticsEvents.find(({ kind }) => kind === 'load');
  assert.equal(loadEvent.input.callback.name, 'load.unsupported');
  const closeEvent = analyticsEvents.find(({ kind }) => kind === 'close');
  assert.equal(closeEvent.input.callback.name, 'onClose');
  assert.deepEqual(closeEvent.input.callback.payload, { isEnded: true });
  const showEvent = analyticsEvents.find(({ kind }) => kind === 'show');
  assert.equal(showEvent.input.callback.name, 'show.resolve');
  assert.equal(showEvent.input.callback.payload, null);
  assert.equal(ads[0].close, undefined);
  const completion = completeAppEntryAd('session', result.clientEventId, result.isEnded);
  await flush();
  assert.equal(requests.filter(({ path }) => path.endsWith('/complete')).length, 1);
  acknowledgeShown();
  await completion;
  assert.equal(requests.filter(({ path }) => path.endsWith('/complete')).length, 2);
});

it('uses alternate authorized placements for Android entry ads and only the primary on iOS', async () => {
  globalThis.__entryAdTestRelease = 'heartreel-v006-test';
  const ads = setup();
  const shown = [];
  post = async () => ({ accepted: true });
  try {
    globalThis.__entryAdTestPlatform = 'android';
    for (let index = 1; index <= 2; index++) {
      const playback = showAppEntryAd({ ...input, sessionId: 'entry-rotation', placementId: 'primary-test', placementIds: ['primary-test', 'backup-test'], adIndex: index });
      await flush();
      const active = ads.find((ad) => ad.shows === 1 && typeof ad.close === 'function');
      assert.ok(active);
      shown.push(active.unit);
      active.close({ isEnded: true });
      await playback;
    }
    assert.deepEqual(shown, ['primary-test', 'backup-test']);
    globalThis.__entryAdTestPlatform = 'ios';
    const iosPlayback = showAppEntryAd({ ...input, sessionId: 'entry-ios', placementId: 'primary-test', placementIds: ['primary-test', 'backup-test'], adIndex: 2 });
    await flush();
    const iosActive = ads.find((ad) => ad.shows === 1 && typeof ad.close === 'function');
    assert.equal(iosActive?.unit, 'primary-test');
    iosActive.close({ isEnded: true });
    await iosPlayback;
  } finally {
    delete globalThis.__entryAdTestPlatform;
    delete globalThis.__entryAdTestRelease;
  }
});

it('retries the same SHOWN ID and prewarms the next ad instance', async () => {
  performanceReports.length = 0;
  const ads = setup();
  const shownIds = [];
  const completed = [];
  let shownPersisted = false;
  post = async (path, body) => {
    if (body.eventType === 'SHOWN') {
      shownIds.push(body.clientEventId);
      if (shownIds.length === 1) throw new Error('network');
      shownPersisted = true;
    }
    if (path.endsWith('/complete')) {
      if (!shownPersisted) {
        throw new globalThis.__entryAdApiError('impression acknowledgement pending', 425);
      }
      completed.push(body);
    }
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
  assert.equal(ads.length, 3);
  assert.ok(performanceReports.some(([phase]) => phase === 'ENTRY_AD_CLOSE_TO_NEXT_AD_SHOW_ACCEPTED'));
  ads[1].close({ isEnded: false });
  const earlyClose = await second;
  assert.equal(earlyClose.isEnded, false);
  await completeAppEntryAd('session', earlyClose.clientEventId, false);
  assert.equal(completed[1].isEnded, false);
});

it('skips diagnostic close requests when the server counts SHOWN impressions', async () => {
  const ads = setup();
  const requests = [];
  post = async (path, body) => {
    requests.push({ path, body });
    return { accepted: true };
  };

  const playback = showAppEntryAd({ ...input, countMode: 'SHOWN', requiredCount: 2 });
  await flush();
  ads[0].close({ isEnded: false });
  const result = await playback;
  await flush();

  assert.equal(result.isEnded, false);
  assert.equal(requests.some(({ body }) => body.eventType === 'CLOSED_INCOMPLETE'), false);
});

it('separates rejected SDK show from a failed display acknowledgement', async () => {
  setup();
  post = async () => ({ accepted: true });
  const create = globalThis.window.TTMinis.createRewardedVideoAd;
  globalThis.window.TTMinis.createRewardedVideoAd = () => {
    const ad = create();
    ad.show = () => Promise.reject(new Error('NO_FILL'));
    return ad;
  };
  await assert.rejects(showAppEntryAd({ ...input, sessionId: 'entry-sdk-reject' }), /NO_FILL/);
  const sdkFailure = analyticsEvents.find(({ kind, input }) => kind === 'show' && input.result === 'fail');
  assert.equal(sdkFailure?.input.errorOrigin, 'SDK_PROMISE');
  assert.equal(sdkFailure?.input.callback.name, 'show.reject');

  setup();
  post = async () => ({ accepted: true });
  await assert.rejects(showAppEntryAd({
    ...input, sessionId: 'entry-ack-reject', countMode: 'SHOWN',
    onShown: () => { throw new globalThis.__entryAdApiError('ACK_REJECTED', 400); }
  }), /ACK_REJECTED/);
  assert.deepEqual(analyticsEvents.filter(({ kind }) => kind === 'show').map(({ input }) => input.result), ['success']);
});

it('uses the authorized backup once after a no-fill SDK rejection', async () => {
  globalThis.__entryAdTestPlatform = 'android';
  const ads = setup();
  globalThis.window.setTimeout = (callback) => setTimeout(callback, 0);
  globalThis.__entryAdTestClassify = (error, origin) => origin === 'SDK_PROMISE' && /NO_FILL/.test(error.message) ? 'TRY_BACKUP_ONCE' : 'STOP';
  const create = globalThis.window.TTMinis.createRewardedVideoAd;
  globalThis.window.TTMinis.createRewardedVideoAd = () => {
    const ad = create();
    if (ads.length === 1) ad.show = () => Promise.reject(new Error('NO_FILL'));
    return ad;
  };
  post = async () => ({ accepted: true });
  try {
    const playback = showAppEntryAd({
      ...input, sessionId: 'entry-backup', placementId: 'primary-test',
      placementIds: ['primary-test', 'backup-test'], requiredCount: 1
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(ads.length, 2);
    ads[1].close({ isEnded: true });
    const result = await playback;
    assert.equal(result.placementId, 'backup-test');
    assert.equal(ads[0].shows, 0);
    assert.equal(ads[1].shows, 1);
    assert.equal(analyticsEvents.find(({ kind, input }) => kind === 'show' && input.placementId === 'backup-test')?.input.attemptNo, 2);
  } finally {
    delete globalThis.__entryAdTestClassify;
    delete globalThis.__entryAdTestPlatform;
  }
});

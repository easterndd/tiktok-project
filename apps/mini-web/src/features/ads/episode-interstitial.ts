import { adLoadCallback, adLoadDurationMs, adLoadSupported, getInterstitialAd, prewarmInterstitialAd, releaseInterstitialAd, waitForAdReady } from './ad-instance-cache';
import { claimNativeAd, nativeAdActive, rewardedEndedRecently } from './ad-activity';
import { adErrorMessage } from './ad-timeout';
import { reportDiagnostic, reportPerformance } from '../../lib/diagnostics';
import { captureSdkCallback, newAdOperationId, nextAdSequence, recordAdClose, recordAdLoad, recordAdLoadResult, recordAdShow } from '../../lib/analytics';
import { getDefaultAdLoadMode, isMiniPageVisible, type AdLoadMode } from './ad-platform';
import { classifyAdFailure, normalizeErrorOrigin, taggedAdFailure, type AdErrorOrigin } from './ad-error-policy';

let transitionCount = 0;
let shownCount = 0;
let lastShownAt = 0;
let enteredAt = Date.now();
let timedRemainingMs = 30_000;
let failedTimedAttempts = 0;
let continuousMode = false;
let timedDisabled = false;
let retryNotBefore = 0;
let activePlacementPolicy: { placementIds: string[]; adLoadMode: AdLoadMode; strategyVariant: string } = {
  placementIds: [], adLoadMode: 'EXPLICIT_LOAD', strategyVariant: 'CONTROL'
};

function recordTimedFailure(error: unknown) {
  if (!continuousMode) return;
  const message = adErrorMessage(error);
  if (/50008|env check failed|unavailable for iaa/i.test(message)) timedDisabled = true;
  if (/11004|11005|11006/i.test(message)) retryNotBefore = Date.now() + Math.max(60, activePolicy.minIntervalSeconds) * 1000;
  failedTimedAttempts = Math.min(3, failedTimedAttempts + 1);
}
let activePolicy = {
  initialDelaySeconds: 30,
  intervalSeconds: 60,
  minIntervalSeconds: 180,
  maxPerSession: 2,
  initialSkipTransitions: 2,
  everyTransitions: 3,
  rewardedCooldownSeconds: 60
};

export function configureEpisodeInterstitial(input: typeof activePolicy & { placementId?: string | null; placementIds?: string[]; adLoadMode?: AdLoadMode; strategyVariant?: string }, continuous = false) {
  continuousMode = continuous;
  activePolicy = { ...activePolicy, ...input };
  activePlacementPolicy = {
    placementIds: input.placementIds ?? (input.placementId ? [input.placementId] : []),
    adLoadMode: input.adLoadMode ?? getDefaultAdLoadMode(),
    strategyVariant: input.strategyVariant ?? 'CONTROL'
  };
  enteredAt = Date.now();
  transitionCount = 0;
  shownCount = 0;
  lastShownAt = 0;
  timedRemainingMs = activePolicy.initialDelaySeconds * 1000;
  failedTimedAttempts = 0;
  timedDisabled = false;
  retryNotBefore = 0;
}

function frequencyAllows(now = Date.now()) {
  return now - enteredAt >= activePolicy.initialDelaySeconds * 1000
    && shownCount < activePolicy.maxPerSession
    && (!lastShownAt || (now - lastShownAt >= activePolicy.intervalSeconds * 1000
      && now - lastShownAt >= activePolicy.minIntervalSeconds * 1000))
    && !rewardedEndedRecently(activePolicy.rewardedCooldownSeconds * 1000)
    && isMiniPageVisible()
    && !nativeAdActive();
}

export function prepareEpisodeInterstitial(placementId: string | null | undefined) {
  if (placementId) prewarmInterstitialAd(placementId, 1, activePlacementPolicy.adLoadMode);
}

export async function showEpisodeTimedInterstitial(placementId: string | null | undefined): Promise<number | undefined> {
  if (!placementId || !frequencyAllows()) return;
  return showInterstitial(placementId);
}

export function startEpisodeInterstitialSchedule(placementId: string, isActive: () => boolean) {
  if (!continuousMode) {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delayMs: number) => {
      timer = setTimeout(() => {
        if (stopped) return;
        if (!isActive()) { schedule(5_000); return; }
        void showEpisodeTimedInterstitial(placementId).catch(() => undefined).finally(() => {
          if (!stopped) schedule(activePolicy.intervalSeconds * 1000);
        });
      }, Math.max(0, delayMs));
    };
    schedule(activePolicy.initialDelaySeconds * 1000);
    return () => { stopped = true; if (timer !== undefined) clearTimeout(timer); };
  }
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dueAt = 0;
  const schedule = (delayMs: number) => {
    if (timedDisabled || shownCount >= activePolicy.maxPerSession) return;
    dueAt = Date.now() + Math.max(0, delayMs);
    timer = setTimeout(() => {
      if (stopped) return;
      if (!isActive()) {
        schedule(1_000);
        return;
      }
      const eligible = Date.now() >= retryNotBefore && frequencyAllows();
      void (eligible ? showEpisodeTimedInterstitial(placementId) : Promise.resolve(undefined))
        .catch(() => undefined)
        .finally(() => {
          if (!stopped) schedule(!eligible ? Math.max(5_000, retryNotBefore - Date.now()) : failedTimedAttempts > 0 && failedTimedAttempts < 3
            ? Math.min(30_000, 2 ** failedTimedAttempts * 1_000) + Math.random() * 500 : activePolicy.intervalSeconds * 1000);
        });
    }, Math.max(0, delayMs));
  };
  schedule(timedRemainingMs);
  return () => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timedRemainingMs = Math.max(0, dueAt - Date.now());
    }
  };
}

export async function showEpisodeTransitionInterstitial(placementId: string | null | undefined): Promise<number | undefined> {
  if (!placementId) {
    reportDiagnostic({ kind: 'AD', phase: 'EPISODE_INTERSTITIAL_NO_PLACEMENT', message: 'No episode interstitial placement was supplied' });
    return;
  }
  transitionCount += 1;
  if (transitionCount <= activePolicy.initialSkipTransitions
    || (transitionCount - activePolicy.initialSkipTransitions - 1) % activePolicy.everyTransitions !== 0
    || !frequencyAllows()) return;
  return showInterstitial(placementId);
}

async function showInterstitial(placementId: string): Promise<number | undefined> {
  try {
    return await showInterstitialOnce(placementId);
  } catch (error) {
    const backup = activePlacementPolicy.placementIds.find((id) => id !== placementId);
    if (!backup || classifyAdFailure(error, normalizeErrorOrigin(error)) !== 'TRY_BACKUP_ONCE') throw error;
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    return showInterstitialOnce(backup);
  }
}

async function showInterstitialOnce(placementId: string): Promise<number | undefined> {
  const adSeq = nextAdSequence();
  const operationId = newAdOperationId('interstitial', adSeq);
  const placementRole = placementId === activePlacementPolicy.placementIds[0] ? 'PRIMARY' : 'BACKUP';
  const attemptNo = placementRole === 'BACKUP' ? 2 : 1;
  let supported = false;
  try { supported = Boolean(window.TTMinis?.canIUse('createInterstitialAd')); } catch { /* Unsupported runtime. */ }
  if (!supported) {
    if (continuousMode) timedDisabled = true;
    reportDiagnostic({ kind: 'AD', phase: 'EPISODE_INTERSTITIAL_UNSUPPORTED', message: 'Interstitial ads are not available in this runtime' });
    return;
  }
  const releaseActivity = claimNativeAd('episode-interstitial');
  if (!releaseActivity) return;
  let ad: InterstitialAd | undefined;
  const loadStartedAt = performance.now();
  try {
    ad = getInterstitialAd(placementId, true, activePlacementPolicy.adLoadMode);
    await waitForAdReady(ad);
    recordAdLoadResult({ adSeq, adType: 'INTERSTITIAL', placementId, supported: adLoadSupported(ad), loadMode: activePlacementPolicy.adLoadMode, durationMs: adLoadDurationMs(ad, performance.now() - loadStartedAt), callback: adLoadCallback(ad), operationId, attemptNo, adPhase: 'LOAD', strategyVariant: activePlacementPolicy.strategyVariant, placementRole });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const callback = ad ? (adLoadCallback(ad) ?? captureSdkCallback('load.wait.reject', error)) : captureSdkCallback('load.create.reject', error);
    recordAdLoad({ adSeq, adType: 'INTERSTITIAL', placementId, result: /timeout|abort/i.test(message) ? 'timeout' : 'fail', durationMs: ad ? adLoadDurationMs(ad, performance.now() - loadStartedAt) : performance.now() - loadStartedAt, error, callback, operationId, attemptNo, adPhase: 'LOAD', strategyVariant: activePlacementPolicy.strategyVariant, placementRole, errorOrigin: normalizeErrorOrigin(error, callback.name === 'onError' ? 'onError' : 'load.reject') });
    recordTimedFailure(error);
    if (ad) releaseInterstitialAd(placementId, ad);
    releaseActivity();
    reportDiagnostic({ kind: 'AD', phase: 'EPISODE_INTERSTITIAL_CREATE', message: adErrorMessage(error) });
    throw error;
  }
  return await new Promise<number | undefined>((resolve, reject) => {
    let settled = false;
    let shown = false;
    let shownAt = 0;
    let closed = false;
    let closedAt: number | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const showStartedAt = performance.now();
    const finish = (error?: unknown, origin: AdErrorOrigin = 'UNKNOWN') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ad!.offClose(onClose);
      ad!.offError(onError);
      releaseInterstitialAd(placementId, ad!);
      releaseActivity();
      if (error) {
        const message = adErrorMessage(error);
        recordAdShow({ adSeq, adType: 'INTERSTITIAL', placementId, result: /timeout|abort/i.test(message) ? 'timeout' : 'fail', durationMs: performance.now() - showStartedAt, error, callback: captureSdkCallback(origin === 'SDK_CALLBACK' ? 'onError' : origin === 'APP_TIMEOUT' ? 'app.timeout' : 'show.reject', error), operationId, attemptNo, adPhase: 'SHOW', strategyVariant: activePlacementPolicy.strategyVariant, placementRole, errorOrigin: origin });
        reportDiagnostic({ kind: 'AD', phase: 'EPISODE_INTERSTITIAL_SHOW', message });
      }
      if (error) recordTimedFailure(error);
      else { failedTimedAttempts = 0; if (continuousMode) lastShownAt = Date.now(); prewarmInterstitialAd(placementId, 1, activePlacementPolicy.adLoadMode); }
      if (error) reject(taggedAdFailure(adErrorMessage(error), origin));
      else resolve(closedAt);
    };
    const onClose = (result?: unknown) => {
      closed = true;
      closedAt = performance.timeOrigin + performance.now();
      recordAdClose({ adSeq, adType: 'INTERSTITIAL', placementId, isEnded: null, durationMs: performance.now() - (shownAt || showStartedAt), callback: captureSdkCallback('onClose', result), operationId, attemptNo, adPhase: 'CLOSE', strategyVariant: activePlacementPolicy.strategyVariant, placementRole });
      if (shown) finish();
    };
    const onError = (error: unknown) => finish(error, 'SDK_CALLBACK');
    timer = setTimeout(() => finish(new Error(shown ? 'AD_CLOSE_TIMEOUT' : 'AD_SHOW_TIMEOUT'), 'APP_TIMEOUT'), 90_000);
    ad!.onClose(onClose);
    ad!.onError(onError);
    try {
      void Promise.resolve(ad!.show()).then(() => {
        if (settled) return;
        shown = true;
        shownAt = performance.now();
        recordAdShow({ adSeq, adType: 'INTERSTITIAL', placementId, result: 'success', durationMs: performance.now() - showStartedAt, callback: captureSdkCallback('show.resolve'), operationId, attemptNo, adPhase: 'SHOW', strategyVariant: activePlacementPolicy.strategyVariant, placementRole });
        reportPerformance('EPISODE_INTERSTITIAL_SHOW_ACCEPTED', '/native-ads/interstitial', performance.now() - showStartedAt);
        shownCount += 1;
        if (!continuousMode) lastShownAt = Date.now();
        if (closed) finish();
      }, (error) => finish(error, 'SDK_PROMISE'));
    } catch (error) { finish(error, 'SDK_PROMISE'); }
  });
}

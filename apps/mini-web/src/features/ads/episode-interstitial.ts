import { getInterstitialAd, prewarmInterstitialAd, releaseInterstitialAd, waitForAdReady } from './ad-instance-cache';
import { claimNativeAd, nativeAdActive, rewardedEndedRecently } from './ad-activity';
import { adErrorMessage } from './ad-timeout';
import { reportDiagnostic, reportPerformance } from '../../lib/diagnostics';

let transitionCount = 0;
let shownCount = 0;
let lastShownAt = 0;
let enteredAt = Date.now();
let timedRemainingMs = 30_000;
let failedTimedAttempts = 0;
let continuousMode = false;
let timedDisabled = false;
let retryNotBefore = 0;

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

export function configureEpisodeInterstitial(input: typeof activePolicy, continuous = false) {
  continuousMode = continuous;
  activePolicy = { ...activePolicy, ...input };
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
    && !nativeAdActive();
}

export function prepareEpisodeInterstitial(placementId: string | null | undefined) {
  if (placementId) prewarmInterstitialAd(placementId, 1);
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
  try {
    ad = getInterstitialAd(placementId);
    await waitForAdReady(ad);
  } catch (error) {
    recordTimedFailure(error);
    if (ad) releaseInterstitialAd(placementId, ad);
    releaseActivity();
    reportDiagnostic({ kind: 'AD', phase: 'EPISODE_INTERSTITIAL_CREATE', message: adErrorMessage(error) });
    return;
  }
  return await new Promise<number | undefined>((resolve) => {
    let settled = false;
    let shown = false;
    let closed = false;
    let closedAt: number | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ad!.offClose(onClose);
      ad!.offError(onError);
      releaseInterstitialAd(placementId, ad!);
      releaseActivity();
      if (error) reportDiagnostic({ kind: 'AD', phase: 'EPISODE_INTERSTITIAL_SHOW', message: adErrorMessage(error) });
      if (error) recordTimedFailure(error);
      else { failedTimedAttempts = 0; if (continuousMode) lastShownAt = Date.now(); prewarmInterstitialAd(placementId, 1); }
      resolve(closedAt);
    };
    const onClose = () => { closed = true; closedAt = performance.timeOrigin + performance.now(); if (shown) finish(); };
    const onError = (error: unknown) => finish(error);
    timer = setTimeout(() => finish(new Error(shown ? 'AD_CLOSE_TIMEOUT' : 'AD_SHOW_TIMEOUT')), 90_000);
    ad!.onClose(onClose);
    ad!.onError(onError);
    try {
      const showStartedAt = performance.now();
      void Promise.resolve(ad!.show()).then(() => {
        if (settled) return;
        shown = true;
        reportPerformance('EPISODE_INTERSTITIAL_SHOW_ACCEPTED', '/native-ads/interstitial', performance.now() - showStartedAt);
        shownCount += 1;
        if (!continuousMode) lastShownAt = Date.now();
        if (closed) finish();
      }, onError);
    } catch (error) { onError(error); }
  });
}

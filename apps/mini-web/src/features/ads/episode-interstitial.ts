import { getInterstitialAd, prewarmInterstitialAd, releaseInterstitialAd } from './ad-instance-cache';
import { claimNativeAd, nativeAdActive, rewardedEndedRecently } from './ad-activity';
import { adErrorMessage } from './ad-timeout';
import { reportDiagnostic, reportPerformance } from '../../lib/diagnostics';

const interstitialCooldownMs = 3 * 60_000;
const rewardedCooldownMs = 60_000;
const maxPerSession = 2;
let transitionCount = 0;
let shownCount = 0;
let lastShownAt = 0;

export function prepareEpisodeInterstitial(placementId: string | null | undefined) {
  if (placementId) prewarmInterstitialAd(placementId);
}

export async function showEpisodeTransitionInterstitial(placementId: string | null | undefined): Promise<number | undefined> {
  if (!placementId) return;
  transitionCount += 1;
  // Allow the first two episode transitions to play without interruption.
  if (transitionCount < 3 || transitionCount % 3 !== 0 || shownCount >= maxPerSession
    || Date.now() - lastShownAt < interstitialCooldownMs
    || rewardedEndedRecently(rewardedCooldownMs) || nativeAdActive()) return;
  let supported = false;
  try { supported = Boolean(window.TTMinis?.canIUse('createInterstitialAd')); } catch { /* Unsupported runtime. */ }
  if (!supported) return;
  const releaseActivity = claimNativeAd('episode-interstitial');
  if (!releaseActivity) return;
  let ad: InterstitialAd;
  try { ad = getInterstitialAd(placementId); }
  catch (error) {
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
      ad.offClose(onClose);
      ad.offError(onError);
      releaseInterstitialAd(placementId, ad);
      releaseActivity();
      if (error) reportDiagnostic({ kind: 'AD', phase: 'EPISODE_INTERSTITIAL_SHOW', message: adErrorMessage(error) });
      else prewarmInterstitialAd(placementId);
      resolve(closedAt);
    };
    const onClose = () => { closed = true; closedAt = performance.timeOrigin + performance.now(); if (shown) finish(); };
    const onError = (error: unknown) => finish(error);
    timer = setTimeout(() => finish(new Error(shown ? 'AD_CLOSE_TIMEOUT' : 'AD_SHOW_TIMEOUT')), 90_000);
    ad.onClose(onClose);
    ad.onError(onError);
    try {
      const showStartedAt = performance.now();
      void Promise.resolve(ad.show()).then(() => {
        if (settled) return;
        shown = true;
        reportPerformance('EPISODE_INTERSTITIAL_SHOW_ACCEPTED', '/native-ads/interstitial', performance.now() - showStartedAt);
        shownCount += 1;
        lastShownAt = Date.now();
        if (closed) finish();
      }, onError);
    } catch (error) { onError(error); }
  });
}

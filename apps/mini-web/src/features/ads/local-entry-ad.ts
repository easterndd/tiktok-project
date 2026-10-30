import { reportDiagnostic, reportPerformance } from '../../lib/diagnostics';
import { adTimeout, adErrorMessage } from './ad-timeout';
import { claimNativeAd, markRewardedAdClosed } from './ad-activity';
import { getRewardedAd, prewarmRewardedAd, releaseRewardedAd, waitForAdReady } from './ad-instance-cache';
import { chooseEntryAdPlacement, markEntryAdPlacementAccepted } from './entry-ad-placements';

type EntryEligibility = { showEntryAd: boolean; reason?: string };

function isPageHidden() {
  return document.visibilityState === 'hidden';
}

function canShowRewardedAd() {
  try {
    return Boolean(window.TTMinis
      && typeof window.TTMinis.createRewardedVideoAd === 'function'
      && window.TTMinis.canIUse('createRewardedVideoAd'));
  } catch {
    return false;
  }
}

function errorCode(error: unknown) {
  return adErrorMessage(error);
}

async function showOneLocalEntryAd(input: {
  placementId: string;
  index: number;
  placementIds: string[];
  deadline: number;
  isActive: () => boolean;
}) {
  if (!canShowRewardedAd()) throw new Error('ENTRY_REWARDED_UNAVAILABLE');
  if (isPageHidden() || !input.isActive()) throw new Error('ENTRY_PAGE_INACTIVE');

  const releaseActivity = claimNativeAd('entry');
  if (!releaseActivity) throw new Error('AD_BUSY');

  let ad: RewardedVideoAd | undefined;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseActivity();
    if (ad) releaseRewardedAd(input.placementId, ad);
  };

  try {
    const loadStartedAt = performance.now();
    ad = getRewardedAd(input.placementId, false);
    const loadBudget = Math.max(1, Math.min(6_000, input.deadline - Date.now()));
    await waitForAdReady(ad, loadBudget);
    reportPerformance('APP_BOOT_TO_ENTRY_LOAD_READY', '/native-ads/entry', performance.now() - loadStartedAt, { placementIndex: input.index });
  } catch (error) {
    release();
    throw error;
  }

  if (isPageHidden() || !input.isActive()) {
    release();
    throw new Error('ENTRY_PAGE_INACTIVE');
  }

  return new Promise<boolean>((resolve, reject) => {
    let accepted = false;
    let terminal = false;
    let acceptedTimer = 0;
    const timeout = adTimeout(onError);
    const cleanup = () => {
      window.clearTimeout(acceptedTimer);
      timeout.clear();
      ad!.offClose(onClose);
      ad!.offError(onError);
    };
    const accept = () => {
      if (accepted || terminal) return;
      accepted = true;
      window.clearTimeout(acceptedTimer);
      timeout.shown();
      markEntryAdPlacementAccepted(input.placementIds, input.index);
      reportPerformance('APP_BOOT_TO_ENTRY_SHOW_ACCEPTED', '/native-ads/entry', performance.now() - showStartedAt, { placementIndex: input.index });
      resolve(true);
    };
    const onClose = () => {
      if (terminal) return;
      if (!accepted) accept();
      terminal = true;
      markRewardedAdClosed();
      cleanup();
      release();
    };
    function onError(error: unknown) {
      if (terminal) return;
      terminal = true;
      cleanup();
      release();
      const message = errorCode(error);
      reportDiagnostic({ kind: 'AD', phase: 'LOCAL_ENTRY_AD_SHOW', message, path: '/native-ads/entry' });
      if (!accepted) reject(new Error(message));
    }
    const showStartedAt = performance.now();
    ad!.onClose(onClose);
    ad!.onError(onError);
    acceptedTimer = window.setTimeout(() => onError(new Error('ENTRY_AD_SHOW_ACCEPT_TIMEOUT')), Math.max(1, input.deadline - Date.now()));
    try {
      void Promise.resolve(ad!.show()).then(accept, onError);
    } catch (error) {
      onError(error);
    }
  });
}

export async function attemptLocalEntryAd(input: {
  placementIds: string[];
  getEligibility: () => Promise<EntryEligibility | undefined>;
  isActive: () => boolean;
}) {
  const selection = chooseEntryAdPlacement(input.placementIds);
  if (!selection) return false;

  const startedAt = performance.now();
  const deadline = Date.now() + 10_000;
  reportPerformance('APP_BOOT_TO_ENTRY_LOAD_START', '/native-ads/entry', 0, { placementIndex: selection.index });
  prewarmRewardedAd(selection.placementId, 1);

  const eligibilityPromise = input.getEligibility().catch((error) => {
    reportDiagnostic({ kind: 'STARTUP', phase: 'LOCAL_ENTRY_ELIGIBILITY', message: errorCode(error), path: '/auth/launch-context' });
    return undefined;
  });
  if (!canShowRewardedAd()) {
    reportDiagnostic({ kind: 'AD', phase: 'LOCAL_ENTRY_AD_UNSUPPORTED', message: 'Rewarded video is unavailable in this runtime', path: '/native-ads/entry' });
    return false;
  }

  const eligibility = await eligibilityPromise;
  if (!input.isActive() || !eligibility?.showEntryAd) {
    reportPerformance('LOCAL_ENTRY_AD_SKIPPED', '/auth/launch-context', performance.now() - startedAt, { reason: eligibility?.reason ?? 'ELIGIBILITY_UNAVAILABLE' });
    return false;
  }

  const nextIndex = (selection.index + 1) % selection.placementIds.length;
  const order = [selection.index, nextIndex];
  for (let attempt = 0; attempt < order.length; attempt++) {
    const index = order[attempt];
    const placementId = selection.placementIds[index];
    if (!input.isActive() || isPageHidden() || Date.now() >= deadline) return false;
    if (attempt > 0) {
      prewarmRewardedAd(placementId, 1);
      if (Date.now() + 750 >= deadline) return false;
      await new Promise((resolve) => window.setTimeout(resolve, 750));
    }
    try {
      return await showOneLocalEntryAd({ placementId, index, placementIds: selection.placementIds, deadline, isActive: input.isActive });
    } catch (error) {
      const message = errorCode(error);
      reportDiagnostic({ kind: 'AD', phase: 'LOCAL_ENTRY_AD_LOAD_OR_SHOW', message, path: '/native-ads/entry' });
      if (attempt > 0 || /50008|50009|ENTRY_PAGE_INACTIVE|ENTRY_REWARDED_UNAVAILABLE/.test(message)) return false;
      if (/11006/.test(message)) {
        if (Date.now() + 1_000 >= deadline) return false;
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
    }
  }
  return false;
}

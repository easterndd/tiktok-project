// Keep one ad ready for the current impression and one loading for the next.
// TikTok creates the native object synchronously, while load() removes the
// network wait from the user's next show() call when the runtime supports it.
type NativeAd = RewardedVideoAd | InterstitialAd;
type PreparedAd<T extends NativeAd> = {
  ad: T;
  host: NonNullable<Window['TTMinis']>;
  ready: Promise<void>;
};

const maxPreparedAds = 2;
const rewardedAds = new Map<string, PreparedAd<RewardedVideoAd>[]>();
const interstitialAds = new Map<string, PreparedAd<InterstitialAd>[]>();
const readiness = new WeakMap<object, Promise<void>>();

function canUse(apiName: string) {
  try {
    return Boolean(window.TTMinis?.canIUse(apiName));
  } catch {
    return false;
  }
}

function prepare<T extends NativeAd>(ad: T, host: NonNullable<Window['TTMinis']>) {
  let ready: Promise<void>;
  if (typeof ad.load !== 'function') ready = Promise.resolve();
  else ready = new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      ad.offLoad?.(onLoad);
      ad.offError(onError);
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onLoad = () => finish();
    const onError = (error: unknown) => finish(error);
    ad.onLoad?.(onLoad);
    ad.onError(onError);
    try {
      const result = ad.load!();
      if (result && typeof (result as Promise<void>).then === 'function') {
        void Promise.resolve(result).then(() => finish(), finish);
      } else if (!ad.onLoad) finish();
    } catch (error) {
      finish(error);
    }
  });
  void ready.catch(() => undefined);
  const prepared = { ad, host, ready } satisfies PreparedAd<T>;
  readiness.set(ad, ready);
  return prepared;
}

function addPrepared<T extends NativeAd>(
  map: Map<string, PreparedAd<T>[]>,
  adUnitId: string,
  host: NonNullable<Window['TTMinis']>,
  create: () => T,
  count: number
) {
  const pool = map.get(adUnitId) ?? [];
  while (pool.length < Math.min(maxPreparedAds, count)) {
    try {
      pool.push(prepare(create(), host));
    } catch {
      break;
    }
  }
  if (pool.length) map.set(adUnitId, pool);
  return pool;
}

export function prewarmRewardedAd(adUnitId: string, count = 1) {
  if (!adUnitId || !window.TTMinis || !canUse('createRewardedVideoAd')) return;
  const host = window.TTMinis;
  const pool = rewardedAds.get(adUnitId) ?? [];
  const compatible = pool.filter((item) => item.host === host);
  if (compatible.length !== pool.length) rewardedAds.set(adUnitId, compatible);
  addPrepared(rewardedAds, adUnitId, host, () => host.createRewardedVideoAd({ adUnitId }), count);
}

export function getRewardedAd(adUnitId: string, prewarmNext = true) {
  prewarmRewardedAd(adUnitId, 1);
  const pool = rewardedAds.get(adUnitId);
  const prepared = pool?.shift();
  if (pool && pool.length === 0) rewardedAds.delete(adUnitId);
  if (prepared && prepared.host === window.TTMinis) {
    if (prewarmNext) prewarmRewardedAd(adUnitId, 1);
    return prepared.ad;
  }
  if (prepared) readiness.delete(prepared.ad);
  return window.TTMinis!.createRewardedVideoAd({ adUnitId });
}

export function waitForAdReady(ad: NativeAd, timeoutMs = 8_000) {
  const ready = readiness.get(ad) ?? Promise.resolve();
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return ready;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('AD_LOAD_TIMEOUT')), timeoutMs);
    void ready.then(() => { clearTimeout(timer); resolve(); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

export function releaseRewardedAd(adUnitId: string, ad: RewardedVideoAd) {
  const pool = rewardedAds.get(adUnitId);
  if (!pool) return;
  const remaining = pool.filter((item) => item.ad !== ad);
  if (remaining.length) rewardedAds.set(adUnitId, remaining);
  else rewardedAds.delete(adUnitId);
}

export function prewarmInterstitialAd(adUnitId: string, count = 1) {
  if (!adUnitId || !window.TTMinis || !canUse('createInterstitialAd')) return;
  const host = window.TTMinis;
  const pool = interstitialAds.get(adUnitId) ?? [];
  const compatible = pool.filter((item) => item.host === host);
  if (compatible.length !== pool.length) interstitialAds.set(adUnitId, compatible);
  addPrepared(interstitialAds, adUnitId, host, () => host.createInterstitialAd({ adUnitId }), count);
}

export function getInterstitialAd(adUnitId: string, prewarmNext = true) {
  prewarmInterstitialAd(adUnitId, 1);
  const pool = interstitialAds.get(adUnitId);
  const prepared = pool?.shift();
  if (pool && pool.length === 0) interstitialAds.delete(adUnitId);
  if (prepared && prepared.host === window.TTMinis) {
    if (prewarmNext) prewarmInterstitialAd(adUnitId, 1);
    return prepared.ad;
  }
  if (prepared) readiness.delete(prepared.ad);
  return window.TTMinis!.createInterstitialAd({ adUnitId });
}

export function releaseInterstitialAd(adUnitId: string, ad: InterstitialAd) {
  const pool = interstitialAds.get(adUnitId);
  if (pool) {
    const remaining = pool.filter((item) => item.ad !== ad);
    if (remaining.length) interstitialAds.set(adUnitId, remaining);
    else interstitialAds.delete(adUnitId);
  }
  try { ad.destroy?.(); } catch { /* SDK cleanup is best effort. */ }
}

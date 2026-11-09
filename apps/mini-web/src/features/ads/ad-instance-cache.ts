import type { AdLoadMode } from './ad-platform';

type SdkCallbackSnapshot = { name: string; payload: unknown; capturedAt: string };

type NativeAd = RewardedVideoAd | InterstitialAd;
type PreparedAd<T extends NativeAd> = {
  ad: T;
  host: NonNullable<Window['TTMinis']>;
  ready: Promise<void>;
  loadMode: AdLoadMode;
};

const maxPreparedAds = 2;
const rewardedAds = new Map<string, PreparedAd<RewardedVideoAd>[]>();
const interstitialAds = new Map<string, PreparedAd<InterstitialAd>[]>();
const readiness = new WeakMap<object, Promise<void>>();
const loadDurations = new WeakMap<object, number>();
const loadCallbacks = new WeakMap<object, SdkCallbackSnapshot>();
const loadModes = new WeakMap<object, AdLoadMode>();

function preparedCount() {
  const count = (map: Map<string, PreparedAd<NativeAd>[]>) => [...map.values()].reduce((sum, pool) => sum + pool.length, 0);
  return count(rewardedAds as Map<string, PreparedAd<NativeAd>[]>) + count(interstitialAds as Map<string, PreparedAd<NativeAd>[]>);
}

function sanitizeLoadPayload(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    return value.replace(/https?:\/\/[^\s]+/gi, '[URL]').replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]').slice(0, 1_000);
  }
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeLoadPayload(item, depth + 1));
  const output: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(value).slice(0, 40)) {
    let item: unknown;
    try { item = (value as Record<string, unknown>)[key]; } catch { item = '[Unreadable]'; }
    if (/(?:token|secret|password|authorization|auth.?code|cookie|signature|ttclid|ttoclid|click_id)/i.test(key)) output[key] = '[REDACTED]';
    else output[key] = sanitizeLoadPayload(item, depth + 1);
  }
  return output;
}

function captureLoadCallback(name: string, payload: unknown = null): SdkCallbackSnapshot {
  if (payload instanceof Error) {
    const errorPayload: Record<string, unknown> = { name: payload.name, message: payload.message, stack: payload.stack };
    for (const key of Object.getOwnPropertyNames(payload)) errorPayload[key] = (payload as unknown as Record<string, unknown>)[key];
    payload = errorPayload;
  }
  const sanitized = sanitizeLoadPayload(payload);
  try {
    const encoded = JSON.stringify(sanitized);
    return { name, payload: encoded && encoded.length > 4_096 ? { truncated: true, preview: encoded.slice(0, 3_000) } : sanitized, capturedAt: new Date().toISOString() };
  } catch {
    return { name, payload: { truncated: true, preview: '[Unserializable SDK callback]' }, capturedAt: new Date().toISOString() };
  }
}

export function adLoadSupported(ad: NativeAd) {
  return loadModes.get(ad) !== 'DIRECT_SHOW' && typeof ad.load === 'function';
}

export function adLoadDurationMs(ad: NativeAd, fallback: number) {
  return loadDurations.get(ad) ?? fallback;
}

export function adLoadCallback(ad: NativeAd) {
  return loadCallbacks.get(ad);
}

function canUse(apiName: string) {
  try {
    return Boolean(window.TTMinis?.canIUse(apiName));
  } catch {
    return false;
  }
}

function prepare<T extends NativeAd>(ad: T, host: NonNullable<Window['TTMinis']>, loadMode: AdLoadMode) {
  let ready: Promise<void>;
  const startedAt = performance.now();
  loadModes.set(ad, loadMode);
  if (loadMode === 'DIRECT_SHOW') {
    loadDurations.set(ad, 0);
    loadCallbacks.set(ad, captureLoadCallback('load.skipped', { reason: 'DIRECT_SHOW' }));
    ready = Promise.resolve();
  } else if (typeof ad.load !== 'function') {
    loadDurations.set(ad, 0);
    loadCallbacks.set(ad, captureLoadCallback('load.unsupported'));
    ready = Promise.resolve();
  }
  else ready = new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      ad.offLoad?.(onLoad);
      ad.offError(onError);
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      loadDurations.set(ad, performance.now() - startedAt);
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onLoad = () => {
      loadCallbacks.set(ad, captureLoadCallback('onLoad'));
      finish();
    };
    const onError = (error: unknown) => {
      loadCallbacks.set(ad, captureLoadCallback('onError', error));
      finish(error);
    };
    ad.onLoad?.(onLoad);
    ad.onError(onError);
    try {
      const result = ad.load!();
      if (result && typeof (result as Promise<void>).then === 'function') {
        void Promise.resolve(result).then(() => {
          if (!loadCallbacks.has(ad)) loadCallbacks.set(ad, captureLoadCallback('load.resolve'));
          finish();
        }, (error) => {
          if (!loadCallbacks.has(ad)) loadCallbacks.set(ad, captureLoadCallback('load.reject', error));
          finish(error);
        });
      } else if (!ad.onLoad) {
        loadCallbacks.set(ad, captureLoadCallback('load.resolve'));
        finish();
      }
    } catch (error) {
      loadCallbacks.set(ad, captureLoadCallback('load.throw', error));
      finish(error);
    }
  });
  void ready.catch(() => undefined);
  const prepared = { ad, host, ready, loadMode } satisfies PreparedAd<T>;
  readiness.set(ad, ready);
  return prepared;
}

function addPrepared<T extends NativeAd>(
  map: Map<string, PreparedAd<T>[]>,
  adUnitId: string,
  host: NonNullable<Window['TTMinis']>,
  create: () => T,
  count: number,
  loadMode: AdLoadMode
) {
  const pool = (map.get(adUnitId) ?? []).filter((item) => {
    if (item.host === host && item.loadMode === loadMode) return true;
    try { item.ad.destroy?.(); } catch { /* Stale native instances are best-effort cleanup. */ }
    readiness.delete(item.ad);
    return false;
  });
  if (pool.length) map.set(adUnitId, pool);
  else map.delete(adUnitId);
  while (pool.length < Math.min(maxPreparedAds, count) && preparedCount() < maxPreparedAds) {
    try {
      pool.push(prepare(create(), host, loadMode));
    } catch {
      break;
    }
  }
  if (pool.length) map.set(adUnitId, pool);
  return pool;
}

export function prewarmRewardedAd(adUnitId: string, count = 1, loadMode: AdLoadMode = 'EXPLICIT_LOAD') {
  if (loadMode === 'DIRECT_SHOW') return;
  if (!adUnitId || !window.TTMinis || !canUse('createRewardedVideoAd')) return;
  const host = window.TTMinis;
  const pool = rewardedAds.get(adUnitId) ?? [];
  const compatible = pool.filter((item) => item.host === host);
  if (compatible.length !== pool.length) rewardedAds.set(adUnitId, compatible);
  addPrepared(rewardedAds, adUnitId, host, () => host.createRewardedVideoAd({ adUnitId }), count, loadMode);
}

export function getRewardedAd(adUnitId: string, prewarmNext = true, loadMode: AdLoadMode = 'EXPLICIT_LOAD') {
  const host = window.TTMinis;
  if (!host) throw new Error('TIKTOK_MINIS_UNAVAILABLE');
  const pool = loadMode === 'DIRECT_SHOW' ? undefined : rewardedAds.get(adUnitId);
  const prepared = pool?.find((item) => item.host === host && item.loadMode === loadMode);
  if (prepared) pool?.splice(pool.indexOf(prepared), 1);
  if (pool && pool.length === 0) rewardedAds.delete(adUnitId);
  if (prepared && prepared.host === host) {
    if (prewarmNext) prewarmRewardedAd(adUnitId, 1, loadMode);
    return prepared.ad;
  }
  const ad = host.createRewardedVideoAd({ adUnitId });
  prepare(ad, host, loadMode);
  if (prewarmNext) prewarmRewardedAd(adUnitId, 1, loadMode);
  return ad;
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
  if (pool) {
    const remaining = pool.filter((item) => item.ad !== ad);
    if (remaining.length) rewardedAds.set(adUnitId, remaining);
    else rewardedAds.delete(adUnitId);
  }
  readiness.delete(ad);
  try { ad.destroy?.(); } catch { /* SDK cleanup is best effort. */ }
}

export function prewarmInterstitialAd(adUnitId: string, count = 1, loadMode: AdLoadMode = 'EXPLICIT_LOAD') {
  if (loadMode === 'DIRECT_SHOW') return;
  if (!adUnitId || !window.TTMinis || !canUse('createInterstitialAd')) return;
  const host = window.TTMinis;
  const pool = interstitialAds.get(adUnitId) ?? [];
  const compatible = pool.filter((item) => item.host === host);
  if (compatible.length !== pool.length) interstitialAds.set(adUnitId, compatible);
  addPrepared(interstitialAds, adUnitId, host, () => host.createInterstitialAd({ adUnitId }), count, loadMode);
}

export function getInterstitialAd(adUnitId: string, prewarmNext = true, loadMode: AdLoadMode = 'EXPLICIT_LOAD') {
  const host = window.TTMinis;
  if (!host) throw new Error('TIKTOK_MINIS_UNAVAILABLE');
  const pool = loadMode === 'DIRECT_SHOW' ? undefined : interstitialAds.get(adUnitId);
  const prepared = pool?.find((item) => item.host === host && item.loadMode === loadMode);
  if (prepared) pool?.splice(pool.indexOf(prepared), 1);
  if (pool && pool.length === 0) interstitialAds.delete(adUnitId);
  if (prepared && prepared.host === host) {
    if (prewarmNext) prewarmInterstitialAd(adUnitId, 1, loadMode);
    return prepared.ad;
  }
  const ad = host.createInterstitialAd({ adUnitId });
  prepare(ad, host, loadMode);
  if (prewarmNext) prewarmInterstitialAd(adUnitId, 1, loadMode);
  return ad;
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

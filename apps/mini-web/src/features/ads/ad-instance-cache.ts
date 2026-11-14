import { getAdPlatform, isV006DualRelease, isV006Release, type AdLoadMode } from './ad-platform';
import { captureClientTrace } from '../../lib/client-trace';

type SdkCallbackSnapshot = { name: string; payload: unknown; capturedAt: string };

type NativeAd = RewardedVideoAd | InterstitialAd;
type PreparedAd<T extends NativeAd> = {
  ad: T;
  host: NonNullable<Window['TTMinis']>;
  ready: Promise<void>;
  loadMode: AdLoadMode;
  state: 'loading' | 'ready' | 'failed';
};

const maxPreparedAds = 4;
const maxDualPreparedAds = 8;
const loadTimeoutMs = 7_500;
const rewardedAds = new Map<string, PreparedAd<RewardedVideoAd>[]>();
const interstitialAds = new Map<string, PreparedAd<InterstitialAd>[]>();
const readiness = new WeakMap<object, Promise<void>>();
const loadDurations = new WeakMap<object, number>();
const loadCallbacks = new WeakMap<object, SdkCallbackSnapshot>();
const loadModes = new WeakMap<object, AdLoadMode>();
const disposedAds = new WeakSet<object>();
const androidLoadGates = new Map<string, Promise<void>>();

function preparedCount() {
  const count = (map: Map<string, PreparedAd<NativeAd>[]>) => [...map.values()].reduce((sum, pool) => sum + pool.length, 0);
  return count(rewardedAds as Map<string, PreparedAd<NativeAd>[]>) + count(interstitialAds as Map<string, PreparedAd<NativeAd>[]>);
}

function discardStaleHost(host: NonNullable<Window['TTMinis']>) {
  for (const map of [rewardedAds, interstitialAds] as Array<Map<string, PreparedAd<NativeAd>[]>>) {
    for (const [id, pool] of map) {
      const current = pool.filter((item) => item.host === host && !disposedAds.has(item.ad));
      for (const item of pool) {
        if (current.includes(item)) continue;
        disposedAds.add(item.ad);
        readiness.delete(item.ad);
        try { item.ad.destroy?.(); } catch { /* Native cleanup is best effort. */ }
      }
      if (current.length) map.set(id, current);
      else map.delete(id);
    }
  }
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

function captureLoadCallback(name: string, payload: unknown = null, placementId?: string): SdkCallbackSnapshot {
  captureClientTrace('SDK_CALLBACK', name, payload, { placementId });
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

function prepare<T extends NativeAd>(ad: T, host: NonNullable<Window['TTMinis']>, loadMode: AdLoadMode, adUnitId: string) {
  let ready: Promise<void>;
  loadModes.set(ad, loadMode);
  if (loadMode === 'DIRECT_SHOW') {
    loadDurations.set(ad, 0);
    loadCallbacks.set(ad, captureLoadCallback('load.skipped', { reason: 'DIRECT_SHOW' }, adUnitId));
    ready = Promise.resolve();
  } else if (typeof ad.load !== 'function') {
    loadDurations.set(ad, 0);
    loadCallbacks.set(ad, captureLoadCallback('load.unsupported', null, adUnitId));
    ready = Promise.resolve();
  }
  else {
    const load = () => new Promise<void>((resolve, reject) => {
      const startedAt = performance.now();
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        try { ad.offLoad?.(onLoad); } catch { /* SDK event cleanup is best effort. */ }
        try { ad.offError(onError); } catch { /* SDK event cleanup is best effort. */ }
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
        loadCallbacks.set(ad, captureLoadCallback('onLoad', null, adUnitId));
        finish();
      };
      const onError = (error: unknown) => {
        loadCallbacks.set(ad, captureLoadCallback('onError', error, adUnitId));
        finish(error);
      };
      const timer = setTimeout(() => {
        loadCallbacks.set(ad, captureLoadCallback('load.timeout', null, adUnitId));
        disposedAds.add(ad);
        try { ad.destroy?.(); } catch { /* An unresponsive SDK instance may already be gone. */ }
        finish(new Error('AD_LOAD_TIMEOUT'));
      }, loadTimeoutMs);
      try {
        ad.onLoad?.(onLoad);
        ad.onError(onError);
        captureClientTrace('SDK_CALL', 'load', { adUnitId, loadMode }, { placementId: adUnitId });
        const result = ad.load!();
        if (result && typeof (result as Promise<void>).then === 'function') {
          void Promise.resolve(result).then(() => {
            if (!loadCallbacks.has(ad)) loadCallbacks.set(ad, captureLoadCallback('load.resolve', null, adUnitId));
            finish();
          }, (error) => {
            if (!loadCallbacks.has(ad)) loadCallbacks.set(ad, captureLoadCallback('load.reject', error, adUnitId));
            finish(error);
          });
        } else if (!ad.onLoad) {
          loadCallbacks.set(ad, captureLoadCallback('load.resolve', null, adUnitId));
          finish();
        }
      } catch (error) {
        loadCallbacks.set(ad, captureLoadCallback('load.throw', error, adUnitId));
        finish(error);
      }
    });
    if (isV006Release() && getAdPlatform() === 'android') {
      const previous = androidLoadGates.get(adUnitId) ?? Promise.resolve();
      ready = previous.then(() => {
        if (disposedAds.has(ad)) throw new Error('AD_INSTANCE_RELEASED');
        return load();
      });
      const tail = ready.then(() => undefined, () => undefined);
      androidLoadGates.set(adUnitId, tail);
      void tail.then(() => { if (androidLoadGates.get(adUnitId) === tail) androidLoadGates.delete(adUnitId); });
    } else ready = load();
  }
  void ready.catch(() => undefined);
  const prepared: PreparedAd<T> = { ad, host, ready, loadMode, state: 'loading' };
  void ready.then(() => { prepared.state = 'ready'; }, () => { prepared.state = 'failed'; });
  readiness.set(ad, ready);
  void ready.catch(() => {
    for (const map of [rewardedAds, interstitialAds] as Array<Map<string, PreparedAd<T>[]>>) {
      const pool = map.get(adUnitId);
      if (!pool?.includes(prepared)) continue;
      const remaining = pool.filter((item) => item !== prepared);
      if (remaining.length) map.set(adUnitId, remaining);
      else map.delete(adUnitId);
      disposedAds.add(ad);
      try { ad.destroy?.(); } catch { /* Native cleanup is best effort. */ }
    }
  });
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
    disposedAds.add(item.ad);
    try { item.ad.destroy?.(); } catch { /* Stale native instances are best-effort cleanup. */ }
    readiness.delete(item.ad);
    return false;
  });
  if (pool.length) map.set(adUnitId, pool);
  else map.delete(adUnitId);
  const limit = isV006DualRelease() && getAdPlatform() === 'android' ? maxDualPreparedAds : maxPreparedAds;
  while (pool.length < Math.min(limit, count) && preparedCount() < limit) {
    try {
      const ad = create();
      captureClientTrace('SDK_CALL', 'create', { adUnitId, loadMode }, { placementId: adUnitId });
      pool.push(prepare(ad, host, loadMode, adUnitId));
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
  discardStaleHost(host);
  addPrepared(rewardedAds, adUnitId, host, () => host.createRewardedVideoAd({ adUnitId }), count, loadMode);
}

export function prewarmRewardedPlacements(adUnitIds: string[], loadMode: AdLoadMode = 'EXPLICIT_LOAD') {
  const ids = isV006Release() && getAdPlatform() !== 'android' ? adUnitIds.slice(0, 1) : adUnitIds;
  for (const id of ids) prewarmRewardedAd(id, 1, loadMode);
}

export function readyRewardedPlacement(adUnitIds: string[], preferredId: string, loadMode: AdLoadMode = 'EXPLICIT_LOAD') {
  const ready = (id: string) => rewardedAds.get(id)?.some((item) => item.host === window.TTMinis && item.loadMode === loadMode && item.state === 'ready');
  if (ready(preferredId)) return preferredId;
  return adUnitIds.find((id) => id !== preferredId && ready(id)) ?? preferredId;
}

export function primeEntryRewardedPool(adUnitIds: string[], loadMode: AdLoadMode = 'EXPLICIT_LOAD') {
  const primaryId = adUnitIds[0];
  if (!primaryId || loadMode === 'DIRECT_SHOW') return;
  prewarmRewardedAd(primaryId, 1, loadMode);
  if (!isV006DualRelease() || getAdPlatform() !== 'android' || adUnitIds.length < 2) return;
  prewarmRewardedAd(adUnitIds[1], 1, loadMode);
  const firstReady = adUnitIds.slice(0, 2).map((id) => rewardedAds.get(id)?.[0]?.ready).filter((ready): ready is Promise<void> => Boolean(ready));
  if (firstReady.length) void Promise.any(firstReady).then(() => refillEntryRewardedPool(adUnitIds, loadMode), () => undefined);
}

export function refillEntryRewardedPool(adUnitIds: string[], loadMode: AdLoadMode = 'EXPLICIT_LOAD') {
  if (loadMode === 'DIRECT_SHOW' || !isV006DualRelease() || getAdPlatform() !== 'android') return;
  for (const id of adUnitIds.slice(0, 2)) prewarmRewardedAd(id, 3, loadMode);
}

export function getRewardedAd(adUnitId: string, prewarmNext = true, loadMode: AdLoadMode = 'EXPLICIT_LOAD') {
  const host = window.TTMinis;
  if (!host) throw new Error('TIKTOK_MINIS_UNAVAILABLE');
  const pool = loadMode === 'DIRECT_SHOW' ? undefined : rewardedAds.get(adUnitId);
  const prepared = pool?.find((item) => item.host === host && item.loadMode === loadMode && item.state === 'ready')
    ?? pool?.find((item) => item.host === host && item.loadMode === loadMode);
  const refillNow = prewarmNext && !(isV006Release() && getAdPlatform() === 'android');
  if (prepared) pool?.splice(pool.indexOf(prepared), 1);
  if (pool && pool.length === 0) rewardedAds.delete(adUnitId);
  if (prepared && prepared.host === host) {
    if (refillNow) prewarmRewardedAd(adUnitId, 1, loadMode);
    return prepared.ad;
  }
  const ad = host.createRewardedVideoAd({ adUnitId });
  captureClientTrace('SDK_CALL', 'createRewardedVideoAd', { adUnitId, loadMode }, { placementId: adUnitId });
  prepare(ad, host, loadMode, adUnitId);
  if (refillNow) prewarmRewardedAd(adUnitId, 1, loadMode);
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
  disposedAds.add(ad);
  const pool = rewardedAds.get(adUnitId);
  if (pool) {
    const remaining = pool.filter((item) => item.ad !== ad);
    if (remaining.length) rewardedAds.set(adUnitId, remaining);
    else rewardedAds.delete(adUnitId);
  }
  readiness.delete(ad);
  try { ad.destroy?.(); } catch { /* SDK cleanup is best effort. */ }
}

export function returnRewardedAd(adUnitId: string, ad: RewardedVideoAd, loadMode: AdLoadMode) {
  if (disposedAds.has(ad) || !window.TTMinis) return false;
  const pool = rewardedAds.get(adUnitId) ?? [];
  if (pool.some((item) => item.ad === ad)) return true;
  pool.unshift({ ad, host: window.TTMinis, ready: readiness.get(ad) ?? Promise.resolve(), loadMode, state: 'ready' });
  rewardedAds.set(adUnitId, pool);
  return true;
}

export function prewarmInterstitialAd(adUnitId: string, count = 1, loadMode: AdLoadMode = 'EXPLICIT_LOAD') {
  if (loadMode === 'DIRECT_SHOW') return;
  if (!adUnitId || !window.TTMinis || !canUse('createInterstitialAd')) return;
  const host = window.TTMinis;
  discardStaleHost(host);
  addPrepared(interstitialAds, adUnitId, host, () => host.createInterstitialAd({ adUnitId }), count, loadMode);
}

export function prewarmInterstitialPlacements(adUnitIds: string[], loadMode: AdLoadMode = 'EXPLICIT_LOAD') {
  const ids = isV006Release() && getAdPlatform() !== 'android' ? adUnitIds.slice(0, 1) : adUnitIds;
  for (const id of ids) prewarmInterstitialAd(id, 1, loadMode);
}

export function getInterstitialAd(adUnitId: string, prewarmNext = true, loadMode: AdLoadMode = 'EXPLICIT_LOAD') {
  const host = window.TTMinis;
  if (!host) throw new Error('TIKTOK_MINIS_UNAVAILABLE');
  const pool = loadMode === 'DIRECT_SHOW' ? undefined : interstitialAds.get(adUnitId);
  const prepared = pool?.find((item) => item.host === host && item.loadMode === loadMode);
  const refillNow = prewarmNext && !(isV006Release() && getAdPlatform() === 'android');
  if (prepared) pool?.splice(pool.indexOf(prepared), 1);
  if (pool && pool.length === 0) interstitialAds.delete(adUnitId);
  if (prepared && prepared.host === host) {
    if (refillNow) prewarmInterstitialAd(adUnitId, 1, loadMode);
    return prepared.ad;
  }
  const ad = host.createInterstitialAd({ adUnitId });
  captureClientTrace('SDK_CALL', 'createInterstitialAd', { adUnitId, loadMode }, { placementId: adUnitId });
  prepare(ad, host, loadMode, adUnitId);
  if (refillNow) prewarmInterstitialAd(adUnitId, 1, loadMode);
  return ad;
}

export function releaseInterstitialAd(adUnitId: string, ad: InterstitialAd) {
  disposedAds.add(ad);
  const pool = interstitialAds.get(adUnitId);
  if (pool) {
    const remaining = pool.filter((item) => item.ad !== ad);
    if (remaining.length) interstitialAds.set(adUnitId, remaining);
    else interstitialAds.delete(adUnitId);
  }
  readiness.delete(ad);
  try { ad.destroy?.(); } catch { /* SDK cleanup is best effort. */ }
}

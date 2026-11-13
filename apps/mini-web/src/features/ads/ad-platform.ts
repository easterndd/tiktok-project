export type AdPlatform = 'ios' | 'android' | 'unknown';
export type AdLoadMode = 'DIRECT_SHOW' | 'EXPLICIT_LOAD';

function releaseIdFromEnv() {
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  return typeof env?.VITE_MINI_RELEASE_ID === 'string' ? env.VITE_MINI_RELEASE_ID : 'default';
}

export function getMiniReleaseId() {
  return releaseIdFromEnv();
}

function runtimeInfo() {
  try {
    const minis = window.TTMinis as unknown as {
      getSystemInfoSync?: () => Record<string, unknown>;
      game?: { getSystemInfoSync?: () => Record<string, unknown> };
    } | undefined;
    return minis?.game?.getSystemInfoSync?.() ?? minis?.getSystemInfoSync?.() ?? {};
  } catch {
    return {};
  }
}

export function getAdPlatform(): AdPlatform {
  const info = runtimeInfo();
  const value = String(info.platform ?? info.OS ?? '').toLowerCase();
  if (value.includes('ios')) return 'ios';
  if (value.includes('android')) return 'android';
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent.toLowerCase();
  if (userAgent.includes('iphone') || userAgent.includes('ipad') || userAgent.includes('ios')) return 'ios';
  if (userAgent.includes('android')) return 'android';
  return 'unknown';
}

export function isV006Release(releaseId = releaseIdFromEnv()) {
  return /(?:^|-)v006(?:-|$)/i.test(releaseId);
}

export function isV006DualRelease(releaseId = releaseIdFromEnv()) {
  return /(?:^|-)v006-dual(?:-|$)/i.test(releaseId);
}

export function getDefaultAdLoadMode(_platform = getAdPlatform(), _releaseId = releaseIdFromEnv()): AdLoadMode {
  return 'EXPLICIT_LOAD';
}

export function isMiniPageVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

let visibilityListenerRegistered = false;
let nativeForegroundListenerRegistered = false;
let nativeForegroundRetryTimer: ReturnType<typeof setTimeout> | undefined;
let nativeForegroundRetries = 0;
let foregroundEpoch = 0;
const foregroundWaiters = new Set<() => void>();
const foregroundSubscribers = new Set<() => void>();

function notifyForeground() {
  foregroundEpoch += 1;
  for (const resolve of foregroundWaiters) resolve();
  foregroundWaiters.clear();
  for (const listener of foregroundSubscribers) listener();
}

function registerForegroundListener(retrying = false) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!visibilityListenerRegistered) {
    visibilityListenerRegistered = true;
    document.addEventListener('visibilitychange', () => {
      if (isMiniPageVisible()) notifyForeground();
    });
  }
  if (nativeForegroundListenerRegistered) return;
  if (!retrying && nativeForegroundRetries >= 20) nativeForegroundRetries = 0;
  if (window.TTMinis) {
    try {
      if (window.TTMinis.on) {
        window.TTMinis.on('minis.show', () => notifyForeground());
        nativeForegroundListenerRegistered = true;
      } else if (window.TTMinis.onShow) {
        window.TTMinis.onShow(() => notifyForeground());
        nativeForegroundListenerRegistered = true;
      }
    } catch {
      try {
        if (window.TTMinis.onShow) {
          window.TTMinis.onShow(() => notifyForeground());
          nativeForegroundListenerRegistered = true;
        }
      } catch { /* Lifecycle events vary by runtime. */ }
    }
  }
  if (nativeForegroundListenerRegistered) {
    if (nativeForegroundRetryTimer) clearTimeout(nativeForegroundRetryTimer);
    nativeForegroundRetryTimer = undefined;
  } else if (!nativeForegroundRetryTimer && nativeForegroundRetries < 20) {
    nativeForegroundRetries += 1;
    nativeForegroundRetryTimer = setTimeout(() => {
      nativeForegroundRetryTimer = undefined;
      registerForegroundListener(true);
    }, 250);
  }
}

export function subscribeMiniForeground(listener: () => void) {
  foregroundSubscribers.add(listener);
  registerForegroundListener();
  return () => { foregroundSubscribers.delete(listener); };
}

export async function waitForMiniForeground(timeoutMs = 5_000) {
  registerForegroundListener();
  if (isMiniPageVisible()) return true;
  const startEpoch = foregroundEpoch;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (visible: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      foregroundWaiters.delete(onForeground);
      resolve(visible);
    };
    const onForeground = () => {
      if (foregroundEpoch > startEpoch && isMiniPageVisible()) finish(true);
    };
    const timer = setTimeout(() => finish(isMiniPageVisible()), timeoutMs);
    foregroundWaiters.add(onForeground);
  });
}

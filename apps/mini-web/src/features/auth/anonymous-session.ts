import { apiClient, registerUnauthorizedHandler } from '../../lib/api-client';
import { clearSessionToken, getOrCreateVisitorKey, getSessionToken, isDemoMode, setSessionToken } from '../../lib/storage';
import { storagePrefix } from '../../lib/app-brand';
import { getMiniLaunchContext, getMiniLaunchIds, rememberSdkLaunchPayload, setMiniLaunchRef, stringifySdkPayload } from '../../lib/launch-context';
import { getLocalEntryAdPlacementIds } from '../ads/entry-ad-placements';
import { isLaunchAttributionRelease } from '../ads/ad-platform';
import { recordLaunchAttribution } from '../../lib/analytics';

let pendingSession: Promise<void> | null = null;
let pendingTikTokSession: Promise<void> | null = null;
let pendingLaunchRecord: Promise<MiniLaunchRecordResult> | null = null;
let launchRecordResult: MiniLaunchRecordResult | undefined;
const entryId = getMiniLaunchIds().entryId;
let lastSdkPayloadRaw = '';
let sdkLaunchListenerInstalled = false;

export type MiniLaunchRecordResult = {
  saved: boolean;
  launchRef?: string;
  launchId?: string;
  attribution?: { status: string; reason: string; signalStatus: string };
  entryAdEligibility?: { showEntryAd: boolean; reason?: string };
};

export function getMiniLaunchRecordResult() {
  return launchRecordResult;
}

function localEntryLaunchFields() {
  const releaseId = import.meta.env.VITE_MINI_RELEASE_ID || 'default';
  return getLocalEntryAdPlacementIds().length === 2 ? { localEntryAd: true, releaseId } : { releaseId };
}

export function installTikTokLaunchListener() {
  if (sdkLaunchListenerInstalled || typeof window === 'undefined') return;
  const minis = window.TTMinis;
  const listener = (payload?: TikTokMiniDramaShowPayload) => {
    if (payload !== undefined) rememberSdkLaunchPayload(payload);
    const raw = stringifySdkPayload(payload);
    if (raw) void recordMiniLaunch(raw).catch(() => undefined);
  };
  let onShowSupported = typeof minis?.onShow === 'function';
  try { onShowSupported = onShowSupported && (typeof minis?.canIUse !== 'function' || minis.canIUse('onShow.callback') !== false); } catch { /* Older drama clients may not expose canIUse. */ }
  try {
    if (onShowSupported) minis!.onShow!(listener);
    else if (typeof minis?.on === 'function') minis.on('minis.show', listener);
    else return;
    sdkLaunchListenerInstalled = true;
  } catch { /* The SDK can be injected without lifecycle support in browser previews. */ }
}

function getOrCreateClientSessionId() {
  const key = `${storagePrefix}_app_session_id`;
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const value = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `session-${Date.now()}`;
  sessionStorage.setItem(key, value);
  return value;
}

export async function ensureAnonymousSession(options: { force?: boolean } = {}) {
  if (!options.force && getSessionToken()) return;
  if (isDemoMode()) {
    setSessionToken('mock-business-session');
    return;
  }
  if (!pendingSession) {
    const launchContext = getMiniLaunchContext();
    pendingSession = apiClient.post<{ accessToken: string }>('/auth/anonymous/session', {
      visitorKey: getOrCreateVisitorKey(),
      clientSessionId: getOrCreateClientSessionId(),
      platform: window.TTMinis ? 'TIKTOK_MINIS' : 'WEB',
      clientVersion: import.meta.env.VITE_APP_VERSION || undefined,
      source: launchContext.launchScene || 'APP_LAUNCH',
      launchContext: { ...launchContext, ...getMiniLaunchIds(), entryId, releaseId: import.meta.env.VITE_MINI_RELEASE_ID || 'default' }
    })
      .then((session) => setSessionToken(session.accessToken))
      .finally(() => { pendingSession = null; });
  }
  return pendingSession;
}

export async function recordMiniLaunch(sdkPayloadRaw?: string) {
  if (isDemoMode()) return { saved: false };
  if (pendingLaunchRecord) await pendingLaunchRecord;
  if (sdkPayloadRaw ? sdkPayloadRaw === lastSdkPayloadRaw : Boolean(launchRecordResult)) return launchRecordResult!;
  const pending = (async () => {
    await ensureAnonymousSession();
    const result = await apiClient.post<MiniLaunchRecordResult>('/auth/launch-context', {
      ...getMiniLaunchContext(), ...localEntryLaunchFields(), entryId, launchId: getMiniLaunchIds().launchId,
      ...(sdkPayloadRaw ? { sdkPayloadRaw } : {})
    });
    setMiniLaunchRef(result.launchRef);
    if (sdkPayloadRaw) lastSdkPayloadRaw = sdkPayloadRaw;
    launchRecordResult = result;
    if (isLaunchAttributionRelease()) recordLaunchAttribution({ saved: result.saved, launchRef: result.launchRef,
      status: result.attribution?.status, reason: result.attribution?.reason, signalStatus: result.attribution?.signalStatus });
    return result;
  })();
  pendingLaunchRecord = pending;
  try { return await pending; }
  finally { if (pendingLaunchRecord === pending) pendingLaunchRecord = null; }
}

function getTikTokLoginCode() {
  const login = window.TTMinis?.login;
  if (!login) return Promise.reject(new Error('TIKTOK_LOGIN_UNAVAILABLE'));
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, code?: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (error || !code) reject(error ?? new Error('TIKTOK_LOGIN_CODE_MISSING'));
      else resolve(code);
    };
    const timeout = window.setTimeout(() => finish(new Error('TIKTOK_LOGIN_TIMEOUT')), 12_000);
    try {
      const result = login.call(window.TTMinis, {
      success: (value) => finish(undefined, value?.authResponse?.code ?? value?.code),
        fail: (error) => finish(error)
      });
      if (result && typeof result.then === 'function') {
        void result.then((value) => finish(undefined, value?.authResponse?.code ?? value?.code), (error: unknown) => finish(error));
      }
    } catch (error) {
      finish(error);
    }
  });
}

export async function ensureTikTokSession() {
  if (!window.TTMinis?.login || isDemoMode()) return;
  if (!pendingTikTokSession) {
    pendingTikTokSession = (async () => {
      await ensureAnonymousSession();
      const code = await getTikTokLoginCode();
      const session = await apiClient.post<{ accessToken: string }>('/auth/tiktok/session', {
        code,
        clientSessionId: getOrCreateClientSessionId(),
        clientVersion: import.meta.env.VITE_APP_VERSION || undefined
      });
      setSessionToken(session.accessToken);
    })().finally(() => { pendingTikTokSession = null; });
  }
  return pendingTikTokSession;
}

registerUnauthorizedHandler(async () => {
  clearSessionToken();
  await ensureAnonymousSession({ force: true });
  await ensureTikTokSession().catch(() => undefined);
});

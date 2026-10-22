import { apiClient, registerUnauthorizedHandler } from '../../lib/api-client';
import { clearSessionToken, getOrCreateVisitorKey, getSessionToken, isDemoMode, setSessionToken } from '../../lib/storage';
import { storagePrefix } from '../../lib/app-brand';
import { getMiniLaunchContext } from '../../lib/launch-context';

let pendingSession: Promise<void> | null = null;
let pendingTikTokSession: Promise<void> | null = null;
let pendingLaunchRecord: Promise<void> | null = null;
const entryId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `entry-${Date.now()}-${Math.random()}`;
let lastSdkPayloadRaw = '';

function createLaunchEntryId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `entry-${Date.now()}-${Math.random()}`;
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
      launchContext: { ...launchContext, entryId }
    })
      .then((session) => setSessionToken(session.accessToken))
      .finally(() => { pendingSession = null; });
  }
  return pendingSession;
}

export async function recordMiniLaunch(sdkPayloadRaw?: string) {
  if (isDemoMode()) return;
  if (sdkPayloadRaw) {
    if (sdkPayloadRaw === lastSdkPayloadRaw) return;
    const launchEntryId = lastSdkPayloadRaw ? createLaunchEntryId() : entryId;
    await ensureAnonymousSession();
    await apiClient.post('/auth/launch-context', { ...getMiniLaunchContext(), entryId: launchEntryId, sdkPayloadRaw });
    lastSdkPayloadRaw = sdkPayloadRaw;
    return;
  }
  if (!pendingLaunchRecord) {
    pendingLaunchRecord = (async () => {
      await ensureAnonymousSession();
      await apiClient.post('/auth/launch-context', { ...getMiniLaunchContext(), entryId });
    })().finally(() => { pendingLaunchRecord = null; });
  }
  return pendingLaunchRecord;
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
        success: (value) => finish(undefined, value?.code),
        fail: (error) => finish(error)
      });
      if (result && typeof result.then === 'function') {
        void result.then((value) => finish(undefined, value?.code), (error: unknown) => finish(error));
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

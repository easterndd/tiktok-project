import { apiClient, registerUnauthorizedHandler } from '../../lib/api-client';
import { clearSessionToken, getOrCreateVisitorKey, getSessionToken, isDemoMode, setSessionToken } from '../../lib/storage';

let pendingSession: Promise<void> | null = null;

function getOrCreateClientSessionId() {
  const key = 'quickreels_app_session_id';
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
    pendingSession = apiClient.post<{ accessToken: string }>('/auth/anonymous/session', {
      visitorKey: getOrCreateVisitorKey(),
      clientSessionId: getOrCreateClientSessionId(),
      platform: window.TTMinis ? 'TIKTOK_MINIS' : 'WEB',
      clientVersion: import.meta.env.VITE_APP_VERSION || undefined,
      source: 'APP_LAUNCH'
    })
      .then((session) => setSessionToken(session.accessToken))
      .finally(() => { pendingSession = null; });
  }
  return pendingSession;
}

registerUnauthorizedHandler(async () => {
  clearSessionToken();
  await ensureAnonymousSession({ force: true });
});

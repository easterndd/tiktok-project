import { apiClient } from '../../lib/api-client';
import { isDemoMode, setSessionToken } from '../../lib/storage';

export async function loginWithTikTok() {
  if (isDemoMode()) {
    setSessionToken('mock-business-session');
    return { accessToken: 'mock-business-session', expiresIn: 3600, user: { id: 'mock-user' } };
  }
  if (!window.TTMinis?.login) {
    throw new Error('Open QuicKReeL in TikTok to sign in.');
  }
  const { code } = await window.TTMinis.login();
  const session = await apiClient.post<{ accessToken: string }>('/auth/tiktok/login', { code });
  setSessionToken(session.accessToken);
  return session;
}

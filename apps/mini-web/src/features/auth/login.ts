import { apiClient } from '../../lib/api-client';

export async function loginWithTikTok() {
  if (!window.TTMinis) throw new Error('Open BreezeReels in TikTok to sign in.');
  const { code } = await window.TTMinis.login();
  const session = await apiClient.post<{ accessToken: string }>('/auth/tiktok/login', { code });
  sessionStorage.setItem('breezereels_access_token', session.accessToken);
}

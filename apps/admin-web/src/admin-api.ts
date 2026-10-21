export function createAdminApi(API: string, adminTokenStorageKey: string, platformSubmissionStorageKey: string, onUnauthorized: () => void, multiAppKeys: readonly string[] = []) {
let adminSessionRecoveryStarted = false;
async function api<T>(path: string, options: RequestInit = {}) {
  const token = sessionStorage.getItem(adminTokenStorageKey);
  const appTokens = Object.fromEntries(multiAppKeys.filter((key) => key !== (adminTokenStorageKey === 'quickreels_admin_token' ? 'main' : adminTokenStorageKey.slice('quickreels_'.length, -'_admin_token'.length))).flatMap((miniAppKey) => {
    const storageKey = miniAppKey === 'main' ? 'quickreels_admin_token' : `quickreels_${miniAppKey}_admin_token`;
    const value = sessionStorage.getItem(storageKey);
    return value ? [[miniAppKey, value]] : [];
  }));
  const isFormData = options.body instanceof FormData;
  let response: Response;
  try {
    const requestOptions: RequestInit = {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(isFormData || options.body == null ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(Object.keys(appTokens).length ? { 'X-Multi-App-Tokens': JSON.stringify(appTokens) } : {}),
        ...options.headers
      }
    };
    response = await fetch(`${API}${path}`, requestOptions);
    if (response.status === 429 && (options.method ?? 'GET').toUpperCase() === 'GET') {
      const retryAfter = response.headers.get('Retry-After');
      const seconds = Number(retryAfter);
      if (retryAfter !== null && Number.isFinite(seconds) && seconds >= 0 && seconds <= 15) {
        await new Promise((resolve) => window.setTimeout(resolve, Math.max(1, seconds) * 1_000));
        response = await fetch(`${API}${path}`, requestOptions);
      }
    }
  } catch {
    throw new Error('无法连接后台 API，请检查 API 服务、域名和网络连接。');
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => null))?.error;
    const message = `${failure?.message ?? '请求失败'}${failure?.requestId ? `（请求 ID：${failure.requestId}）` : ''}`;
    // The login endpoint deliberately returns 401 for incorrect credentials. Every
    // other 401 means the active administrator session can no longer be used.
    if (response.status === 401 && path !== '/admin/auth/login') {
      sessionStorage.removeItem(adminTokenStorageKey);
      sessionStorage.removeItem(platformSubmissionStorageKey);
      if (!adminSessionRecoveryStarted) {
        adminSessionRecoveryStarted = true;
        onUnauthorized();
      }
      throw new Error('管理员登录已失效，正在返回登录页。');
    }
    throw new Error(message);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}


return api;
}

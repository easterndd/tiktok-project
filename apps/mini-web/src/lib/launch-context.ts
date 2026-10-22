const sensitiveParameter = /(?:token|auth|secret|password|email|phone|openid|open_id|user.?id|username|uid|visitor|session|credential|code|url|redirect|callback)/i;
const maxQueryEntries = 32;
let initialWebviewUrl = typeof window === 'undefined' ? '' : window.location.href;

function safeQuery(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value).slice(0, maxQueryEntries)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || sensitiveParameter.test(key)) continue;
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue;
    const normalized = String(raw).trim().slice(0, 128);
    if (!normalized || /(?:https?:\/\/|www\.)/i.test(normalized)) continue;
    result[key] = normalized;
  }
  return result;
}

export function getMiniLaunchContext() {
  initialWebviewUrl ||= window.location.href;
  let options: { scene?: unknown; query?: unknown } | undefined;
  try {
    options = window.TTMinis?.game?.getLaunchOptionsSync?.()
      ?? window.TTMinis?.game?.getEnterOptionsSync?.();
  } catch {
    options = undefined;
  }
  const scene = typeof options?.scene === 'string' ? options.scene.trim().slice(0, 64) : '';
  const query = safeQuery(options?.query);
  try {
    for (const [key, value] of new URLSearchParams(window.location.search)) {
      if (!(key in query)) Object.assign(query, safeQuery({ [key]: value }));
    }
  } catch {
    // Launch parameters are optional in browser previews.
  }
  return {
    launchScene: scene || undefined,
    launchPath: window.location.pathname.slice(0, 256) || '/',
    launchQuery: query,
    rawUrl: initialWebviewUrl || undefined
  };
}

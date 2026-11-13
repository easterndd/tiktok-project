const sensitiveParameter = /(?:token|auth|secret|password|email|phone|openid|open_id|user.?id|username|uid|visitor|session|credential|code|url|redirect|callback)/i;
const maxQueryEntries = 32;
let initialWebviewUrl = typeof window === 'undefined' ? '' : window.location.href;
let sdkLaunchPayload: TikTokMiniDramaShowPayload | undefined;
function newLaunchUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

const launchId = newLaunchUuid();
const entryId = newLaunchUuid();
let miniLaunchRef: string | undefined;
export const campaignLaunchOptionsEvent = 'quickreels:campaign-launch-options';

export function getMiniLaunchIds() {
  return { launchId, entryId };
}

export function setMiniLaunchRef(value?: string) {
  miniLaunchRef = value;
}

export function getMiniLaunchRef() {
  return miniLaunchRef;
}

function readInitialSdkLaunchPayload() {
  const minis = window.TTMinis;
  const sources = [minis?.game, minis];
  for (const source of sources) {
    for (const method of ['getEnterOptionsSync', 'getLaunchOptionsSync'] as const) {
      try {
        const payload = source?.[method]?.();
        if (payload && typeof payload === 'object') return payload;
      } catch {
        // Older TikTok clients may not support synchronous launch options.
      }
    }
  }
  return undefined;
}

export function rememberSdkLaunchPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  sdkLaunchPayload = payload as TikTokMiniDramaShowPayload;
  if (typeof window !== 'undefined') window.dispatchEvent?.(new Event(campaignLaunchOptionsEvent));
}

export function stringifySdkPayload(payload: unknown) {
  try {
    const raw = JSON.stringify(payload);
    return raw && raw.length <= 32768 ? raw : '';
  } catch {
    return '';
  }
}

function safeQuery(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value).slice(0, maxQueryEntries)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || sensitiveParameter.test(key)) continue;
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue;
    const normalized = String(raw).trim();
    if (normalized.length > 4096) continue;
    if (!normalized || /(?:https?:\/\/|www\.)/i.test(normalized)) continue;
    result[key] = normalized;
  }
  return result;
}

export function getMiniLaunchContext() {
  initialWebviewUrl ||= window.location.href;
  if (!sdkLaunchPayload) rememberSdkLaunchPayload(readInitialSdkLaunchPayload());
  const rawScene = sdkLaunchPayload?.scene ?? sdkLaunchPayload?.launch_from;
  const scene = typeof rawScene === 'string' ? rawScene.trim().slice(0, 64) : '';
  const query = safeQuery(sdkLaunchPayload?.query);
  let webviewBase: string | undefined;
  try {
    const currentUrl = new URL(window.location.href);
    webviewBase = `${currentUrl.origin}${currentUrl.pathname}`.slice(0, 512);
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
    webviewBase,
    rawUrl: initialWebviewUrl || undefined
  };
}

export function getCampaignEntryTarget() {
  const query = getMiniLaunchContext().launchQuery;
  const normalized = new Map(Object.entries(query).map(([key, value]) => [key.toLowerCase().replace(/[_-]/g, ''), value]));
  const albumId = normalized.get('albumid');
  const episodeId = normalized.get('episodeid');
  if (!albumId || !episodeId || !/^\d{1,32}$/.test(albumId) || !/^\d{1,32}$/.test(episodeId)) return null;
  return { albumId, episodeId };
}

export function hasCampaignEntryIntent() {
  const query = getMiniLaunchContext().launchQuery;
  return Object.keys(query).some((key) => {
    const normalized = key.toLowerCase().replace(/[_-]/g, '');
    return normalized === 'albumid' || normalized === 'episodeid';
  });
}

export function getMiniLaunchAdId() {
  const query = getMiniLaunchContext().launchQuery;
  const entry = Object.entries(query).find(([key]) => key.toLowerCase().replace(/[_-]/g, '') === 'adid');
  return entry?.[1] ?? null;
}

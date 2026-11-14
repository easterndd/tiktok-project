export type LaunchAttributionStatus = 'ATTRIBUTED' | 'UNATTRIBUTED' | 'AD_ID_CONFLICT' | 'INVALID';

export type LaunchAttribution = {
  status: LaunchAttributionStatus;
  adId: string | null;
  reason: 'VALID_AD_ID' | 'MISSING_AD_ID' | 'EMPTY_OR_PLACEHOLDER_AD_ID' | 'AD_ID_CONFLICT' | 'INVALID_AD_ID';
  signalStatus: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'INVALID';
};

const adIdKey = (key: string) => key.toLowerCase().replace(/[_-]/g, '') === 'adid';

function isPlaceholder(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || ['0', 'null', 'undefined', 'none', 'n/a', 'na', 'adid', 'ad_id', 'ad-id', 'placeholder'].includes(normalized)) return true;
  return normalized.includes('__') || /\{\{.*\}\}|\$\{.*\}|<[^>]+>|\[[^\]]*placeholder[^\]]*\]/i.test(normalized)
    || /^(?:your|replace)[_-]/i.test(normalized);
}

function queryEntries(input: unknown) {
  const values: string[] = [];
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input)) {
      if (adIdKey(key)) {
        if (typeof value === 'string') values.push(value);
        else if (Array.isArray(value)) values.push(...value.filter((entry): entry is string => typeof entry === 'string'));
      }
    }
  }
  return values;
}

export function classifyLaunchAttribution(input: unknown): LaunchAttribution {
  const metadata = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const values = queryEntries(metadata.launchQuery);
  if (typeof metadata.rawUrl === 'string' && metadata.rawUrl.trim()) {
    try {
      const url = new URL(metadata.rawUrl);
      for (const [key, value] of url.searchParams) if (adIdKey(key)) values.push(value);
    } catch {
      // Keep the launchQuery fallback when an old record has an invalid URL.
    }
  }
  if (typeof metadata.sdkPayloadRaw === 'string') {
    try {
      const sdkPayload = JSON.parse(metadata.sdkPayloadRaw) as { query?: unknown };
      values.push(...queryEntries(sdkPayload.query));
    } catch {
      // Invalid SDK snapshots are retained as evidence but never trusted for attribution.
    }
  }

  const valid = [...new Set(values.map((value) => value.trim()).filter((value) => !isPlaceholder(value)))];
  if (valid.length > 1) return { status: 'AD_ID_CONFLICT', adId: null, reason: 'AD_ID_CONFLICT', signalStatus: 'INVALID' };
  if (valid.length === 1) {
    const adId = valid[0];
    if (adId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(adId)) return { status: 'INVALID', adId: null, reason: 'INVALID_AD_ID', signalStatus: 'INVALID' };
    return { status: 'ATTRIBUTED', adId, reason: 'VALID_AD_ID', signalStatus: 'AVAILABLE' };
  }
  if (values.length) return { status: 'UNATTRIBUTED', adId: null, reason: 'EMPTY_OR_PLACEHOLDER_AD_ID', signalStatus: 'PARTIAL' };
  return { status: 'UNATTRIBUTED', adId: null, reason: 'MISSING_AD_ID', signalStatus: 'UNAVAILABLE' };
}

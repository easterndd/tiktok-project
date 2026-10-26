export type LaunchAttributionStatus = 'ATTRIBUTED' | 'UNATTRIBUTED';

export type LaunchAttribution = {
  status: LaunchAttributionStatus;
  adId: string | null;
  reason: 'VALID_AD_ID' | 'MISSING_AD_ID' | 'EMPTY_OR_PLACEHOLDER_AD_ID';
};

const adIdKey = (key: string) => key.toLowerCase().replace(/[_-]/g, '') === 'adid';

function isPlaceholder(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || ['0', 'null', 'undefined', 'none', 'n/a', 'na', 'adid', 'ad_id', 'ad-id', 'placeholder'].includes(normalized)) return true;
  return normalized.includes('__') || /\{\{.*\}\}|\$\{.*\}|<[^>]+>|\[[^\]]*placeholder[^\]]*\]/i.test(normalized)
    || /^(?:your|replace)[_-]/i.test(normalized);
}

function queryValues(input: unknown) {
  const values: string[] = [];
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input)) {
      if (adIdKey(key) && typeof value === 'string') values.push(value);
    }
  }
  return values;
}

export function classifyLaunchAttribution(input: unknown): LaunchAttribution {
  const metadata = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const values = queryValues(metadata.launchQuery);
  if (typeof metadata.rawUrl === 'string' && metadata.rawUrl.trim()) {
    try {
      const url = new URL(metadata.rawUrl);
      for (const [key, value] of url.searchParams) if (adIdKey(key)) values.unshift(value);
    } catch {
      // Keep the launchQuery fallback when an old record has an invalid URL.
    }
  }

  if (!values.length) return { status: 'UNATTRIBUTED', adId: null, reason: 'MISSING_AD_ID' };
  const adId = values.find((value) => !isPlaceholder(value))?.trim() ?? null;
  if (!adId) return { status: 'UNATTRIBUTED', adId: null, reason: 'EMPTY_OR_PLACEHOLDER_AD_ID' };
  return { status: 'ATTRIBUTED', adId, reason: 'VALID_AD_ID' };
}

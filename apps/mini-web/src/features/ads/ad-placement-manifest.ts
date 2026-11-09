import { appKey } from '../../lib/app-brand';
import { isV006Release } from './ad-platform';

export type AdPlacementType = 'REWARDED' | 'INTERSTITIAL';

function parseIds(value: unknown) {
  if (typeof value !== 'string') return [];
  const ids = value.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length > 2 || ids.some((id) => !/^ad\d{8,32}$/.test(id)) || new Set(ids).size !== ids.length) return [];
  return ids;
}

export function getPublicAdPlacementIds(type: AdPlacementType) {
  if (isV006Release()) {
    return parseIds(type === 'REWARDED'
      ? import.meta.env.VITE_REWARDED_AD_UNIT_IDS
      : import.meta.env.VITE_INTERSTITIAL_AD_UNIT_IDS);
  }
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  const key = type === 'REWARDED' ? 'VITE_REWARDED_AD_UNIT_IDS' : 'VITE_INTERSTITIAL_AD_UNIT_IDS';
  const appSpecificKey = type === 'REWARDED' ? `VITE_${appKey.toUpperCase()}_REWARDED_AD_UNIT_IDS` : `VITE_${appKey.toUpperCase()}_INTERSTITIAL_AD_UNIT_IDS`;
  const appSpecific = parseIds(env?.[appSpecificKey]);
  return appSpecific.length ? appSpecific : parseIds(env?.[key]);
}

export function restrictToPublicManifest(type: AdPlacementType, serverAllowedIds: string[]) {
  const publicIds = getPublicAdPlacementIds(type);
  if (!publicIds.length) return isV006Release() ? [] : [...new Set(serverAllowedIds)];
  return serverAllowedIds.filter((id) => publicIds.includes(id));
}

export function validatePublicManifestIds(value: unknown) {
  return typeof value === 'string' && parseIds(value).length === value.split(',').filter(Boolean).length;
}

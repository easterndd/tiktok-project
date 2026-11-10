import type { AdPlatform } from './ad-platform';

export function selectAdPlacement(primaryId: string, allowedIds: string[], adIndex: number, platform: AdPlatform, v006: boolean) {
  if (!v006 || platform !== 'android' || allowedIds.length < 2 || !allowedIds.includes(primaryId)) return primaryId;
  return allowedIds[(Math.max(1, adIndex) - 1) % allowedIds.length];
}

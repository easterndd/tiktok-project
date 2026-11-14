import { supportsV006DualApp } from '../ads/ad-placement-policy';

const attributionPilotApps = new Set(['zenclip', 'storyworld', 'dailyreel', 'elitedrama', 'sonicreel', 'orbitplay']);

export function isAttributionPilotRelease(appKey: string, releaseId: string) {
  return attributionPilotApps.has(appKey) && releaseId.startsWith(`${appKey}-attr1-`);
}

export function supportsLaunchAttribution(appKey: string, releaseId: string) {
  return (supportsV006DualApp(appKey) && releaseId.startsWith(`${appKey}-v006-dual-`))
    || isAttributionPilotRelease(appKey, releaseId);
}

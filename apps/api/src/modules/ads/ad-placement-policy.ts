import type { AdPlacementPair, AdType } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

export type AdClientPlatform = 'ios' | 'android' | 'unknown';
export type AdLoadMode = 'DIRECT_SHOW' | 'EXPLICIT_LOAD';
export type ResolvedAdPlacementPolicy = {
  placementIds: string[];
  version: number;
  adLoadMode: AdLoadMode;
  strategyVariant: string;
  iosLoadMode: AdLoadMode;
  androidLoadMode: AdLoadMode;
};

const noBackup = (primaryPlacementId: string): ResolvedAdPlacementPolicy => ({
  placementIds: primaryPlacementId ? [primaryPlacementId] : [],
  version: 1,
  adLoadMode: 'EXPLICIT_LOAD',
  strategyVariant: 'CONTROL',
  iosLoadMode: 'EXPLICIT_LOAD',
  androidLoadMode: 'EXPLICIT_LOAD'
});

const v006Placements: Record<string, Partial<Record<AdType, readonly [string, string]>>> = {
  dramaflicks: {
    REWARDED: ['ad7690454033278421044', 'ad7706095388599568385'],
    INTERSTITIAL: ['ad7698625673044428852', 'ad7706108249669732404']
  },
  heartreel: {
    REWARDED: ['ad7690961683200739334', 'ad7698686827641587732'],
    INTERSTITIAL: ['ad7698953713079453717', 'ad7698645910760867861']
  },
  sweetreel: {
    REWARDED: ['ad7690432723417581588', 'ad7706095806566139956'],
    INTERSTITIAL: ['ad7701247035449575444', 'ad7706096223212685313']
  },
  luxereel: {
    REWARDED: ['ad7690856060425275398', 'ad7706097016505403398'],
    INTERSTITIAL: ['ad7706097750135310388', 'ad7706106505217247238']
  }
};

const v006AppIds: Record<string, string> = {
  dramaflicks: '7688943418164119560',
  heartreel: '7694176685453625365',
  sweetreel: '7694176755472418837',
  luxereel: '7694100516736927765'
};

// v0.0.7 uses the same client-managed dual placement protocol as DramaFlicks.
// Primary IDs match the existing production placements for these apps.
const v007Placements: Record<string, Partial<Record<AdType, readonly [string, string]>>> = {
  zenclip: {
    REWARDED: ['ad7695690471826311220', 'ad7706462142492575762'],
    INTERSTITIAL: ['ad7706939601122904085', 'ad7706882520915707924']
  },
  storyworld: {
    REWARDED: ['ad7690424980064389121', 'ad7706898624479889428'],
    INTERSTITIAL: ['ad7706875180212226069', 'ad7706897020931688469']
  },
  dailyreel: {
    REWARDED: ['ad7690436762560169990', 'ad7706885627602585620'],
    INTERSTITIAL: ['ad7707670435895445524', 'ad7706902620980512774']
  },
  elitedrama: {
    REWARDED: ['ad7691072182843131925', 'ad7706873514356705301'],
    INTERSTITIAL: ['ad7708210893989087252', 'ad7706882226866456596']
  },
  sonicreel: {
    REWARDED: ['ad7696851608764467252', 'ad7706882804299401237'],
    INTERSTITIAL: ['ad7698651598784448564', 'ad7706897555599542293']
  },
  orbitplay: {
    REWARDED: ['ad7695711655645317121', 'ad7701602721589561345'],
    INTERSTITIAL: ['ad7698648496551315457', 'ad7707547396834215957']
  }
};

const v007AppIds: Record<string, string> = {
  zenclip: '7695973362471929908',
  storyworld: '7688988654946158599',
  dailyreel: '7688950749593913351',
  elitedrama: '7694143310880966677',
  sonicreel: '7698254187724883989',
  orbitplay: '7695972730596050962'
};

export function supportsV006DualApp(appKey: string) {
  return Object.hasOwn(v006Placements, appKey);
}

export function supportsV007DualApp(appKey: string) {
  return Object.hasOwn(v007Placements, appKey);
}

export function supportsClientDualApp(appKey: string) {
  return supportsV006DualApp(appKey) || supportsV007DualApp(appKey);
}

export function v007InterstitialPrimary(appKey: string, releaseId: string, appId?: string) {
  if (!isV007DualRelease(releaseId) || !releaseId.startsWith(`${appKey}-v007-dual-`)
    || appId !== v007AppIds[appKey]) return null;
  return v007Placements[appKey]?.INTERSTITIAL?.[0] ?? null;
}

const pairCacheTtlMs = 5_000;
const pairCache = new WeakMap<FastifyInstance, Map<string, { pair: AdPlacementPair | null; expiresAt: number }>>();

export function invalidateAdPlacementPolicyCache(app: FastifyInstance) {
  pairCache.delete(app);
}

async function findPlacementPair(app: FastifyInstance, input: { releaseId: string; adType: AdType; primaryPlacementId: string }) {
  const key = `${input.releaseId}:${input.adType}:${input.primaryPlacementId}`;
  let cache = pairCache.get(app);
  if (!cache) {
    cache = new Map();
    pairCache.set(app, cache);
  }
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.pair;
  const exact = await app.prisma.adPlacementPair.findUnique({
    where: { releaseId_adType_primaryPlacementId: { releaseId: input.releaseId, adType: input.adType, primaryPlacementId: input.primaryPlacementId } }
  });
  const pair = exact ?? await app.prisma.adPlacementPair.findUnique({
    where: { releaseId_adType_primaryPlacementId: { releaseId: '*', adType: input.adType, primaryPlacementId: input.primaryPlacementId } }
  });
  if (pairCache.get(app) === cache) cache.set(key, { pair, expiresAt: Date.now() + pairCacheTtlMs });
  return pair;
}

export function assertV006PlacementPair(appKey: string, input: {
  releaseId: string; adType: AdType; primaryPlacementId: string; backupPlacementId: string | null; enabled: boolean;
}, appId?: string) {
  const v007 = supportsV007DualApp(appKey);
  const expected = (v007 ? v007Placements : v006Placements)[appKey]?.[input.adType];
  const expectedAppId = (v007 ? v007AppIds : v006AppIds)[appKey];
  if (!expected || (input.releaseId !== '*' && !input.releaseId.startsWith(`${appKey}-${v007 ? 'v007' : 'v006'}-`))
    || input.primaryPlacementId !== expected[0] || (input.backupPlacementId !== null && input.backupPlacementId !== expected[1])
    || (input.enabled && (input.backupPlacementId !== expected[1] || appId !== expectedAppId))) {
    throw Object.assign(new Error('The placement pair does not match this mini app, release and ad type.'), { statusCode: 400 });
  }
}

export function isV006Release(releaseId: string) {
  return /(?:^|-)v006(?:-|$)/i.test(releaseId);
}

export function isV006DualRelease(releaseId: string) {
  return /(?:^|-)v006-dual(?:-|$)/i.test(releaseId);
}

export function isV007DualRelease(releaseId: string) {
  return /(?:^|-)v007-dual(?:-|$)/i.test(releaseId);
}

export function isEnhancedAdRelease(releaseId: string) {
  return isV006Release(releaseId) || isV007DualRelease(releaseId);
}

export function isClientDualRelease(releaseId: string) {
  return isV006DualRelease(releaseId) || isV007DualRelease(releaseId);
}

function isClientPairedRelease(releaseId: string) {
  return isClientDualRelease(releaseId);
}

export async function resolveAdPlacementPolicy(app: FastifyInstance, input: {
  releaseId: string;
  adType: AdType;
  primaryPlacementId: string;
  platform?: AdClientPlatform;
}): Promise<ResolvedAdPlacementPolicy> {
  const base = noBackup(input.primaryPlacementId);
  if (!isEnhancedAdRelease(input.releaseId) || !input.primaryPlacementId) return base;

  if (isClientPairedRelease(input.releaseId)) {
    const appKey = app.config.MINI_APP_KEY;
    const v007 = isV007DualRelease(input.releaseId);
    const expected = (v007 ? v007Placements : v006Placements)[appKey]?.[input.adType];
    const expectedAppId = (v007 ? v007AppIds : v006AppIds)[appKey];
    if (!expected || app.config.TIKTOK_APP_ID !== expectedAppId
      || !input.releaseId.startsWith(`${appKey}-${v007 ? 'v007' : 'v006'}-dual-`)
      || input.primaryPlacementId !== expected[0]) return base;
    return {
      placementIds: [...expected],
      version: 1,
      adLoadMode: 'EXPLICIT_LOAD',
      strategyVariant: input.platform === 'android' ? 'ANDROID_DUAL_CLIENT' : input.platform === 'ios' ? 'IOS_SINGLE_CLIENT' : 'SINGLE_CLIENT',
      iosLoadMode: 'EXPLICIT_LOAD',
      androidLoadMode: 'EXPLICIT_LOAD'
    };
  }

  const pair = await findPlacementPair(app, input);
  if (!pair?.enabled) return base;
  try {
    assertV006PlacementPair(app.config.MINI_APP_KEY, {
      releaseId: pair.releaseId, adType: input.adType, primaryPlacementId: pair.primaryPlacementId,
      backupPlacementId: pair.backupPlacementId, enabled: pair.enabled
    }, app.config.TIKTOK_APP_ID);
  } catch {
    return base;
  }

  const iosLoadMode = pair.iosLoadMode === 'EXPLICIT_LOAD' ? 'EXPLICIT_LOAD' : 'DIRECT_SHOW';
  const androidLoadMode = pair.androidLoadMode === 'DIRECT_SHOW' ? 'DIRECT_SHOW' : 'EXPLICIT_LOAD';
  const experimentUsesDirect = iosLoadMode === 'DIRECT_SHOW' && Math.random() * 100 < pair.iosExperimentPercent;
  const adLoadMode = input.platform === 'ios'
    ? experimentUsesDirect ? 'DIRECT_SHOW' : 'EXPLICIT_LOAD'
    : input.platform === 'android' ? androidLoadMode : 'EXPLICIT_LOAD';
  const placementIds = [input.primaryPlacementId];
  if (input.platform === 'android' && pair.backupPlacementId && pair.backupPlacementId !== input.primaryPlacementId) placementIds.push(pair.backupPlacementId);
  return {
    placementIds,
    version: pair.version,
    adLoadMode,
    strategyVariant: input.platform === 'ios' && iosLoadMode === 'DIRECT_SHOW' && pair.iosExperimentPercent > 0
      ? experimentUsesDirect ? 'IOS_DIRECT_SHOW' : 'IOS_CONTROL'
      : adLoadMode === 'DIRECT_SHOW' ? 'DIRECT_SHOW' : 'CONTROL',
    iosLoadMode,
    androidLoadMode
  };
}

export function sessionAllowedPlacementIds(session: { placementId: string; allowedPlacementIds?: string[] | null }) {
  const allowed = session.allowedPlacementIds?.filter((id) => typeof id === 'string' && id.length > 0) ?? [];
  return allowed.includes(session.placementId) ? [...new Set(allowed)] : [session.placementId];
}

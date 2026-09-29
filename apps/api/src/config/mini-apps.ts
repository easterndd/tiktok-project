import type { Env } from './env';

export const miniAppKeys = ['main', 'taletv', 'cinereels', 'talereels', 'storyland', 'dramacloud', 'dailyreel', 'dramaone', 'dramaup', 'dramavault', 'talehub', 'talebox', 'storyworld', 'storyhub', 'dramaroom', 'dramazone', 'taleflick', 'dramashort', 'storyshort', 'storyflicks', 'dramaflicks'] as const;
export type MiniAppKey = typeof miniAppKeys[number];

type SecondaryMiniAppKey = Exclude<MiniAppKey, 'main'>;

const definition = (prefix: string) => ({
  databaseEnv: `${prefix}_DATABASE_URL` as keyof Env,
  clientKeyEnv: `${prefix}_TIKTOK_CLIENT_KEY` as keyof Env,
  clientSecretEnv: `${prefix}_TIKTOK_CLIENT_SECRET` as keyof Env,
  appIdEnv: `${prefix}_TIKTOK_APP_ID` as keyof Env,
  rewardedPlacementEnv: `${prefix}_REWARDED_PLACEMENT_ID` as keyof Env,
  entryPlacementEnv: `${prefix}_APP_ENTRY_PLACEMENT_ID` as keyof Env,
  path: prefix.toLowerCase()
});

const secondaryMiniApps: Record<SecondaryMiniAppKey, {
  databaseEnv: keyof Env;
  clientKeyEnv: keyof Env;
  clientSecretEnv: keyof Env;
  appIdEnv: keyof Env;
  rewardedPlacementEnv: keyof Env;
  entryPlacementEnv: keyof Env;
  path: string;
}> = {
  taletv: {
    databaseEnv: 'TALETV_DATABASE_URL',
    clientKeyEnv: 'TALETV_TIKTOK_CLIENT_KEY',
    clientSecretEnv: 'TALETV_TIKTOK_CLIENT_SECRET',
    appIdEnv: 'TALETV_TIKTOK_APP_ID',
    rewardedPlacementEnv: 'TALETV_REWARDED_PLACEMENT_ID',
    entryPlacementEnv: 'TALETV_APP_ENTRY_PLACEMENT_ID',
    path: 'taletv'
  },
  cinereels: {
    databaseEnv: 'CINEREELS_DATABASE_URL',
    clientKeyEnv: 'CINEREELS_TIKTOK_CLIENT_KEY',
    clientSecretEnv: 'CINEREELS_TIKTOK_CLIENT_SECRET',
    appIdEnv: 'CINEREELS_TIKTOK_APP_ID',
    rewardedPlacementEnv: 'CINEREELS_REWARDED_PLACEMENT_ID',
    entryPlacementEnv: 'CINEREELS_APP_ENTRY_PLACEMENT_ID',
    path: 'cinereels'
  },
  talereels: {
    databaseEnv: 'TALEREELS_DATABASE_URL',
    clientKeyEnv: 'TALEREELS_TIKTOK_CLIENT_KEY',
    clientSecretEnv: 'TALEREELS_TIKTOK_CLIENT_SECRET',
    appIdEnv: 'TALEREELS_TIKTOK_APP_ID',
    rewardedPlacementEnv: 'TALEREELS_REWARDED_PLACEMENT_ID',
    entryPlacementEnv: 'TALEREELS_APP_ENTRY_PLACEMENT_ID',
    path: 'talereels'
  },
  storyland: definition('STORYLAND'), dramacloud: definition('DRAMACLOUD'),
  dailyreel: definition('DAILYREEL'), dramaone: definition('DRAMAONE'),
  dramaup: definition('DRAMAUP'), dramavault: definition('DRAMAVAULT'),
  talehub: definition('TALEHUB'), talebox: definition('TALEBOX'),
  storyworld: definition('STORYWORLD'), storyhub: definition('STORYHUB'),
  dramaroom: definition('DRAMAROOM'), dramazone: definition('DRAMAZONE'),
  taleflick: definition('TALEFLICK'), dramashort: definition('DRAMASHORT'),
  storyshort: definition('STORYSHORT'), storyflicks: definition('STORYFLICKS'),
  dramaflicks: definition('DRAMAFLICKS')
};

function valueOf(env: Env, key: keyof Env) {
  return (env as Record<string, unknown>)[key] as string | undefined;
}

function assertSeparateDatabase(env: Env, key: SecondaryMiniAppKey, databaseUrl: string) {
  const candidate = new URL(databaseUrl);
  const candidateSchema = candidate.searchParams.get('schema') ?? 'public';
  const otherUrls = [env.DATABASE_URL, ...Object.entries(secondaryMiniApps)
    .filter(([otherKey]) => otherKey !== key)
    .map(([, definition]) => valueOf(env, definition.databaseEnv))
    .filter((url): url is string => Boolean(url))];
  for (const otherUrl of otherUrls) {
    const other = new URL(otherUrl);
    if (other.host === candidate.host && other.pathname === candidate.pathname && (other.searchParams.get('schema') ?? 'public') === candidateSchema) {
      throw new Error('Each mini app must use a different database or PostgreSQL schema.');
    }
  }
}

export type MiniAppPlatformConfig = {
  key: MiniAppKey;
  clientKey?: string;
  clientSecret?: string;
  appId?: string;
};

export type MiniAppAdConfig = {
  key: MiniAppKey;
  rewardedPlacementId: string;
  appEntryPlacementId: string;
};

export function taletvEnvironment(env: Env): Env | null {
  return miniAppEnvironment(env, 'taletv');
}

export function miniAppEnvironment(env: Env, key: MiniAppKey): Env | null {
  if (key === 'main') return { ...env, MINI_APP_KEY: 'main' };
  const definition = secondaryMiniApps[key];
  const databaseUrl = valueOf(env, definition.databaseEnv);
  if (!databaseUrl) return null;
  assertSeparateDatabase(env, key, databaseUrl);
  return {
    ...env,
    MINI_APP_KEY: key,
    DATABASE_URL: databaseUrl,
    TIKTOK_CLIENT_KEY: valueOf(env, definition.clientKeyEnv),
    TIKTOK_CLIENT_SECRET: valueOf(env, definition.clientSecretEnv),
    TIKTOK_APP_ID: valueOf(env, definition.appIdEnv)
  };
}

export function configuredMiniAppKeys(env: Env): MiniAppKey[] {
  return miniAppKeys.filter((key) => key === 'main' || Boolean(valueOf(env, secondaryMiniApps[key].databaseEnv)));
}

export function miniAppPath(key: MiniAppKey) {
  return key === 'main' ? '' : secondaryMiniApps[key].path;
}

export function miniAppPlatformConfig(env: Env, key: MiniAppKey): MiniAppPlatformConfig {
  if (key === 'main') {
    return {
      key,
      clientKey: env.TIKTOK_CLIENT_KEY,
      clientSecret: env.TIKTOK_CLIENT_SECRET,
      appId: env.TIKTOK_APP_ID
    };
  }
  const definition = secondaryMiniApps[key];
  return { key, clientKey: valueOf(env, definition.clientKeyEnv), clientSecret: valueOf(env, definition.clientSecretEnv), appId: valueOf(env, definition.appIdEnv) };
}

export function miniAppAdConfig(env: Env, key: MiniAppKey = env.MINI_APP_KEY): MiniAppAdConfig {
  if (key === 'main') {
    return {
      key,
      rewardedPlacementId: env.REWARDED_PLACEMENT_ID,
      appEntryPlacementId: env.APP_ENTRY_PLACEMENT_ID
    };
  }
  const definition = secondaryMiniApps[key];
  return { key, rewardedPlacementId: valueOf(env, definition.rewardedPlacementEnv) ?? '', appEntryPlacementId: valueOf(env, definition.entryPlacementEnv) ?? '' };
}

import type { Env } from './env';

export type MiniAppKey = 'main' | 'taletv' | 'cinereels' | 'talereels';

type SecondaryMiniAppKey = Exclude<MiniAppKey, 'main'>;

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
  }
};

function valueOf(env: Env, key: keyof Env) {
  return env[key] as string | undefined;
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
  return ['main', ...Object.keys(secondaryMiniApps)].filter((key) => key === 'main' || Boolean(valueOf(env, secondaryMiniApps[key as SecondaryMiniAppKey].databaseEnv))) as MiniAppKey[];
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

import type { Env } from './env';

export type MiniAppKey = 'main' | 'taletv';

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
  if (!env.TALETV_DATABASE_URL) return null;
  const main = new URL(env.DATABASE_URL);
  const taletv = new URL(env.TALETV_DATABASE_URL);
  const sameDatabase = main.host === taletv.host && main.pathname === taletv.pathname;
  const mainSchema = main.searchParams.get('schema') ?? 'public';
  const taletvSchema = taletv.searchParams.get('schema') ?? 'public';
  if (sameDatabase && mainSchema === taletvSchema) {
    throw new Error('TALETV_DATABASE_URL must use a different database or PostgreSQL schema from DATABASE_URL.');
  }
  return {
    ...env,
    MINI_APP_KEY: 'taletv',
    DATABASE_URL: env.TALETV_DATABASE_URL,
    TIKTOK_CLIENT_KEY: env.TALETV_TIKTOK_CLIENT_KEY,
    TIKTOK_CLIENT_SECRET: env.TALETV_TIKTOK_CLIENT_SECRET
  };
}

export function miniAppEnvironment(env: Env, key: MiniAppKey): Env | null {
  if (key === 'main') return { ...env, MINI_APP_KEY: 'main' };
  return taletvEnvironment({ ...env, MINI_APP_KEY: 'main' });
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
  return {
    key,
    clientKey: env.TALETV_TIKTOK_CLIENT_KEY,
    clientSecret: env.TALETV_TIKTOK_CLIENT_SECRET,
    appId: env.TALETV_TIKTOK_APP_ID
  };
}

export function miniAppAdConfig(env: Env, key: MiniAppKey = env.MINI_APP_KEY): MiniAppAdConfig {
  if (key === 'main') {
    return {
      key,
      rewardedPlacementId: env.REWARDED_PLACEMENT_ID,
      appEntryPlacementId: env.APP_ENTRY_PLACEMENT_ID
    };
  }
  return {
    key,
    rewardedPlacementId: env.TALETV_REWARDED_PLACEMENT_ID,
    appEntryPlacementId: env.TALETV_APP_ENTRY_PLACEMENT_ID
  };
}

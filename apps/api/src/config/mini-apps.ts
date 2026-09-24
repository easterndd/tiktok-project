import type { Env } from './env';

export type MiniAppKey = 'main' | 'xu03';

export type MiniAppPlatformConfig = {
  key: MiniAppKey;
  clientKey?: string;
  clientSecret?: string;
  appId?: string;
};

export function xu03Environment(env: Env): Env | null {
  if (!env.XU03_DATABASE_URL) return null;
  const main = new URL(env.DATABASE_URL);
  const xu03 = new URL(env.XU03_DATABASE_URL);
  const sameDatabase = main.host === xu03.host && main.pathname === xu03.pathname;
  const mainSchema = main.searchParams.get('schema') ?? 'public';
  const xu03Schema = xu03.searchParams.get('schema') ?? 'public';
  if (sameDatabase && mainSchema === xu03Schema) {
    throw new Error('XU03_DATABASE_URL must use a different database or PostgreSQL schema from DATABASE_URL.');
  }
  return {
    ...env,
    MINI_APP_KEY: 'xu03',
    DATABASE_URL: env.XU03_DATABASE_URL,
    TIKTOK_CLIENT_KEY: env.XU03_TIKTOK_CLIENT_KEY,
    TIKTOK_CLIENT_SECRET: env.XU03_TIKTOK_CLIENT_SECRET
  };
}

export function miniAppEnvironment(env: Env, key: MiniAppKey): Env | null {
  if (key === 'main') return { ...env, MINI_APP_KEY: 'main' };
  return xu03Environment({ ...env, MINI_APP_KEY: 'main' });
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
    clientKey: env.XU03_TIKTOK_CLIENT_KEY,
    clientSecret: env.XU03_TIKTOK_CLIENT_SECRET,
    appId: env.XU03_TIKTOK_APP_ID
  };
}

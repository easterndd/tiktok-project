import { z } from 'zod';
import { resolve } from 'node:path';

let processEnvFileLoaded = false;

function loadProcessEnvFile() {
  if (processEnvFileLoaded || typeof process.loadEnvFile !== 'function') return;
  try {
    process.loadEnvFile(resolve(__dirname, '../../.env'));
    processEnvFileLoaded = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

const environment = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  API_CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:5174'),
  // Enable only when the public API is behind a proxy that removes client
  // supplied X-Geo-Country and writes a verified ISO 3166-1 alpha-2 value.
  TRUST_GEO_COUNTRY_HEADER: z.coerce.boolean().default(false),
  JWT_SECRET: z.string().min(32),
  USER_JWT_EXPIRES_IN: z.coerce.number().int().positive().default(3_600),
  ADMIN_JWT_EXPIRES_IN: z.coerce.number().int().positive().default(28_800),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12).optional(),
  BYTEPLUS_ACCOUNT_ID: z.string().min(1),
  BYTEPLUS_SPACE_NAME: z.string().min(1),
  BYTEPLUS_REGION: z.string().min(1),
  BYTEPLUS_ACCESS_KEY: z.string().min(1).optional(),
  BYTEPLUS_SECRET_KEY: z.string().min(1).optional(),
  BYTEPLUS_VOD_ENDPOINT: z.string().url().default('https://vod.byteplusapi.com'),
  API_PUBLIC_BASE_URL: z.string().url().optional(),
  COVER_ASSET_STORAGE_DIR: z.string().min(1).default('tmp/cover-assets'),
  COVER_ASSET_PUBLIC_BASE_URL: z.string().url().optional(),
  // Development-only switch for browser playback tests without BytePlus VOD.
  LOCAL_PLAYBACK_ENABLED: z.coerce.boolean().default(false),
  UPLOAD_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  UPLOAD_MAX_RETRIES: z.coerce.number().int().min(0).max(20).default(5)
});

export type Env = z.infer<typeof environment>;

export function loadEnv(source = process.env): Env {
  if (source === process.env) loadProcessEnvFile();
  const parsed = environment.safeParse(source);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${keys}`);
  }
  return parsed.data;
}

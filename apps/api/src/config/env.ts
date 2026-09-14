import { z } from 'zod';

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
  TIKTOK_CLIENT_KEY: z.string().min(1),
  TIKTOK_CLIENT_SECRET: z.string().min(1),
  TIKTOK_OAUTH_TOKEN_URL: z.string().url().default('https://open.tiktokapis.com/v2/oauth/token/'),
  TIKTOK_USER_INFO_URL: z.string().url().default('https://open.tiktokapis.com/v2/user/info/?fields=open_id'),
  TIKTOK_REDIRECT_URI: z.string().url().optional(),
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
  UPLOAD_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  UPLOAD_MAX_RETRIES: z.coerce.number().int().min(0).max(20).default(5)
});

export type Env = z.infer<typeof environment>;

export function loadEnv(source = process.env): Env {
  const parsed = environment.safeParse(source);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${keys}`);
  }
  return parsed.data;
}

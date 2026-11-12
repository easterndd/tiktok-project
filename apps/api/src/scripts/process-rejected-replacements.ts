import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../config/env';
import { miniAppEnvironment } from '../config/mini-apps';
import { runtimeDatabaseUrl } from '../config/database-pool';
import { BytePlusVodService } from '../services/byteplus-vod.service';
import { processLocalUploadJobs } from '../services/local-upload.service';

async function main() {
  const root = loadEnv();
  const appKey = process.env.REPLACEMENT_APP_KEY ?? 'bloomreel';
  if (appKey !== 'bloomreel' && appKey !== 'riftsaga') throw new Error('Replacement worker app key is not allowed.');
  const env = miniAppEnvironment({ ...root, MINI_APP_KEY: 'main' }, appKey);
  if (!env?.BYTEPLUS_ACCESS_KEY || !env.BYTEPLUS_SECRET_KEY) throw new Error(`${appKey} BytePlus configuration is missing.`);
  const db = new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl(
    env.DATABASE_URL, root.DATABASE_POOLER_HOST, root.DATABASE_POOLER_PORT, 1
  ) } } });
  const sharedUrl = root.SHARED_PLATFORM_DATABASE_URL ?? root.DATABASE_URL;
  const shared = new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl(
    sharedUrl, root.DATABASE_POOLER_HOST, root.DATABASE_POOLER_PORT, 1
  ) } } });
  try {
    const count = await processLocalUploadJobs(db, shared, new BytePlusVodService(env), env, {
      sourceType: 'REPLACEMENT', concurrency: 1,
      log: (message, details) => console.log(JSON.stringify({ message, details }))
    });
    console.log(JSON.stringify({ miniAppKey: appKey, processedReplacementJobs: count }));
  } finally {
    await Promise.all([db.$disconnect(), shared.$disconnect()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

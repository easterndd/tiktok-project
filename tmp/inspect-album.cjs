const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
const { configuredMiniAppKeys } = require('./dist/config/mini-apps');

(async () => {
  const baseEnv = loadEnv();
  const contexts = configuredMiniAppKeys(baseEnv).map((key) => ({ key, env: miniAppEnvironment(baseEnv, key) })).filter((item) => item.env);
  try {
    const results = [];
    for (const context of contexts) {
      const db = new PrismaClient({ datasources: { db: { url: context.env.DATABASE_URL } } });
      try {
        const albums = await db.album.findMany({
          where: { title: { contains: 'He Chose My Best Friend' } },
          select: { id: true, title: true, description: true, language: true, releaseYear: true, tiktokAlbumId: true, tiktokVersion: true, reviewStatus: true, coverAssetId: true, _count: { select: { episodes: true } } }
        });
        const jobs = await db.platformSyncJob.findMany({
          where: { providerRequestId: { in: ['20261014114309AC511CAF549D3504AB1E', '2026101411430982754EC29080030453C1'] } },
          select: { id: true, albumId: true, kind: true, status: true, errorCode: true, errorMessage: true, providerRequestId: true, providerResponse: true, snapshotJson: true, createdAt: true, completedAt: true }
        });
        results.push({ key: context.key, albums, jobs });
      } finally { await db.$disconnect(); }
    }
    console.log(JSON.stringify(results));
  } finally {
  }
})().catch((error) => { console.error(JSON.stringify({ message: error.message })); process.exit(1); });

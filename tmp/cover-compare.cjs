const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { configuredMiniAppKeys, miniAppEnvironment } = require('./dist/config/mini-apps');
(async () => {
  const base = loadEnv();
  for (const key of configuredMiniAppKeys(base)) {
    if (!['lucidreel', 'taletv', 'dramablaze'].includes(key)) continue;
    const env = miniAppEnvironment(base, key);
    const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
    try {
      const covers = await db.coverAsset.findMany({
        where: key === 'lucidreel' ? { id: 'cmv7fqi3gfzislm01ddaszf6u' } : { providerImageId: { not: null } },
        orderBy: { createdAt: 'desc' }, take: key === 'lucidreel' ? 1 : 5,
        select: { id: true, mimeType: true, fileSize: true, width: true, height: true, storageKey: true, publicUrl: true, providerImageId: true, createdAt: true }
      });
      console.log(JSON.stringify({ app: key, covers }));
    } finally { await db.$disconnect(); }
  }
})().catch(e => { console.error(e.message); process.exit(1); });

const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { configuredMiniAppKeys, miniAppEnvironment } = require('./dist/config/mini-apps');
(async () => {
  const base = loadEnv();
  for (const key of configuredMiniAppKeys(base)) {
    const env = miniAppEnvironment(base, key);
    const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
    try {
      const albums = await db.album.findMany({ where: { title: { contains: "My Family's Curse", mode: 'insensitive' } }, select: {
        id: true, title: true, coverAssetId: true, tiktokAlbumId: true, tiktokVersion: true, reviewStatus: true,
        coverAsset: { select: { id: true, status: true, providerImageId: true, platformSyncedAt: true, platformSyncError: true } },
        episodes: { select: { id: true, episodeNo: true, byteplusVid: true, tiktokVideoStatus: true, tiktokVideoError: true } }
      } });
      for (const album of albums) {
        const jobs = await db.platformSyncJob.findMany({ where: { OR: [ { albumId: album.id },
          ...(album.coverAssetId ? [{ coverAssetId: album.coverAssetId }] : []), { episodeId: { in: album.episodes.map(e => e.id) } } ] },
          orderBy: { createdAt: 'desc' }, take: 12, select: { id: true, kind: true, status: true, createdAt: true, completedAt: true, nextAttemptAt: true, errorCode: true, errorMessage: true } });
        const { episodes, ...info } = album;
        console.log(JSON.stringify({ app: key, album: info, videoCount: episodes.length,
          readyVideos: episodes.filter(e => e.byteplusVid && e.tiktokVideoStatus === 'READY').length,
          incompleteVideos: episodes.filter(e => !e.byteplusVid || e.tiktokVideoStatus !== 'READY').map(e => ({ episode: e.episodeNo, hasVid: Boolean(e.byteplusVid), status: e.tiktokVideoStatus, error: e.tiktokVideoError })), jobs }));
      }
    } finally { await db.$disconnect(); }
  }
})().catch(e => { console.error(e.message); process.exit(1); });

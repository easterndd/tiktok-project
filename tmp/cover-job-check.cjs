const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
(async () => {
  const env = miniAppEnvironment(loadEnv(), 'lucidreel');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const id = 'cmv7fqi3gfzislm01ddaszf6u';
    const cover = await db.coverAsset.findUnique({ where: { id }, select: { id: true, publicUrl: true, providerImageId: true, platformSyncedAt: true, platformSyncError: true } });
    const jobs = await db.platformSyncJob.findMany({ where: { coverAssetId: id }, orderBy: { createdAt: 'desc' }, select: { id: true, kind: true, status: true, attemptCount: true, nextAttemptAt: true, createdAt: true, updatedAt: true, startedAt: true, completedAt: true, errorCode: true, errorMessage: true, providerRequestId: true } });
    console.log(JSON.stringify({ now: new Date(), cover, jobs }));
    const album = await db.album.findUnique({ where: { id: 'cmv7fqiwdfzn3lm01jh9cbkka' }, select: { title: true, coverAssetId: true, tiktokAlbumId: true, tiktokVersion: true, episodes: { select: { byteplusVid: true, tiktokVideoStatus: true } } } });
    if (album) console.log(JSON.stringify({ album: album.title, coverBindingMatches: album.coverAssetId === id, tiktokAlbumId: album.tiktokAlbumId, tiktokVersion: album.tiktokVersion, videoCount: album.episodes.length, readyVideos: album.episodes.filter(e => e.byteplusVid && e.tiktokVideoStatus === 'READY').length }));
    if (cover?.publicUrl) {
      const res = await fetch(cover.publicUrl, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
      console.log(JSON.stringify({ coverHttpStatus: res.status, contentType: res.headers.get('content-type'), contentLength: res.headers.get('content-length') }));
    }
  } finally { await db.$disconnect(); }
})().catch(e => { console.error(e.message); process.exit(1); });

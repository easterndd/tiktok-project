const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
const { TikTokShortDramaApiService } = require('./dist/services/tiktok-short-drama-api.service');
(async () => {
  const env = miniAppEnvironment(loadEnv(), 'lucidreel');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const cover = await db.coverAsset.findUniqueOrThrow({ where: { id: 'cmv7fqi3gfzislm01ddaszf6u' } });
    if (cover.providerImageId) { console.log('Already synced'); return; }
    const job = await db.platformSyncJob.findUniqueOrThrow({ where: { id: 'cmv7fqi3rfziwlm01k05aqp84' } });
    if (!['PENDING', 'FAILED'].includes(job.status)) throw new Error('Worker currently owns job; leave it alone.');
    const claimed = await db.platformSyncJob.updateMany({ where: { id: job.id, status: job.status, updatedAt: job.updatedAt }, data: { status: 'PROCESSING', startedAt: new Date() } });
    if (claimed.count !== 1) throw new Error('Job changed; leave it alone.');
    const api = new TikTokShortDramaApiService(env, { fetch: async (url, options) => {
      const start = Date.now();
      const res = await fetch(url, options);
      if (new URL(url).pathname.includes('shortdrama/image')) {
        const data = await res.clone().json().catch(() => null);
        console.log(JSON.stringify({ httpStatus: res.status, ms: Date.now() - start, error: data?.error, hasImageId: Boolean(data?.data?.open_pic_id) }));
      }
      return res;
    } });
    try {
      // Serve identical original pixels at a fresh URL to test provider URL fetching.
      const imageUrl = new URL(cover.publicUrl);
      imageUrl.searchParams.set('tiktok_sync', '20261014-recovery');
      const result = await api.createImage({ imageUrl: imageUrl.href });
      await db.$transaction(async tx => {
        const saved = await tx.coverAsset.updateMany({ where: { id: cover.id, sha256: cover.sha256, providerImageId: null }, data: { providerImageId: result.openPicId, platformSyncedAt: new Date(), platformSyncError: null } });
        if (saved.count !== 1) throw new Error('Cover changed during recovery.');
        await tx.platformSyncJob.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', completedAt: new Date(), nextAttemptAt: null, errorCode: null, errorMessage: null, providerRequestId: result.requestId, providerResponse: { open_pic_id: result.openPicId } } });
      });
      console.log(JSON.stringify({ recovered: true, imageId: result.openPicId, requestId: result.requestId }));
    } catch (e) {
      await db.platformSyncJob.update({ where: { id: job.id }, data: { status: job.status, startedAt: job.startedAt, nextAttemptAt: job.nextAttemptAt, completedAt: job.completedAt } });
      console.log(JSON.stringify({ recovered: false, message: e.message, code: e.code, requestId: e.requestId }));
    }
  } finally { await db.$disconnect(); }
})().catch(e => { console.error(e.message); process.exit(1); });

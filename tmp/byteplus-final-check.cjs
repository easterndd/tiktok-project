const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
const { uploadScope, matchesUploadTags } = require('./dist/services/local-upload.service');
const { BytePlusVodService } = require('./dist/services/byteplus-vod.service');
const fs = require('node:fs');

(async () => {
  const env = miniAppEnvironment(loadEnv(), 'lucidreel');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const jobs = await db.uploadJob.findMany({
      where: { sourceType: 'FILE', createdAt: { gte: new Date('2026-10-13T00:00:00Z') } },
      orderBy: { createdAt: 'asc' }, include: { episode: true }
    });
    const counts = {};
    for (const job of jobs) counts[job.status] = (counts[job.status] || 0) + 1;
    console.log(JSON.stringify({ now: new Date().toISOString(), counts }));
    const vod = new BytePlusVodService(env);
    for (const job of jobs.filter(j => [14, 15, 17, 18, 27, 28].includes(j.episode.episodeNo))) {
      let media;
      if (job.status === 'SUCCEEDED' && job.providerJobId) {
        [media] = await vod.getMediaInfos({ vids: [job.providerJobId] });
      }
      console.log(JSON.stringify({
        episode: job.episode.episodeNo, status: job.status, retryCount: job.retryCount,
        vid: job.providerJobId, bound: job.episode.byteplusVid === job.providerJobId,
        tags: media ? matchesUploadTags(media.tags, job.uploadScope, job.id) : null,
        space: media ? media.spaceName === env.BYTEPLUS_SPACE_NAME : null,
        fileRetained: job.localFilePath ? fs.existsSync(job.localFilePath) : false,
        error: job.errorMessage, leaseExpiresAt: job.leaseExpiresAt
      }));
    }
  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error.message); process.exit(1); });

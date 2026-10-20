const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { configuredMiniAppKeys, miniAppEnvironment } = require('./dist/config/mini-apps');
const { uploadScope, localUploadDirectory } = require('./dist/services/local-upload.service');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const base = loadEnv();
  for (const key of configuredMiniAppKeys(base)) {
    const env = miniAppEnvironment(base, key);
    const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
    try {
      const jobs = await db.uploadJob.findMany({ where: { sourceType: 'FILE', status: { not: 'SUCCEEDED' } }, orderBy: { createdAt: 'desc' }, include: { episode: { select: { id: true, episodeNo: true, byteplusVid: true, album: { select: { title: true } } } } } });
      for (const j of jobs) {
        const rel = j.localFilePath && path.relative(localUploadDirectory(env), path.resolve(j.localFilePath));
        const safe = Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
        let size = null;
        if (safe) { try { size = fs.statSync(j.localFilePath).size; } catch {} }
        console.log(JSON.stringify({app:key,id:j.id,status:j.status,episodeId:j.episodeId,episodeNo:j.episode.episodeNo,title:j.episode.album.title,createdAt:j.createdAt,retryCount:j.retryCount,remoteStartedAt:j.remoteStartedAt,providerJobId:j.providerJobId,boundVid:j.episode.byteplusVid,scopeValid:j.uploadScope===uploadScope(env),safeFile:safe,fileBytes:size,error:j.errorMessage}));
      }
    } finally { await db.$disconnect(); }
  }
})().catch(e => { console.error(e.message); process.exit(1); });

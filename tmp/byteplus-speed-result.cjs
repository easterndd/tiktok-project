const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');

(async () => {
  const env = miniAppEnvironment(loadEnv(), 'lucidreel');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const jobs = await db.uploadJob.findMany({
      where: { sourceType: 'FILE', createdAt: { gte: new Date('2026-10-14T01:30:00Z') } },
      orderBy: { createdAt: 'asc' }, include: { episode: true }
    });
    console.log(JSON.stringify(jobs.map(job => ({ episode: job.episode.episodeNo, status: job.status,
      vid: Boolean(job.providerJobId), started: job.remoteStartedAt, completed: job.completedAt,
      error: job.errorMessage }))));
  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error.message); process.exit(1); });

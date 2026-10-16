const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
(async () => {
  const env = miniAppEnvironment(loadEnv(), 'lucidreel');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const jobs = await db.uploadJob.findMany({
      where: { sourceType: 'FILE', createdAt: { gte: new Date('2026-10-13T00:00:00Z') } },
      orderBy: { createdAt: 'asc' }, include: { episode: true }
    });
    for (const job of jobs) console.log(JSON.stringify({ episode: job.episode.episodeNo, status: job.status,
      retry: job.retryCount, created: job.createdAt, started: job.startedAt, remote: job.remoteStartedAt,
      completed: job.completedAt, minutes: job.remoteStartedAt && job.completedAt
        ? Math.round((job.completedAt - job.remoteStartedAt) / 60000 * 10) / 10 : null,
      next: job.nextAttemptAt, lease: job.leaseExpiresAt, error: job.errorMessage }));
  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error.message); process.exit(1); });

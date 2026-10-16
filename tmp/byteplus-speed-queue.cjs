const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');

(async () => {
  const env = miniAppEnvironment(loadEnv(), 'lucidreel');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const jobs = await db.uploadJob.findMany({
      where: { sourceType: 'FILE', status: { in: ['PENDING', 'PROCESSING'] } },
      orderBy: { createdAt: 'asc' },
      include: { episode: true }
    });
    console.log(JSON.stringify({ time: new Date().toISOString(), active: jobs.filter(job => job.status === 'PROCESSING').length,
      pending: jobs.filter(job => job.status === 'PENDING').length,
      jobs: jobs.map(job => ({ episode: job.episode.episodeNo, status: job.status,
        remoteStartedAt: job.remoteStartedAt, leaseExpiresAt: job.leaseExpiresAt })) }));
  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error.message); process.exit(1); });

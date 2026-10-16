const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
const { enqueueAlbumVersionSync } = require('./dist/services/platform-sync.service');
(async () => {
  const env = miniAppEnvironment(loadEnv(), 'lucidreel');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const job = await enqueueAlbumVersionSync(db, 'cmv7fqiwdfzn3lm01jh9cbkka');
    console.log(JSON.stringify({ id: job.id, status: job.status, dedupeKey: job.dedupeKey, snapshotJson: job.snapshotJson }));
  } finally { await db.$disconnect(); }
})().catch((error) => { console.error(JSON.stringify({ message: error.message, statusCode: error.statusCode })); process.exit(1); });

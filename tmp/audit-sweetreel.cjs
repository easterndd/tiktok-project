const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
const { runtimeDatabaseUrl } = require('./dist/config/database-pool');
const env = loadEnv();
(async () => {
  const context = miniAppEnvironment(env, 'sweetreel');
  if (!context) throw new Error('sweetreel database is not configured');
  const db = new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl(context.DATABASE_URL, env.DATABASE_POOLER_HOST, env.DATABASE_POOLER_PORT) } } });
  try {
    const now = new Date();
    const policies = await db.appEntryAdPolicy.findMany({ orderBy: { updatedAt: 'desc' }, take: 10, select: { releaseId: true, enabled: true, mode: true, requiredCount: true, countMode: true, onUnavailable: true, updatedAt: true } });
    const sessions = await db.appEntryAdSession.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, releaseId: true, status: true, mode: true, requiredCount: true, completedCount: true, expiresAt: true, createdAt: true, _count: { select: { adEvents: true, completions: true } } } });
    const eventCounts = await db.adEvent.groupBy({ by: ['eventType'], where: { scope: 'APP_ENTRY', createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } }, _count: { _all: true } });
    console.log(JSON.stringify({ policies, eventCounts, sessions: sessions.map(({ id, ...s }) => ({ sessionIdSuffix: id.slice(-6), ...s })) }));
  } finally { await db.$disconnect(); }
})().catch(e => { console.error(e.message); process.exit(1); });

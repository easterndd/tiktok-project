const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
const { runtimeDatabaseUrl } = require('./dist/config/database-pool');
const env = loadEnv();
(async () => {
  const report = { at: new Date().toISOString(), apps: [] };
  for (const key of ['taletv', 'talereels']) {
    const context = miniAppEnvironment(env, key);
    const db = new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl(context.DATABASE_URL, env.DATABASE_POOLER_HOST, env.DATABASE_POOLER_PORT) } } });
    try {
      const from = new Date(Date.now() - 15 * 60_000);
      const failures = await db.adEvent.groupBy({ by: ['scope', 'adType', 'errorCode'], where: { createdAt: { gte: from }, eventType: 'FAILED' }, _count: { _all: true }, orderBy: { _count: { id: 'desc' } }, take: 12 });
      const sessions = await db.appEntryAdSession.groupBy({ by: ['releaseId', 'status'], where: { createdAt: { gte: from } }, _count: { _all: true } });
      report.apps.push({ key, failures: failures.map(row => ({ scope: row.scope, adType: row.adType, reason: row.errorCode, count: row._count._all })), sessions: sessions.map(row => ({ releaseId: row.releaseId, status: row.status, count: row._count._all })) });
    } finally { await db.$disconnect(); }
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(String(error.message).replace(/postgres(?:ql)?:\/\/[^@\s]+@/g, 'postgresql://***@')); process.exitCode = 1; });

const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
const { runtimeDatabaseUrl } = require('./dist/config/database-pool');
const env = loadEnv();
const now = new Date();
const windows = [15, 60, 1440];
(async () => {
  const report = { at: now, apps: [] };
  for (const key of ['taletv', 'talereels']) {
    const context = miniAppEnvironment(env, key);
    const db = new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl(context.DATABASE_URL, env.DATABASE_POOLER_HOST, env.DATABASE_POOLER_PORT) } } });
    try {
      const periods = [];
      for (const minutes of windows) {
        const from = new Date(now.getTime() - minutes * 60_000);
        const [events, runtime] = await Promise.all([
          db.adEvent.groupBy({ by: ['eventType'], where: { createdAt: { gte: from } }, _count: { _all: true } }),
          db.miniAppRuntimeError.count({ where: { createdAt: { gte: from }, kind: { in: ['AD', 'PLAYBACK', 'STARTUP'] } } })
        ]);
        periods.push({ minutes, events: Object.fromEntries(events.map(row => [row.eventType, row._count._all])), runtimeErrors: runtime });
      }
      report.apps.push({ key, periods });
    } finally { await db.$disconnect(); }
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(String(error.message).replace(/postgres(?:ql)?:\/\/[^@\s]+@/g, 'postgresql://***@')); process.exitCode = 1; });

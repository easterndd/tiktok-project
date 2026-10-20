const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
const { runtimeDatabaseUrl } = require('./dist/config/database-pool');
const env = loadEnv();
(async () => {
  const ctx = miniAppEnvironment(env, 'dramablaze');
  if (!ctx) throw new Error('DramaBlaze database is not configured');
  const db = new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl(ctx.DATABASE_URL, env.DATABASE_POOLER_HOST, env.DATABASE_POOLER_PORT) } } });
  const ids = process.argv.slice(2);
  try {
    const sessions = await db.appEntryAdSession.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, completedCount: true, requiredCount: true, expiresAt: true, createdAt: true, adEvents: { orderBy: { createdAt: 'desc' }, take: 5, select: { eventType: true, clientEventId: true, adIndex: true, placementId: true, createdAt: true } }, completions: { orderBy: { createdAt: 'desc' }, take: 5, select: { clientEventId: true, adIndex: true, createdAt: true } } } });
    console.log(JSON.stringify(sessions.map(s => ({ ...s, id: s.id.slice(-8), adEvents: s.adEvents.map(e => ({ ...e, clientEventId: e.clientEventId?.slice(-8) })), completions: s.completions.map(e => ({ ...e, clientEventId: e.clientEventId?.slice(-8) })) }))));
  } finally { await db.$disconnect(); }
})().catch(e => { console.error(e.message); process.exit(1); });

const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
const { runtimeDatabaseUrl } = require('./dist/config/database-pool');
const { createHash } = require('node:crypto');
const env = loadEnv();
const tag = value => value ? createHash('sha256').update(value).digest('hex').slice(0, 8) : null;
(async () => {
  const now = new Date();
  const report = { at: now, apps: [] };
  for (const key of ['taletv', 'talereels']) {
    const db = new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl(miniAppEnvironment(env, key).DATABASE_URL, env.DATABASE_POOLER_HOST, env.DATABASE_POOLER_PORT) } } });
    try {
      const rows = await db.adEvent.findMany({ where: { scope: 'APP_ENTRY', createdAt: { gte: new Date(now.getTime() - 30 * 60000) } }, orderBy: { createdAt: 'desc' }, take: 6000,
        select: { userId: true, appEntrySessionId: true, clientEventId: true, adIndex: true, eventType: true, errorCode: true, createdAt: true,
          appEntrySession: { select: { releaseId: true, status: true, completedCount: true, requiredCount: true } } } });
      const failed = rows.filter(r => r.eventType === 'FAILED');
      const groups = new Map();
      for (const r of failed) {
        const id = r.appEntrySessionId;
        const g = groups.get(id) || { id, count: 0, session: r.appEntrySession, times: [] };
        g.count++; g.times.push(r.createdAt); groups.set(id, g);
      }
      const occupiedSeconds = new Set(failed.map(r => Math.floor(r.createdAt.getTime() / 1000)));
      const laterSuccess = failed.filter(r => rows.some(s => s.appEntrySessionId === r.appEntrySessionId && s.adIndex === r.adIndex && s.createdAt > r.createdAt && ['SHOWN','CLOSED_COMPLETED'].includes(s.eventType)));
      const top = [...groups.values()].sort((a,b) => b.count-a.count).slice(0,3).map(g => ({ session: tag(g.id), failures: g.count, ...g.session,
        timeline: rows.filter(r => r.appEntrySessionId === g.id).sort((a,b) => a.createdAt-b.createdAt).slice(-18).map(r=>({ at:r.createdAt, event:r.eventType, adIndex:r.adIndex, code:r.errorCode })) }));
      report.apps.push({ key, sampled:rows.length, truncated:rows.length===6000,
        events:rows.reduce((a,r)=>(a[r.eventType]=(a[r.eventType]||0)+1,a),{}), failures:failed.length,
        distinctFailingUsers:new Set(failed.map(r=>r.userId)).size, distinctFailingSessions:groups.size,
        distinctFailingEventIds:new Set(failed.map(r=>r.clientEventId)).size,
        secondsWithFailures:occupiedSeconds.size, windowSeconds:1800,
        failureEventsWithLaterSuccessOnSameSessionAndIndex:laterSuccess.length,
        failedSessionsCurrentlyCompleted:[...groups.values()].filter(g=>g.session?.status==='COMPLETED').length,
        errorCodes:failed.reduce((a,r)=>(a[r.errorCode||'null']=(a[r.errorCode||'null']||0)+1,a),{}), top });
    } finally { await db.$disconnect(); }
  }
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{ console.error(String(error.message).replace(/postgres(?:ql)?:\/\/[^@\s]+@/g,'postgresql://***@'));process.exitCode=1; });

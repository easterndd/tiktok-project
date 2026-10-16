const { createHmac } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { configuredMiniAppKeys, miniAppEnvironment } = require('./dist/config/mini-apps');
const { runtimeDatabaseUrl } = require('./dist/config/database-pool');
const env = loadEnv();
function jwt(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ ...claims, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+300 })).toString('base64url');
  return header + '.' + payload + '.' + createHmac('sha256', env.JWT_SECRET).update(header + '.' + payload).digest('base64url');
}
(async () => {
  const report = { at: new Date().toISOString(), summaries: [], releases: [] };
  for (const key of configuredMiniAppKeys(env)) {
    const context = miniAppEnvironment(env, key);
    const db = new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl(context.DATABASE_URL, env.DATABASE_POOLER_HOST, env.DATABASE_POOLER_PORT) } } });
    try {
      const summary = await db.analyticsDailySummary.aggregate({ _count: { _all: true }, _max: { sourceWindowEnd: true } });
      report.summaries.push({ key, days: summary._count._all, updatedAt: summary._max.sourceWindowEnd });
      if (!['main', 'taletv', 'talereels'].includes(key)) continue;
      const admin = await db.adminUser.findFirst({ where: { status: 'ACTIVE', role: 'OWNER' }, select: { id: true, role: true, tokenVersion: true } });
      if (!admin) { report.releases.push({ key, error: 'No active OWNER admin' }); continue; }
      const token = jwt({ sub: admin.id, role: admin.role, tokenVersion: admin.tokenVersion, kind: 'admin', appKey: key });
      const prefix = key === 'main' ? '/api/v1' : '/api/' + key + '/v1';
      const res = await fetch('https://api.evergreenprosper.com' + prefix + '/admin/app-entry-ad-policies', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000) });
      const body = await res.json();
      report.releases.push({ key, status: res.status, items: body.items?.map(({ releaseId, firstSeenAt, portalStatus, portalVersion, enabled, version }) => ({ releaseId, firstSeenAt, portalStatus, portalVersion, enabled, version })) });
    } finally { await db.$disconnect(); }
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(String(error.message).replace(/postgres(?:ql)?:\/\/[^@\s]+@/g, 'postgresql://***@')); process.exitCode = 1; });

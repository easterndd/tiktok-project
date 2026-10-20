const { createHmac } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { configuredMiniAppKeys, miniAppEnvironment } = require('./dist/config/mini-apps');
const { runtimeDatabaseUrl } = require('./dist/config/database-pool');
const env = loadEnv();
const jwt = claims => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ ...claims, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+1800 })).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256', env.JWT_SECRET).update(`${header}.${payload}`).digest('base64url')}`;
};
const keys = configuredMiniAppKeys(env);
const percentile = (values, p) => [...values].sort((a,b)=>a-b)[Math.min(values.length-1, Math.ceil(values.length*p)-1)];
(async () => {
  const report = { at: new Date().toISOString(), apps: [], latency: [] };
  for (const key of keys) {
    const context = miniAppEnvironment(env, key);
    const db = new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl(context.DATABASE_URL, env.DATABASE_POOLER_HOST, env.DATABASE_POOLER_PORT) } } });
    try {
      const schema = new URL(context.DATABASE_URL).searchParams.get('schema') || 'public';
      const tables = await db.$queryRaw`select tablename from pg_tables where schemaname=${schema} and tablename in ('AnalyticsDailySummary','AnalyticsOverviewSnapshot','MiniAppRuntimeError')`;
      const migrations = await db.$queryRawUnsafe(`select migration_name from "${schema}"._prisma_migrations where finished_at is not null and rolled_back_at is null order by finished_at desc limit 5`);
      const summary = tables.some(t=>t.tablename==='AnalyticsDailySummary') ? await db.$queryRawUnsafe(`select count(*)::int as days, max("sourceWindowEnd") as latest, min(day) as first from "${schema}"."AnalyticsDailySummary"`) : [];
      report.apps.push({ key, tables: tables.map(t=>t.tablename), migrations: migrations.map(m=>m.migration_name), summary });
      if (!['main','taletv','talereels'].includes(key)) continue;
      const admin = await db.adminUser.findFirst({ where: { status:'ACTIVE', role:'OWNER' }, select: { id:true, role:true, tokenVersion:true } });
      if (!admin) continue;
      const token = jwt({ sub:admin.id, role:admin.role, tokenVersion:admin.tokenVersion, kind:'admin', appKey:key });
      const prefix = key==='main' ? '/api/v1' : `/api/${key}/v1`;
      for (const endpoint of ['/admin/analytics/overview','/admin/analytics/audience','/admin/analytics/playback-quality','/admin/analytics/health','/admin/app-entry-ad-policies']) {
        const samples=[]; let last;
        for (let i=0;i<6;i++) {
          const start=performance.now();
          const response = await fetch(`https://api.evergreenprosper.com${prefix}${endpoint}`, { headers:{Authorization:`Bearer ${token}`}, signal:AbortSignal.timeout(30000) });
          const body=await response.json();
          samples.push(Math.round(performance.now()-start));
          last={status:response.status, updatedAt:body.updatedAt, items:body.items?.length, counts:body.counts};
        }
        report.latency.push({key,endpoint,samples,p50:percentile(samples,.5),p95:percentile(samples,.95),...last});
      }
      if (key==='talereels') {
        report.coverSamples=await db.coverAsset.findMany({where:{status:'READY'},orderBy:{fileSize:'desc'},take:5,select:{publicUrl:true,fileSize:true,width:true,height:true}});
        report.indexes=await db.$queryRaw`select indexname,indexdef from pg_indexes where schemaname=${schema} and tablename in ('AppSession','PlaybackQualityEvent')`;
        const start = new Date(Date.now()-30*86400000), end = new Date();
        report.explain={};
        for (const [name, query] of [
          ['active',`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT COUNT(DISTINCT "userId") FROM "${schema}"."AppSession" WHERE "startedAt" >= $1 AND "startedAt" < $2`],
          ['playback',`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT COUNT(*) FROM "${schema}"."PlaybackQualityEvent" WHERE "createdAt" >= $1 AND "createdAt" < $2 AND "eventType"='ERROR'`]
        ]) report.explain[name]=await db.$queryRawUnsafe(query,start,end);
      }
    } finally { await db.$disconnect(); }
  }
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message.replace(/postgres(?:ql)?:\/\/[^@\s]+@/g,'postgresql://***@'));process.exitCode=1;});

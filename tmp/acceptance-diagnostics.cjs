const { createHmac } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { miniAppEnvironment } = require('./dist/config/mini-apps');
const { runtimeDatabaseUrl } = require('./dist/config/database-pool');
const env = loadEnv();
const marker = `ACCEPTANCE_${Date.now()}`;
const jwt = (claims) => {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ ...claims, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+600 })).toString('base64url');
  return h+'.'+p+'.'+createHmac('sha256', env.JWT_SECRET).update(h+'.'+p).digest('base64url');
};
const dbFor = (key) => {
  const ctx = miniAppEnvironment(env, key);
  return new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl(ctx.DATABASE_URL, env.DATABASE_POOLER_HOST, env.DATABASE_POOLER_PORT) } } });
};
(async () => {
  const tale = dbFor('talereels');
  const tv = dbFor('taletv');
  const report = { marker, posts: [] };
  try {
    const admin = await tale.adminUser.findFirst({ where: { status:'ACTIVE', role:'OWNER' }, select: { id:true, role:true, tokenVersion:true } });
    if (!admin) throw new Error('No active owner');
    const token = jwt({ sub:admin.id, role:admin.role, tokenVersion:admin.tokenVersion, kind:'admin', appKey:'talereels' });
    for (const kind of ['STARTUP','AD','PLAYBACK']) {
      const response = await fetch('https://api.evergreenprosper.com/api/talereels/v1/runtime-errors', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ kind, releaseId:'acceptance-test', phase:`${marker}_${kind}`, message:`${marker} test Bearer secret https://example.test/path?token=private`, path:'/episodes?token=private', requestId:`${marker}_${kind}`, statusCode:503, durationMs:1234, occurredAt:new Date().toISOString() }), signal:AbortSignal.timeout(10000)
      });
      report.posts.push({kind,status:response.status});
    }
    const response = await fetch('https://api.evergreenprosper.com/api/talereels/v1/admin/analytics/health?minutes=30', {headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
    const health = await response.json();
    const items = (health.recent ?? []).filter(item => item.message.includes(marker));
    report.health = { status:response.status, counts:health.counts, rows:items.map(({kind,createdAt,occurredAt,message,releaseId,path,requestId,statusCode,durationMs})=>({kind,createdAt,occurredAt,message,releaseId,path,requestId,statusCode,durationMs})) };
    report.isolation = {talereels:await tale.miniAppRuntimeError.count({where:{message:{contains:marker}}}),taletv:await tv.miniAppRuntimeError.count({where:{message:{contains:marker}}})};
    report.pass = report.posts.every(p=>p.status===202) && response.status===200 && items.length===3 && report.isolation.talereels===3 && report.isolation.taletv===0 && items.every(x=>x.message.includes('[URL]') && x.message.includes('Bearer [REDACTED]') && x.path==='/episodes' && x.requestId?.startsWith(marker));
  } finally {
    report.cleanup = {talereels:(await tale.miniAppRuntimeError.deleteMany({where:{message:{contains:marker}}})).count,taletv:(await tv.miniAppRuntimeError.deleteMany({where:{message:{contains:marker}}})).count};
    await Promise.all([tale.$disconnect(),tv.$disconnect()]);
    console.log(JSON.stringify(report,null,2));
  }
  if (!report.pass) process.exitCode=1;
})().catch(e=>{ console.error(String(e.message).replace(/postgres(?:ql)?:\/\/[^@\s]+@/g,'postgresql://***@')); process.exitCode=1 });

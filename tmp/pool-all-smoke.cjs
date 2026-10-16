const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { configuredMiniAppKeys, miniAppEnvironment } = require('./dist/config/mini-apps');
const { runtimeDatabaseUrl } = require('./dist/config/database-pool');
const env = loadEnv();
const clients = configuredMiniAppKeys(env).map(key => {
  const direct = miniAppEnvironment(env, key).DATABASE_URL;
  const url = runtimeDatabaseUrl(direct, env.DATABASE_POOLER_HOST, env.DATABASE_POOLER_PORT);
  assert.equal(new URL(url).hostname, 'pgbouncer');
  assert.equal(new URL(url).searchParams.get('connection_limit'), '3');
  return { key, schema: new URL(direct).searchParams.get('schema') || 'public', db: new PrismaClient({ datasources: { db: { url } } }) };
});
(async () => {
  const start = Date.now();
  try {
    const results = await Promise.all(clients.map(async ({ key, schema, db }) => {
      const rows = await Promise.all(Array.from({ length: 6 }, () => db.$queryRawUnsafe('select current_schema() as schema from pg_sleep(0.01)')));
      rows.forEach(row => assert.equal(row[0].schema, schema, key));
      await db.$transaction(async tx => {
        const txRows = await tx.$queryRawUnsafe('select current_schema() as schema');
        assert.equal(txRows[0].schema, schema, key);
        await tx.appEntryAdPolicy.findMany({ take: 1 });
      }, { maxWait: 20000, timeout: 10000 });
      return key;
    }));
    const main = clients.find(c => c.key === 'main');
    await main.db.miniAppCodeRelease.findMany({ take: 1 });
    console.log(JSON.stringify({ ok: true, apps: results.length, concurrentQueries: results.length * 6, transactions: results.length, durationMs: Date.now() - start }));
  } finally { await Promise.all(clients.map(c => c.db.$disconnect())); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });

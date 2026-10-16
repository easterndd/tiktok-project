const { PrismaClient } = require('@prisma/client');
const { loadEnv } = require('./dist/config/env');
const { configuredMiniAppKeys, miniAppEnvironment } = require('./dist/config/mini-apps');
const { runtimeDatabaseUrl } = require('./dist/config/database-pool');
const { refreshAnalyticsDailySummaries } = require('./dist/services/analytics-summary.service');

const env = { ...loadEnv(), MINI_APP_KEY: 'main' };
const target = process.argv[2];
const keys = configuredMiniAppKeys(env).filter((key) => !target || target === key);
(async () => {
  for (const key of keys) {
    const context = miniAppEnvironment(env, key);
    if (!context) continue;
    const prisma = new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl(context.DATABASE_URL, env.DATABASE_POOLER_HOST, env.DATABASE_POOLER_PORT) } } });
    try {
      const started = Date.now();
      const result = await refreshAnalyticsDailySummaries(prisma, { days: 90 });
      console.log(`${key}: ${result.rows} days, ${Date.now() - started} ms`);
    } catch (error) {
      console.error(`${key}: ${error.code || error.message}`);
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

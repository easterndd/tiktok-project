const { PrismaClient } = require('@prisma/client');
const { refreshAnalyticsDailySummaries } = require('./dist/services/analytics-summary.service.js');
const { runtimeDatabaseUrl } = require('./dist/config/database-pool.js');
const prisma = new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl(process.env.DATABASE_URL, process.env.DATABASE_POOLER_HOST, process.env.DATABASE_POOLER_PORT) } } });
refreshAnalyticsDailySummaries(prisma, { days: 2 }).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());

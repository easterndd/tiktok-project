set -eu
sudo docker exec quickreels-api-1 node -e '
const { PrismaClient } = require("@prisma/client");
const { loadEnv } = require("./dist/config/env");
const { miniAppEnvironment } = require("./dist/config/mini-apps");
const { runtimeDatabaseUrl } = require("./dist/config/database-pool");
const env = loadEnv();
const url = runtimeDatabaseUrl(miniAppEnvironment(env, "talereels").DATABASE_URL, env.DATABASE_POOLER_HOST, env.DATABASE_POOLER_PORT);
const db = new PrismaClient({ datasources: { db: { url } } });
(async () => {
  try {
    const policies = await db.appEntryAdPolicy.findMany({
      select: { releaseId: true, createdAt: true, updatedAt: true, enabled: true, version: true },
      orderBy: { createdAt: "asc" }
    });
    const sessions = await db.appEntryAdSession.groupBy({
      by: ["releaseId"],
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true }
    });
    const edits = await db.auditLog.findMany({
      where: { resource: "AppEntryAdPolicy" },
      select: { resourceId: true, createdAt: true, action: true },
      orderBy: { createdAt: "desc" },
      take: 20
    });
    console.log(JSON.stringify({ policies, sessions, edits }));
  } finally {
    await db.$disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
'

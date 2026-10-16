set -eu
umask 077
backup="/home/ubuntu/talereels-v4-policy-$(date -u +%Y%m%dT%H%M%SZ).json"

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
    const policy = await db.appEntryAdPolicy.findUnique({ where: { releaseId: "talereels-v4" } });
    const sessionCount = await db.appEntryAdSession.count({ where: { releaseId: "talereels-v4" } });
    if (!policy || sessionCount !== 0) throw new Error(`Deletion precondition failed: policy=${Boolean(policy)}, sessions=${sessionCount}`);
    console.log(JSON.stringify({ policy, sessionCount }));
  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
' > "$backup"
test -s "$backup"

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
    const removed = await db.$queryRaw`
      DELETE FROM "AppEntryAdPolicy"
      WHERE "releaseId" = ${"talereels-v4"}
        AND NOT EXISTS (SELECT 1 FROM "AppEntryAdSession" WHERE "releaseId" = ${"talereels-v4"})
      RETURNING "releaseId"
    `;
    if (removed.length !== 1) throw new Error(`Expected one deletion, got ${removed.length}`);
    const remaining = await db.appEntryAdPolicy.findMany({ select: { releaseId: true }, orderBy: { releaseId: "asc" } });
    console.log(JSON.stringify({ deleted: removed[0].releaseId, remaining: remaining.map(row => row.releaseId) }));
  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
'
printf 'Backup: %s\n' "$backup"

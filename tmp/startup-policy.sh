set -eu
sudo docker exec quickreels-api-1 node -e '
const {PrismaClient}=require("@prisma/client");const {loadEnv}=require("./dist/config/env");const {miniAppEnvironment}=require("./dist/config/mini-apps");const {runtimeDatabaseUrl}=require("./dist/config/database-pool");const e=loadEnv();const db=new PrismaClient({datasources:{db:{url:runtimeDatabaseUrl(miniAppEnvironment(e,"taletv").DATABASE_URL,e.DATABASE_POOLER_HOST,e.DATABASE_POOLER_PORT)}}});
(async()=>{try{const p=await db.appEntryAdPolicy.findMany({select:{releaseId:true,enabled:true,mode:true,requiredCount:true,countMode:true,onUnavailable:true,version:true}});console.log(JSON.stringify(p))}finally{await db.$disconnect()}})().catch(e=>{console.error(e.message);process.exitCode=1})'

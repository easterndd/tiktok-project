set -eu
sudo docker exec quickreels-api-1 node -e '
const {PrismaClient}=require("@prisma/client");
const {loadEnv}=require("./dist/config/env");
const {miniAppEnvironment}=require("./dist/config/mini-apps");
const {runtimeDatabaseUrl}=require("./dist/config/database-pool");
const e=loadEnv();
const client=url=>new PrismaClient({datasources:{db:{url:runtimeDatabaseUrl(url,e.DATABASE_POOLER_HOST,e.DATABASE_POOLER_PORT)}}});
const app=client(miniAppEnvironment(e,"talereels").DATABASE_URL);
const shared=client(e.SHARED_PLATFORM_DATABASE_URL||e.DATABASE_URL);
(async()=>{try{
 const policies=await app.appEntryAdPolicy.findMany({select:{releaseId:true,enabled:true},orderBy:{updatedAt:"desc"}});
 const labels=await shared.miniAppCodeRelease.findMany({where:{miniAppKey:"talereels"},select:{releaseId:true,portalVersion:true,portalStatus:true}});
 console.log(JSON.stringify({policies,labels}));
}finally{await Promise.all([app.$disconnect(),shared.$disconnect()])}})().catch(e=>{console.error(e.message);process.exitCode=1});
'

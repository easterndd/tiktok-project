set -eu
sudo docker exec quickreels-api-1 node -e '
const {PrismaClient}=require("@prisma/client");
const {loadEnv}=require("./dist/config/env");
const {miniAppEnvironment}=require("./dist/config/mini-apps");
const {runtimeDatabaseUrl}=require("./dist/config/database-pool");
const e=loadEnv();const db=new PrismaClient({datasources:{db:{url:runtimeDatabaseUrl(miniAppEnvironment(e,"taletv").DATABASE_URL,e.DATABASE_POOLER_HOST,e.DATABASE_POOLER_PORT)}}});
(async()=>{try{
 const from=new Date("2026-10-15T10:00:00Z"),to=new Date("2026-10-15T10:03:00Z");
 const sessions=await db.appEntryAdSession.findMany({where:{createdAt:{gte:from,lt:to}},select:{id:true,createdAt:true,updatedAt:true,releaseId:true,mode:true,status:true,requiredCount:true,completedCount:true}});
 const rows=[];for(const s of sessions){const events=await db.adEvent.findMany({where:{appEntrySessionId:s.id},select:{eventType:true,createdAt:true,errorCode:true,adIndex:true},orderBy:{createdAt:"asc"}});rows.push({session:{createdAt:s.createdAt,updatedAt:s.updatedAt,releaseId:s.releaseId,mode:s.mode,status:s.status,requiredCount:s.requiredCount,completedCount:s.completedCount},events})}
 console.log(JSON.stringify(rows));
}finally{await db.$disconnect()}})().catch(err=>{console.error(err.message);process.exitCode=1});
'

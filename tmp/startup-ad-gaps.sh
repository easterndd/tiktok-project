set -eu
sudo docker exec quickreels-api-1 node -e '
const {PrismaClient}=require("@prisma/client");
const {loadEnv}=require("./dist/config/env");
const {miniAppEnvironment}=require("./dist/config/mini-apps");
const {runtimeDatabaseUrl}=require("./dist/config/database-pool");
const env=loadEnv();
const url=runtimeDatabaseUrl(miniAppEnvironment(env,"taletv").DATABASE_URL,env.DATABASE_POOLER_HOST,env.DATABASE_POOLER_PORT);
const db=new PrismaClient({datasources:{db:{url}}});
const from=new Date("2026-10-15T09:58:00Z"),to=new Date("2026-10-15T10:08:00Z");
(async()=>{try{
 const events=await db.adEvent.findMany({where:{scope:"APP_ENTRY",createdAt:{gte:from,lt:to}},select:{appEntrySessionId:true,adIndex:true,eventType:true,createdAt:true},orderBy:{createdAt:"asc"}});
 const sessions=await db.appEntryAdSession.findMany({where:{createdAt:{gte:from,lt:to}},select:{id:true,createdAt:true,mode:true,releaseId:true}});
 const bySession=new Map(sessions.map(s=>[s.id,s]));
 const grouped=new Map();for(const e of events){const key=e.appEntrySessionId+":"+e.adIndex;const g=grouped.get(key)||{};g[e.eventType]=e.createdAt;grouped.set(key,g)}
 const rows=[];for(const [key,g] of grouped){const id=key.slice(0,key.lastIndexOf(":"));const s=bySession.get(id);rows.push({sessionAt:s?.createdAt?.toISOString().slice(11,19),mode:s?.mode,release:s?.releaseId,requestAt:g.REQUESTED?.toISOString().slice(11,19),requestToShownMs:g.REQUESTED&&g.SHOWN?g.SHOWN-g.REQUESTED:null,failed:Boolean(g.FAILED),shown:Boolean(g.SHOWN)})}
 console.log(JSON.stringify({sessions:sessions.length,events:events.length,rows}));
}finally{await db.$disconnect()}})().catch(e=>{console.error(e.message);process.exitCode=1});
'

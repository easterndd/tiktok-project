set -eu
cd /opt/quickreels
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps pgbouncer
sudo docker logs --tail 30 quickreels-pgbouncer-1
sudo docker exec quickreels-api-1 node -e '
const {PrismaClient}=require("@prisma/client");
const {loadEnv}=require("./dist/config/env");
const {miniAppEnvironment}=require("./dist/config/mini-apps");
const env=loadEnv();
const run=async(key)=>{
  const original=key==="main"?env.DATABASE_URL:miniAppEnvironment(env,key).DATABASE_URL;
  const url=new URL(original);url.hostname="pgbouncer";url.port="6432";url.pathname+="__"+(url.searchParams.get("schema")||"public");url.searchParams.set("connection_limit","3");url.searchParams.set("pool_timeout","20");
  const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
  try{
    const rows=await Promise.all(Array.from({length:12},()=>db.$queryRawUnsafe("select current_schema() as schema")));
    const tx=await db.$transaction(async(t)=>t.$queryRawUnsafe("select current_schema() as schema"));
    await db.appEntryAdPolicy.findMany({take:1});
    const expected=url.searchParams.get("schema")||"public";
    if(rows.some(r=>r[0].schema!==expected)||tx[0].schema!==expected)throw new Error("schema mismatch for "+key+": "+JSON.stringify({expected,rows:rows.map(r=>r[0].schema),tx:tx[0].schema}));
    console.log(key+" schema="+expected+" queries=12 transaction=ok");
  }finally{await db.$disconnect()}
};
(async()=>{await Promise.all([run("main"),run("talereels")])})().catch(e=>{console.error(e);process.exitCode=1});
'

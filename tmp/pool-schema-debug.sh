set -eu
sudo docker exec quickreels-pgbouncer-1 sh -c 'grep -E "track_extra_parameters|pool_mode" /opt/pooler/pgbouncer.ini'
sudo docker exec quickreels-api-1 node -e '
const {PrismaClient}=require("@prisma/client");
const {loadEnv}=require("./dist/config/env");
const {miniAppEnvironment}=require("./dist/config/mini-apps");
const u=miniAppEnvironment(loadEnv(),"talereels").DATABASE_URL;
const db=new PrismaClient({datasources:{db:{url:u}}});
db.$queryRawUnsafe("select current_schema() as schema").then(r=>console.log("direct="+r[0].schema)).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());
'

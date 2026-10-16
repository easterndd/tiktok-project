set -eu
cd /opt/quickreels
sha256sum apps/api/src/services/platform-sync.service.ts apps/admin-web/src/main.tsx
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin
sudo docker exec quickreels-api-1 node -e "const{PrismaClient}=require('@prisma/client');const{loadEnv}=require('./dist/config/env');const{miniAppEnvironment}=require('./dist/config/mini-apps');(async()=>{let p=new PrismaClient({datasources:{db:{url:miniAppEnvironment(loadEnv(),'lucidreel').DATABASE_URL}}});console.log(JSON.stringify({activeUploadJobs:await p.uploadJob.count({where:{status:{in:['PENDING','PROCESSING']}}}),activePlatformJobs:await p.platformSyncJob.count({where:{status:{in:['PENDING','PROCESSING']}}})}));await p.\$disconnect()})().catch(e=>{console.error(e.message);process.exit(1)})"

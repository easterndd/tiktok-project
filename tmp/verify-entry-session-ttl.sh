set -eu
cd /opt/quickreels
printf 'API '; curl --max-time 8 --fail --silent --show-error https://api.evergreenprosper.com/ready
printf '\nADMIN '; curl --max-time 8 --fail --silent --show-error https://admin.evergreenprosper.com/health
printf '\nCONTAINERS\n'; sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin postgres pgbouncer
printf 'API RESTARTS '; sudo docker inspect --format '{{.RestartCount}}' quickreels-api-1
printf '\nPOST-DEPLOY APP ENTRY COUNTS\n'; sudo docker logs --since 90s quickreels-api-1 2>&1 | sudo docker exec -i quickreels-api-1 node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{let q=new Map(),x={};for(const l of s.split("\n")){try{const j=JSON.parse(l);if(j.req&&j.req.url?.startsWith("/api/dramablaze/v1/"))q.set(j.reqId,j.req.url.split("?")[0]);if(j.res&&q.has(j.reqId)){const p=q.get(j.reqId);if(p.includes("app-entry-ad-sessions")||p.endsWith("/ad-events")){x[p]??={};x[p][j.res.statusCode]=(x[p][j.res.statusCode]||0)+1}}}catch{}}console.log(JSON.stringify(x))})'
printf 'API ERRORS\n'; sudo docker logs --since 90s quickreels-api-1 2>&1 | grep -Ei 'PrismaClientKnownRequestError|FATAL|PANIC|ECONNREFUSED|uncaught' | tail -n 15 || true
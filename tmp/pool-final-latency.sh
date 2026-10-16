set -u
cd /opt/quickreels
printf 'INTERNAL API\n'
sudo docker exec quickreels-api-1 node -e 'const paths=["/ready","/api/talereels/v1/albums","/api/talereels/v1/admin/episodes","/api/talereels/v1/admin/app-entry-ad-policy?releaseId=default"];(async()=>{for(const p of paths){const t=Date.now();try{const r=await fetch("http://127.0.0.1:3000"+p);const b=await r.text();console.log(p,r.status,Date.now()-t,b.length)}catch(e){console.error(p,e.message)}}})()'
printf 'PG CONNECTIONS\n'
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from pg_stat_activity;"'
printf 'API LOG TAIL\n'
sudo docker logs --tail 50 quickreels-api-1 2>&1
printf 'POOLER LOG TAIL\n'
sudo docker logs --tail 50 quickreels-pgbouncer-1 2>&1

set -eu
cd /opt/quickreels
compose() { sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml "$@"; }
rollback() {
  printf 'ROLLBACK TO PREVIOUS IMAGES\n'
  sudo docker image tag quickreels-api:before-pool-20261015 quickreels-api:latest
  sudo docker image tag quickreels-worker:before-pool-20261015 quickreels-worker:latest
  sudo docker image tag quickreels-admin:before-pool-20261015 quickreels-admin:latest
  compose up -d --no-deps --force-recreate api worker admin
  compose ps api worker admin
}
for image in api worker admin; do
  sudo docker image inspect "quickreels-$image:before-pool-20261015" >/dev/null
done
if ! compose up -d --no-deps --force-recreate api worker admin; then
  rollback
  exit 1
fi
healthy=0
for attempt in $(seq 1 40); do
  status=$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' quickreels-api-1 2>/dev/null || true)
  if [ "$status" = healthy ]; then healthy=1; break; fi
  if [ "$status" = unhealthy ] || [ "$status" = exited ]; then break; fi
  sleep 5
done
if [ "$healthy" -ne 1 ] || ! sudo docker exec quickreels-api-1 node -e 'fetch("http://127.0.0.1:3000/ready").then(async r=>{console.log("ready="+r.status);process.exit(r.ok?0:1)}).catch(e=>{console.error(e);process.exit(1)})'; then
  rollback
  exit 1
fi
if ! sudo docker exec quickreels-worker-1 node -e 'const {loadEnv}=require("./dist/config/env"); const {runtimeDatabaseUrl}=require("./dist/config/database-pool"); const e=loadEnv(); const u=new URL(runtimeDatabaseUrl(e.DATABASE_URL,e.DATABASE_POOLER_HOST,e.DATABASE_POOLER_PORT)); if(u.hostname!=="pgbouncer")process.exit(1);console.log("worker_pool="+u.host)'; then
  rollback
  exit 1
fi
printf 'ONLINE CONTAINERS\n'
compose ps api worker admin pgbouncer postgres
printf 'POSTGRES CONNECTIONS\n'
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from pg_stat_activity;"'
printf 'WORKER LOG\n'
sudo docker logs --tail 15 quickreels-worker-1 2>&1

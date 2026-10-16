set -eu
cd /opt/quickreels
compose() { sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml "$@"; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/home/ubuntu/analytics-index-before-$stamp
mkdir -p "$backup"
cp apps/api/prisma/schema.prisma "$backup/schema.prisma"
cp apps/api/src/modules/admin/routes.ts "$backup/routes.ts"
cp apps/api/src/services/analytics-summary.service.ts "$backup/analytics-summary.service.ts"
cp apps/api/src/jobs/tiktok-short-drama.worker.ts "$backup/worker.ts"
sudo docker image tag quickreels-api:latest quickreels-api:before-analytics-index-$stamp
sudo docker image tag quickreels-worker:latest quickreels-worker:before-analytics-index-$stamp
complete=0
rollback() {
  status=$?
  trap - EXIT
  if [ "$complete" -ne 1 ]; then
    cp "$backup/schema.prisma" apps/api/prisma/schema.prisma
    cp "$backup/routes.ts" apps/api/src/modules/admin/routes.ts
    cp "$backup/analytics-summary.service.ts" apps/api/src/services/analytics-summary.service.ts
    cp "$backup/worker.ts" apps/api/src/jobs/tiktok-short-drama.worker.ts
    sudo docker image tag quickreels-api:before-analytics-index-$stamp quickreels-api:latest
    sudo docker image tag quickreels-worker:before-analytics-index-$stamp quickreels-worker:latest
    compose up -d --no-deps --force-recreate api worker || true
  fi
  exit "$status"
}
trap rollback EXIT
cp /tmp/analytics-index-schema.prisma apps/api/prisma/schema.prisma
mkdir -p apps/api/prisma/migrations/20261016023000_app_session_active_index
cp /tmp/analytics-index-migration.sql apps/api/prisma/migrations/20261016023000_app_session_active_index/migration.sql
cp /tmp/analytics-index-routes.ts apps/api/src/modules/admin/routes.ts
cp /tmp/analytics-summary.service.ts apps/api/src/services/analytics-summary.service.ts
cp /tmp/analytics-worker.ts apps/api/src/jobs/tiktok-short-drama.worker.ts
compose build api worker
compose up -d --no-deps --force-recreate api
healthy=0
for attempt in $(seq 1 30); do
  state=$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' quickreels-api-1 2>/dev/null || true)
  if [ "$state" = healthy ]; then healthy=1; break; fi
  if [ "$state" = unhealthy ] || [ "$state" = exited ]; then break; fi
  sleep 3
done
test "$healthy" -eq 1
sudo docker cp /tmp/analytics-migrate-all.cjs quickreels-api-1:/app/apps/api/analytics-migrate-all.cjs
sudo docker exec quickreels-api-1 node analytics-migrate-all.cjs
compose up -d --no-deps --force-recreate worker
curl --retry 8 --retry-delay 2 --retry-all-errors --max-time 10 --fail --silent --show-error https://api.evergreenprosper.com/ready
printf '\nDEPLOYED BACKUP %s\n' "$backup"
complete=1

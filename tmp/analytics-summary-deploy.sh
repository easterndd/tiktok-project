set -eu
cd /opt/quickreels
compose() { sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml "$@"; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/home/ubuntu/analytics-summary-before-$stamp
mkdir -p "$backup"
cp apps/api/prisma/schema.prisma "$backup/schema.prisma"
cp apps/api/src/services/analytics-summary.service.ts "$backup/analytics-summary.service.ts" 2>/dev/null || true
cp apps/api/src/jobs/tiktok-short-drama.worker.ts "$backup/worker.ts"
cp apps/api/src/modules/admin/routes.ts "$backup/routes.ts"
cp apps/admin-web/src/main.tsx "$backup/main.tsx"
cp apps/admin-web/src/styles.css "$backup/styles.css"
sudo docker image tag quickreels-api:latest quickreels-api:before-analytics-summary-$stamp
sudo docker image tag quickreels-admin:latest quickreels-admin:before-analytics-summary-$stamp
complete=0
rollback() {
  status=$?
  trap - EXIT
  if [ "$complete" -ne 1 ]; then
    cp "$backup/schema.prisma" apps/api/prisma/schema.prisma
    cp "$backup/worker.ts" apps/api/src/jobs/tiktok-short-drama.worker.ts
    cp "$backup/routes.ts" apps/api/src/modules/admin/routes.ts
    cp "$backup/main.tsx" apps/admin-web/src/main.tsx
    cp "$backup/styles.css" apps/admin-web/src/styles.css
    sudo docker image tag quickreels-api:before-analytics-summary-$stamp quickreels-api:latest
    sudo docker image tag quickreels-admin:before-analytics-summary-$stamp quickreels-admin:latest
    compose up -d --no-deps --force-recreate api worker admin || true
  fi
  exit "$status"
}
trap rollback EXIT
cp /tmp/analytics-schema.prisma apps/api/prisma/schema.prisma
cp /tmp/analytics-migration.sql apps/api/prisma/migrations/20261016020000_analytics_daily_summary/migration.sql
cp /tmp/analytics-summary.service.ts apps/api/src/services/analytics-summary.service.ts
cp /tmp/analytics-worker.ts apps/api/src/jobs/tiktok-short-drama.worker.ts
cp /tmp/analytics-routes.ts apps/api/src/modules/admin/routes.ts
cp /tmp/analytics-main.tsx apps/admin-web/src/main.tsx
cp /tmp/analytics-styles.css apps/admin-web/src/styles.css
compose build api admin
compose run --rm --no-deps api npx prisma migrate deploy
compose up -d --no-deps --force-recreate api worker admin
healthy=0
for attempt in $(seq 1 30); do
  state=$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' quickreels-api-1 2>/dev/null || true)
  if [ "$state" = healthy ]; then healthy=1; break; fi
  if [ "$state" = unhealthy ] || [ "$state" = exited ]; then break; fi
  sleep 3
done
test "$healthy" -eq 1
curl --retry 8 --retry-delay 2 --retry-all-errors --max-time 10 --fail --silent --show-error https://api.evergreenprosper.com/ready
printf '\n'
curl --retry 8 --retry-delay 2 --retry-all-errors --max-time 10 --fail --silent --show-error https://admin.evergreenprosper.com/health
printf '\n'
compose ps api worker admin
printf 'DEPLOYED BACKUP %s\n' "$backup"
complete=1

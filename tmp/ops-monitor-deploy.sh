set -eu
cd /opt/quickreels
compose() { sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml "$@"; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/home/ubuntu/ops-monitor-before-$stamp
mkdir -p "$backup"
cp apps/admin-web/src/main.tsx "$backup/main.tsx"
cp apps/api/src/modules/admin/routes.ts "$backup/routes.ts"
sudo docker image tag quickreels-api:latest quickreels-api:before-ops-monitor-$stamp
sudo docker image tag quickreels-admin:latest quickreels-admin:before-ops-monitor-$stamp
complete=0
rollback() {
  status=$?
  trap - EXIT
  if [ "$complete" -ne 1 ]; then
    cp "$backup/main.tsx" apps/admin-web/src/main.tsx
    cp "$backup/routes.ts" apps/api/src/modules/admin/routes.ts
    sudo docker image tag quickreels-api:before-ops-monitor-$stamp quickreels-api:latest
    sudo docker image tag quickreels-admin:before-ops-monitor-$stamp quickreels-admin:latest
    compose up -d --no-deps --force-recreate api admin || true
    printf 'ROLLED BACK %s\n' "$backup"
  fi
  exit "$status"
}
trap rollback EXIT
cp /tmp/ops-main.tsx apps/admin-web/src/main.tsx
cp /tmp/ops-routes.ts apps/api/src/modules/admin/routes.ts
compose build api admin
compose up -d --no-deps --force-recreate api admin
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
complete=1
printf 'DEPLOYED BACKUP %s\n' "$backup"

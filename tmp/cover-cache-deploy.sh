set -eu
cd /opt/quickreels
compose() { sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml "$@"; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/home/ubuntu/cover-cache-before-$stamp
mkdir -p "$backup"
cp apps/api/src/app.ts "$backup/app.ts"
sudo docker image tag quickreels-api:latest quickreels-api:before-cover-cache-$stamp
complete=0
rollback() {
  status=$?
  trap - EXIT
  if [ "$complete" -ne 1 ]; then
    cp "$backup/app.ts" apps/api/src/app.ts
    sudo docker image tag quickreels-api:before-cover-cache-$stamp quickreels-api:latest
    compose up -d --no-deps --force-recreate api || true
  fi
  exit "$status"
}
trap rollback EXIT
cp /tmp/cover-cache-app.ts apps/api/src/app.ts
compose build api
compose up -d --no-deps --force-recreate api
healthy=0
for attempt in $(seq 1 30); do
  state=$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' quickreels-api-1 2>/dev/null || true)
  if [ "$state" = healthy ]; then healthy=1; break; fi
  if [ "$state" = unhealthy ] || [ "$state" = exited ]; then break; fi
  sleep 3
done
test "$healthy" -eq 1
curl --retry 8 --retry-delay 2 --retry-all-errors --max-time 10 --fail --silent --show-error https://api.evergreenprosper.com/ready
printf '\nDEPLOYED BACKUP %s\n' "$backup"
complete=1

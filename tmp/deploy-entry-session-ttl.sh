set -eu
cd /opt/quickreels
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/home/ubuntu/entry-session-ttl-before-$stamp
mkdir -p "$backup"
cp apps/api/src/modules/ads/routes.ts "$backup/ads-routes.ts"
cp apps/api/src/modules/app-entry-ads/routes.ts "$backup/app-entry-routes.ts"
sudo docker image tag quickreels-api:latest "quickreels-api:entry-session-ttl-before-$stamp"
cp /tmp/entry-session-ads-routes.ts apps/api/src/modules/ads/routes.ts
cp /tmp/entry-session-app-entry-routes.ts apps/api/src/modules/app-entry-ads/routes.ts
printf 'BACKUP %s\n' "$backup"
sha256sum apps/api/src/modules/ads/routes.ts apps/api/src/modules/app-entry-ads/routes.ts
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build api
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml up -d --no-deps --force-recreate api
healthy=0
for attempt in $(seq 1 30); do
  state=$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' quickreels-api-1 2>/dev/null || true)
  if [ "$state" = healthy ]; then healthy=1; break; fi
  if [ "$state" = unhealthy ] || [ "$state" = exited ]; then break; fi
  sleep 3
done
test "$healthy" -eq 1
printf 'API_READY '; curl --retry 6 --retry-delay 2 --retry-all-errors --max-time 8 --fail --silent --show-error https://api.evergreenprosper.com/ready
printf '\nADMIN_HEALTH '; curl --max-time 8 --fail --silent --show-error https://admin.evergreenprosper.com/health
printf '\nSERVICES\n'; sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin postgres pgbouncer
printf 'DEPLOYED %s\n' "$stamp"

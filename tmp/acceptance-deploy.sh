set -eu
cd /opt/quickreels
backup=$(cat /tmp/acceptance-backup-path)
stamp=${backup##*acceptance-before-}
rollback() {
  for service in api worker admin; do sudo docker tag "quickreels-$service:acceptance-before-$stamp" "quickreels-$service:latest"; done
  sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml up -d --no-deps api worker admin
}
sudo docker run --rm --entrypoint sh quickreels-api -c 'test -f dist/modules/diagnostics/routes.js'
if ! sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml up -d --no-deps api worker admin covers; then rollback; exit 1; fi
healthy=0
for i in $(seq 1 18); do
  if curl -fsS https://api.evergreenprosper.com/ready >/dev/null && curl -fsS https://admin.evergreenprosper.com/health >/dev/null; then healthy=1; break; fi
  sleep 5
done
if [ "$healthy" != 1 ]; then rollback; exit 1; fi
sudo docker exec quickreels-api-1 node dist/scripts/backfill-cover-thumbnails.js
sudo docker inspect quickreels-api-1 quickreels-worker-1 quickreels-admin-1 quickreels-covers-1 --format '{{.Name}} {{.Image}} {{.State.Status}}'
sudo docker inspect evergreenprosper-website-web-1 --format '{{json .NetworkSettings.Networks}}'
cat /opt/evergreenprosper-website/Caddyfile

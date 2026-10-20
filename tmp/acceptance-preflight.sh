set -eu
cd /opt/quickreels
date -u +%FT%TZ
df -h .
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin covers postgres pgbouncer
sudo docker inspect quickreels-api-1 quickreels-worker-1 quickreels-admin-1 --format '{{.Name}} {{.Image}} {{.State.StartedAt}}'
sha256sum apps/api/src/modules/admin/routes.ts apps/api/src/services/analytics-summary.service.ts apps/api/src/modules/diagnostics/routes.ts apps/admin-web/src/main.tsx apps/admin-web/src/health-panel.tsx
sudo docker exec quickreels-api-1 sh -c 'test -f dist/modules/diagnostics/routes.js && echo DIAGNOSTICS_BUILT; test -f dist/services/analytics-summary.service.js && echo SUMMARY_BUILT'
sed -n '/api.evergreenprosper.com/,/^[}]$/p' /opt/evergreenprosper-website/Caddyfile | head -65
curl --max-time 15 --fail --silent --show-error https://api.evergreenprosper.com/ready
printf '\n'
curl --max-time 15 --fail --silent --show-error https://admin.evergreenprosper.com/health
printf '\n'

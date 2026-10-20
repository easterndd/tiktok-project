set -eu
cd /opt/quickreels
printf 'SOURCE HASHES\n'
sha256sum apps/admin-web/src/main.tsx apps/api/src/modules/admin/routes.ts
printf 'BUILT MARKERS\n'
sudo docker exec quickreels-api-1 sh -c 'grep -l "ANALYTICS_CACHE_TTL_MS" dist/modules/admin/routes.js'
sudo docker exec quickreels-admin-1 sh -c 'ls /usr/share/nginx/html/assets/index-*.js'
printf 'HEALTH\n'
curl --max-time 10 --fail --silent --show-error https://api.evergreenprosper.com/ready
printf '\n'
curl --max-time 10 --fail --silent --show-error https://admin.evergreenprosper.com/health
printf '\nRECENT 5XX\n'
sudo docker logs --since 3m quickreels-api-1 2>&1 | grep '"statusCode":5[0-9][0-9]' | tail -10 || true

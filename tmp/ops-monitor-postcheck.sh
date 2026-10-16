set -eu
cd /opt/quickreels
printf 'HASHES\n'
sha256sum apps/admin-web/src/main.tsx apps/api/src/modules/admin/routes.ts
printf 'BUILT\n'
sudo docker exec quickreels-api-1 sh -c 'grep -l "analytics/health" dist/modules/admin/routes.js'
sudo docker exec quickreels-admin-1 sh -c 'grep -l "小程序运行异常" /usr/share/nginx/html/assets/index-*.js'
printf 'HEALTH\n'
curl --max-time 10 --fail --silent --show-error https://api.evergreenprosper.com/ready
printf '\n'
curl --max-time 10 --fail --silent --show-error https://admin.evergreenprosper.com/health
printf '\nANON ADMIN HEALTH API\n'
curl --max-time 10 --silent --show-error --output /dev/null --write-out '%{http_code}\n' 'https://api.evergreenprosper.com/api/talereels/v1/admin/analytics/health'
printf '5XX\n'
sudo docker logs --since 3m quickreels-api-1 2>&1 | grep '"statusCode":5[0-9][0-9]' | tail -10 || true

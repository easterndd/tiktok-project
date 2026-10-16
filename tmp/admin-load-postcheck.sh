set -eu
cd /opt/quickreels
printf 'SOURCE HASHES\n'
sha256sum apps/admin-web/src/main.tsx apps/admin-web/src/styles.css apps/api/src/modules/admin/routes.ts
printf 'BUILT ASSETS\n'
sudo docker exec quickreels-admin-1 sh -c 'ls /usr/share/nginx/html/assets/index-*.js; grep -l "正在加载概览数据" /usr/share/nginx/html/assets/index-*.js'
printf 'API BUILD\n'
sudo docker exec quickreels-api-1 sh -c 'grep -l "COUNT(DISTINCT" dist/modules/admin/routes.js'
printf 'HTTP\n'
for url in https://admin.evergreenprosper.com/ https://admin.evergreenprosper.com/health https://api.evergreenprosper.com/ready https://api.evergreenprosper.com/api/talereels/v1/albums; do
  curl --max-time 15 --silent --show-error --output /dev/null --write-out '%{http_code} %{time_total}s\n' "$url"
done
printf 'AUTH STATUS\n'
curl --max-time 15 --silent --show-error --output /dev/null --write-out '%{http_code} %{time_total}s\n' https://api.evergreenprosper.com/api/talereels/v1/admin/me
printf 'RECENT API 5XX\n'
sudo docker logs --since 3m quickreels-api-1 2>&1 | grep '"statusCode":5[0-9][0-9]' | tail -10 || true
printf 'CONTAINERS\n'
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin

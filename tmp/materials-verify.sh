set -eu
cd /opt/quickreels
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin
curl --max-time 5 --fail --silent --show-error https://api.evergreenprosper.com/ready
sudo docker exec quickreels-admin-1 sh -c 'grep -q "assets/index-" /usr/share/nginx/html/index.html && grep -l "视频已入队，将自动传至 BytePlus" /usr/share/nginx/html/assets/*.js'
sudo docker exec quickreels-api-1 sh -c 'grep -q "albumId" dist/modules/admin/routes.js && echo album-filter-present'
api_id=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q api)
sudo docker cp /tmp/byteplus-recover.cjs "$api_id:/app/apps/api/byteplus-recover.cjs"
sudo docker exec "$api_id" node byteplus-recover.cjs status

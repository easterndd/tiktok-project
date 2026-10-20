set -eu
cd /opt/quickreels
api_id=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q api)
sudo docker cp /tmp/byteplus-detail.cjs "$api_id:/app/apps/api/byteplus-detail.cjs"
sudo docker exec "$api_id" node byteplus-detail.cjs
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml logs --since 6m worker 2>&1 | tail -30
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin

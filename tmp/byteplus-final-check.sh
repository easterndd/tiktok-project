set -eu
cd /opt/quickreels
api_id=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q api)
sudo docker cp /tmp/byteplus-final-check.cjs "$api_id:/app/apps/api/byteplus-final-check.cjs"
sudo docker exec "$api_id" node byteplus-final-check.cjs
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml logs --since 5m worker 2>&1 | tail -25

set -eu
cd /opt/quickreels
api_id=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q api)
sudo docker cp /tmp/byteplus-speed-queue.cjs "$api_id:/app/apps/api/byteplus-speed-queue.cjs"
sudo docker exec "$api_id" node byteplus-speed-queue.cjs

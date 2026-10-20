set -eu
cd /opt/quickreels
api_id=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q api)
sudo docker cp /tmp/byteplus-speed-stats.cjs "$api_id:/app/apps/api/byteplus-speed-stats.cjs"
sudo docker exec "$api_id" node byteplus-speed-stats.cjs
sudo docker stats --no-stream --format '{{.Name}} CPU={{.CPUPerc}} NET={{.NetIO}} MEM={{.MemUsage}}' quickreels-api-1 quickreels-worker-1
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml logs --since 2h worker api 2>&1 | grep -E 'Local upload recovery|Manual upload recovery failed|worker cycle failed' | tail -20 || true

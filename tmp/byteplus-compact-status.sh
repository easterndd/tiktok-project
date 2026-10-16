set -eu
cd /opt/quickreels
api_id=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q api)
sudo docker cp /tmp/byteplus-recover.cjs "$api_id:/app/apps/api/byteplus-recover.cjs"
sudo docker exec "$api_id" node byteplus-recover.cjs status | grep -Ev 'tags length exceeds 36'
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml logs --since 5m worker 2>&1 | grep -E 'Local upload recovery|tags length|upload part error|Worker failed' | tail -12 || true
sudo docker stats --no-stream --format '{{.Name}} CPU={{.CPUPerc}} NET={{.NetIO}}' quickreels-worker-1

set -eu
cd /opt/quickreels
worker_id=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q worker)
sudo docker cp /tmp/parallel-network-check.cjs "$worker_id:/app/apps/api/parallel-network-check.cjs"
sudo docker exec "$worker_id" node parallel-network-check.cjs
sudo docker stats --no-stream --format '{{.Name}} NET={{.NetIO}} MEM={{.MemUsage}}' quickreels-api-1 quickreels-worker-1

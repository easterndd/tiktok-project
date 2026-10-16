set -eu
cd /opt/quickreels
api_id=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q api)
sudo docker cp /tmp/byteplus-detail.cjs "$api_id:/app/apps/api/byteplus-detail.cjs"
sudo docker exec "$api_id" node byteplus-detail.cjs
sudo docker stats --no-stream --format '{{.Name}} CPU={{.CPUPerc}} NET={{.NetIO}} MEM={{.MemUsage}}' quickreels-api-1 quickreels-worker-1
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml logs --since 3m worker api 2>&1 | grep -E 'Local upload recovery|Manual upload recovery failed|worker cycle failed|upload-jobs/.*/reconcile|BytePlus 分片上传失败' | tail -18 || true

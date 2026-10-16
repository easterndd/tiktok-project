set -eu
cd /opt/quickreels
sudo docker exec quickreels-api-1 ps -eo pid,etime,args
sudo docker exec quickreels-postgres-1 sh -c 'ps -o pid,args | head -25'
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml logs --since 10m --tail 12 worker 2>&1
sudo docker exec quickreels-api-1 ls -l /app/apps/api/byteplus-detail.cjs

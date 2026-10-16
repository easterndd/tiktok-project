set -eu
cd /opt/quickreels
sudo docker exec quickreels-postgres-1 pg_isready -U quickreels -d quickreels
sudo docker exec quickreels-api-1 sh -lc 'wget -q -O- http://127.0.0.1:3000/ready'
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps
df -h /

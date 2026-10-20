set -eu
cd /opt/quickreels
cp /tmp/pool-database-pool.ts apps/api/src/config/database-pool.ts
printf 'SOURCE CHECKSUMS\n'
sha256sum /tmp/pool-database-pool.ts apps/api/src/config/database-pool.ts
printf 'COMPOSE VALIDATION\n'
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml config --quiet
printf 'BUILD\n'
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build api worker admin
printf 'IMAGE IDS\n'
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml images api worker admin

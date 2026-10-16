set -eu
cd /opt/quickreels
cp /tmp/pool-entry.mjs deploy/pgbouncer/entry.mjs
cp /tmp/pool-compose.yml compose.production.self-hosted.yml
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build pgbouncer
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml up -d --no-deps --force-recreate pgbouncer
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps pgbouncer

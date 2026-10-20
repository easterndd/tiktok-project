set -eu
cd /opt/quickreels
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml config --quiet
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build api worker admin
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml images api worker admin pgbouncer

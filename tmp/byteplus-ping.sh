set -eu
date -u
cd /opt/quickreels
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker postgres

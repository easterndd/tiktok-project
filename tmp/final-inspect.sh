set -eu
cd /opt/quickreels
sed -n "/api.evergreenprosper.com/,/^[}]$/p" /opt/evergreenprosper-website/Caddyfile | head -50
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml images api worker admin

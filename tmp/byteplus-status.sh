set -eu
cd /opt/quickreels
api_id=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q api)
sudo docker exec "$api_id" node byteplus-recover.cjs status
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml logs --since 4m worker 2>&1 | grep -E 'Local upload recovery|tags length|upload part error|Worker failed' | tail -12 || true
curl --fail --silent --show-error https://api.evergreenprosper.com/ready

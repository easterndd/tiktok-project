set -eu
cd /opt/quickreels
sha256sum apps/api/src/services/byteplus-vod.service.ts
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker
curl --max-time 5 --fail --silent --show-error https://api.evergreenprosper.com/ready

set -eu
cd /opt/quickreels
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml run --rm --no-deps api /app/apps/api/node_modules/.bin/prisma migrate status

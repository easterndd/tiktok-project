set -eu
cd /opt/quickreels
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml run --rm --no-deps api /app/apps/api/node_modules/.bin/prisma migrate deploy
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select to_regclass('"'"'public.\"MiniAppCodeRelease\"'"'"');"'

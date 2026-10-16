set -eu
cd /opt/quickreels
backup=/home/ubuntu/pool-version-backup-20261015
mkdir -p "$backup"
for file in compose.production.self-hosted.yml apps/api/src/app.ts apps/api/src/config/env.ts apps/api/src/jobs/tiktok-short-drama.worker.ts apps/api/src/modules/admin/routes.ts apps/api/src/plugins/prisma.ts apps/api/prisma/schema.prisma apps/admin-web/src/main.tsx; do
  mkdir -p "$backup/$(dirname "$file")"
  cp "$file" "$backup/$file"
done
sudo docker image tag quickreels-api:latest quickreels-api:before-pool-20261015
sudo docker image tag quickreels-worker:latest quickreels-worker:before-pool-20261015
sudo docker image tag quickreels-admin:latest quickreels-admin:before-pool-20261015
printf 'DATABASE BACKUP\n'
if [ ! -s "$backup/database.dump" ]; then
  sudo docker exec quickreels-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/database.dump"
fi
sudo docker exec -i quickreels-postgres-1 pg_restore -l < "$backup/database.dump" > /dev/null
ls -lh "$backup/database.dump"
printf 'SOURCE STAGE\n'
mkdir -p deploy/pgbouncer apps/api/prisma/migrations/20261015110000_mini_app_code_release_status
cp /tmp/pool-Dockerfile deploy/pgbouncer/Dockerfile
cp /tmp/pool-entry.mjs deploy/pgbouncer/entry.mjs
cp /tmp/pool-database-pool.ts apps/api/src/config/database-pool.ts
cp /tmp/pool-migration.sql apps/api/prisma/migrations/20261015110000_mini_app_code_release_status/migration.sql
cp /tmp/pool-app.ts apps/api/src/app.ts
cp /tmp/pool-env.ts apps/api/src/config/env.ts
cp /tmp/pool-worker.ts apps/api/src/jobs/tiktok-short-drama.worker.ts
cp /tmp/pool-routes.ts apps/api/src/modules/admin/routes.ts
cp /tmp/pool-prisma.ts apps/api/src/plugins/prisma.ts
cp /tmp/pool-schema.prisma apps/api/prisma/schema.prisma
cp /tmp/pool-main.tsx apps/admin-web/src/main.tsx
cp /tmp/pool-compose.yml compose.production.self-hosted.yml
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml config --quiet
printf 'POOLER BUILD\n'
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build pgbouncer
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml up -d --no-deps pgbouncer
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps pgbouncer

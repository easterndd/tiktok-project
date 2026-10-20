set -eu
cd /opt/quickreels
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/home/ubuntu/acceptance-before-$stamp
mkdir -p "$backup"
tar -czf "$backup/source.tgz" apps/api apps/admin-web apps/mini-web deploy/covers compose.production.self-hosted.yml pnpm-lock.yaml package.json
cp /opt/evergreenprosper-website/Caddyfile "$backup/Caddyfile"
cp .env.production "$backup/env.production"
chmod 600 "$backup/env.production"
for service in api worker admin; do
  id=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q "$service")
  image=$(sudo docker inspect -f '{{.Image}}' "$id")
  sudo docker tag "$image" "quickreels-$service:acceptance-before-$stamp"
done
sudo docker exec quickreels-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 6' > "$backup/database.dump"
test -s "$backup/database.dump"
printf '%s\n' "$backup" > /tmp/acceptance-backup-path
ls -lh "$backup/database.dump" "$backup/source.tgz"
printf 'BACKUP=%s\n' "$backup"

set -eu
cd /opt/quickreels
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/home/ubuntu/final-release-before-$stamp
mkdir -p "$backup"
tar -czf "$backup/source.tgz" apps/api apps/admin-web compose.production.self-hosted.yml pnpm-lock.yaml package.json 2>/dev/null
cp /opt/evergreenprosper-website/Caddyfile "$backup/Caddyfile"
cp .env.production "$backup/env.production"
chmod 600 "$backup/env.production"
sudo docker image tag quickreels-api:latest quickreels-api:before-final-$stamp
sudo docker image tag quickreels-worker:latest quickreels-worker:before-final-$stamp
sudo docker image tag quickreels-admin:latest quickreels-admin:before-final-$stamp
sudo docker exec quickreels-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 6' > "$backup/database.dump"
test -s "$backup/database.dump"
ls -lh "$backup/database.dump" "$backup/source.tgz"
printf "BACKUP=%s\n" "$backup"

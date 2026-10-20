set -eu
cd /opt/quickreels
test -z "$(git status --porcelain)"
git apply --check /tmp/byteplus-upload-fix.patch
backup=/home/ubuntu/byteplus-recovery-20261013
mkdir -m 700 "$backup"
tar -czf "$backup/source-before.tar.gz" apps/api/src/services/byteplus-vod.service.ts apps/api/src/services/local-upload.service.ts apps/api/src/modules/admin/routes.ts
git rev-parse HEAD > "$backup/commit-before.txt"
cp /tmp/byteplus-upload-fix.patch "$backup/"
for service in api worker; do
  container=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q "$service")
  image=$(sudo docker inspect --format '{{.Image}}' "$container")
  printf '%s %s\n' "$service" "$image" >> "$backup/images-before.txt"
  sudo docker tag "$image" "quickreels-${service}:before-byteplus-fix-20261013"
done
api_id=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q api)
sudo docker exec "$api_id" node byteplus-jobs.cjs > "$backup/jobs-before.jsonl"
git apply /tmp/byteplus-upload-fix.patch
git diff --check
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build api worker 2>&1
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml up -d --no-deps --force-recreate api worker 2>&1
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker
printf 'BACKUP=%s\n' "$backup"

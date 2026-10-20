set -eu
cd /opt/quickreels
git apply --check /tmp/byteplus-resume-fix.patch
backup=/home/ubuntu/byteplus-resume-20261013
mkdir -m 700 "$backup"
tar -czf "$backup/source-before.tar.gz" apps/api/src/services/local-upload.service.ts apps/api/src/modules/admin/routes.ts apps/admin-web/src/main.tsx
cp /tmp/byteplus-resume-fix.patch "$backup/"
for service in api worker admin; do
  container=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q "$service")
  image=$(sudo docker inspect --format '{{.Image}}' "$container")
  sudo docker tag "$image" "quickreels-${service}:before-resume-fix-20261013"
done
git apply /tmp/byteplus-resume-fix.patch
git diff --check
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build api worker admin 2>&1

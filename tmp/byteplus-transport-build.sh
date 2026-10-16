set -eu
cd /opt/quickreels
git apply --check /tmp/byteplus-transport-fix.patch
backup=/home/ubuntu/byteplus-resume-20261013
tar -czf "$backup/transport-before.tar.gz" apps/api/src/services/byteplus-vod.service.ts
cp /tmp/byteplus-transport-fix.patch "$backup/"
git apply /tmp/byteplus-transport-fix.patch
git diff --check
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build api worker 2>&1

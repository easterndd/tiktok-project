set -eu
cd /opt/quickreels
git apply --check /tmp/parallel-two-episodes.patch
backup=/home/ubuntu/byteplus-parallel-20261013
mkdir -p "$backup"
tar -czf "$backup/source-before.tar.gz" apps/api/src/services/local-upload.service.ts apps/api/src/jobs/tiktok-short-drama.worker.ts
cp /tmp/parallel-two-episodes.patch "$backup/"
sudo docker image tag quickreels-worker:latest quickreels-worker:before-two-episode-20261013
git apply /tmp/parallel-two-episodes.patch
git diff --check
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build worker 2>&1
sudo docker image inspect --format '{{.Id}}' quickreels-worker:latest

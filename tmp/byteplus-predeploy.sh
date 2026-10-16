set -eu
cd /opt/quickreels
git apply --check /tmp/byteplus-upload-fix.patch
api_id=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q api)
sudo docker cp /tmp/byteplus-jobs.cjs "$api_id:/app/apps/api/byteplus-jobs.cjs"
sudo docker exec "$api_id" node byteplus-jobs.cjs

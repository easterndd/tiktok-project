set -eu
cd /opt/quickreels
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml up -d --no-deps --force-recreate worker 2>&1
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps worker api
sudo docker inspect --format '{{.Name}} {{.Image}}' quickreels-worker-1
curl --retry 6 --retry-delay 2 --retry-all-errors --max-time 5 --fail --silent --show-error https://api.evergreenprosper.com/ready

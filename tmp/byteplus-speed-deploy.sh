set -eu
cd /opt/quickreels
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml up -d --no-deps --force-recreate api worker 2>&1
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker
curl --retry 10 --retry-delay 3 --retry-all-errors --max-time 5 --fail --silent --show-error https://api.evergreenprosper.com/ready
sudo docker inspect --format '{{.Name}} {{.Image}}' quickreels-api-1 quickreels-worker-1

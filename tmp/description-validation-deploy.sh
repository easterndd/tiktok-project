set -eu
cd /opt/quickreels
backup=/home/ubuntu/description-validation-before-20261014
mkdir -p "$backup"
cp apps/api/src/services/platform-sync.service.ts "$backup/"
cp /tmp/platform-sync.service.ts apps/api/src/services/platform-sync.service.ts
git diff --check -- apps/api/src/services/platform-sync.service.ts
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build api
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml up -d --no-deps --force-recreate api worker
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker
curl --retry 8 --retry-delay 2 --retry-all-errors --max-time 5 --fail --silent --show-error https://api.evergreenprosper.com/ready

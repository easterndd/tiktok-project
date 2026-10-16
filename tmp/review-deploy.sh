set -eu
cd /opt/quickreels
backup=/home/ubuntu/review-fix-before-20261014
mkdir -p "$backup"
cp apps/api/src/services/platform-sync.service.ts apps/admin-web/src/main.tsx "$backup/"
cp /tmp/platform-sync.service.ts apps/api/src/services/platform-sync.service.ts
cp /tmp/main.tsx apps/admin-web/src/main.tsx
git diff --check -- apps/api/src/services/platform-sync.service.ts apps/admin-web/src/main.tsx
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build api admin
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml up -d --no-deps --force-recreate api admin worker
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin
curl --retry 8 --retry-delay 2 --retry-all-errors --max-time 5 --fail --silent --show-error https://api.evergreenprosper.com/ready
sha256sum apps/api/src/services/platform-sync.service.ts apps/admin-web/src/main.tsx

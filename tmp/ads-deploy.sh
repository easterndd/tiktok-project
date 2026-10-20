set -eu
cd /opt/quickreels
test "$(sha256sum apps/admin-web/src/main.tsx | cut -d' ' -f1)" = a483a9f573f51de385d54ebe725bf5137f1c9900731e40efdffbedeb54949d6b
test "$(sha256sum apps/api/src/modules/admin/routes.ts | cut -d' ' -f1)" = 54d9df4bd18fbbce96e8720efe0389e71f06cb6b81fb6ae5483250f0183bef42
test "$(sha256sum apps/api/src/modules/app-entry-ads/routes.ts | cut -d' ' -f1)" = bde28a5e0782ee4b297709256dff971d626c63155a8580cc9e6ea5598c719719
test "$(sha256sum apps/api/src/plugins/auth.ts | cut -d' ' -f1)" = db63f11a1cb5f1cb1085716c22a38075df3cbcc166a0b0d4d034a1dd542f259e
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/home/ubuntu/ads-release-before-$stamp
mkdir -p "$backup"
cp --parents apps/admin-web/src/main.tsx apps/api/src/modules/admin/routes.ts apps/api/src/modules/app-entry-ads/routes.ts apps/api/src/plugins/auth.ts "$backup/"
sudo docker image tag quickreels-api:latest quickreels-api:ads-backup-$stamp
sudo docker image tag quickreels-admin:latest quickreels-admin:ads-backup-$stamp
printf 'BACKUP %s\n' "$backup"
cp /tmp/ads-release-main.tsx apps/admin-web/src/main.tsx
cp /tmp/ads-release-admin-routes.ts apps/api/src/modules/admin/routes.ts
cp /tmp/ads-release-entry-routes.ts apps/api/src/modules/app-entry-ads/routes.ts
cp /tmp/ads-release-auth.ts apps/api/src/plugins/auth.ts
test "$(sha256sum apps/admin-web/src/main.tsx | cut -d' ' -f1)" = 831e6e2cd9c0707350f91d5ff39e39b111134c86c5e8ad6ce732ed39d29c9177
test "$(sha256sum apps/api/src/modules/admin/routes.ts | cut -d' ' -f1)" = edb14e89dc75a2aaa172aee6112fa62327a4e1a81f0858ef113241629c5a1209
test "$(sha256sum apps/api/src/modules/app-entry-ads/routes.ts | cut -d' ' -f1)" = 96aedd8e75a85cb5c60661387f167453739a0c50d7a214fc61bd3383e602e33b
test "$(sha256sum apps/api/src/plugins/auth.ts | cut -d' ' -f1)" = 7fc5d20bb922bba8e237efc31a952ccdd086a8864d2760760f3317a1723219c3
git diff --check -- apps/admin-web/src/main.tsx apps/api/src/modules/admin/routes.ts apps/api/src/modules/app-entry-ads/routes.ts apps/api/src/plugins/auth.ts
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build api admin
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml up -d --no-deps --force-recreate api admin
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin
curl --retry 12 --retry-delay 3 --retry-all-errors --max-time 8 --fail --silent --show-error https://api.evergreenprosper.com/ready
printf '\nADMIN '; curl --retry 8 --retry-delay 2 --retry-all-errors --max-time 8 --fail --silent --show-error https://admin.evergreenprosper.com/health
printf '\nRELEASE_BACKUP %s\n' "$backup"

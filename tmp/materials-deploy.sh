set -eu
cd /opt/quickreels
test "$(sha256sum apps/admin-web/src/drama-materials.tsx | cut -d ' ' -f 1)" = 3966283983812f219f0f5a8f51e479c4bd2e507a7f2be9298610bf4161371bb1
test "$(sha256sum apps/admin-web/src/drama-materials.css | cut -d ' ' -f 1)" = f63645bf95a1ddf81247e982db370ccb2cba1a28209e9d7501557f37758cdb52
test "$(sha256sum apps/admin-web/src/main.tsx | cut -d ' ' -f 1)" = cea74241bbdffa606f06e3b3392874f58982ea386d9ce260e7c52f08a6323a24
test "$(sha256sum apps/api/src/modules/admin/routes.ts | cut -d ' ' -f 1)" = 9208deb24274039ec664778cad308453c869fb92ce8ac2018db12a163e0160a9
backup=/home/ubuntu/materials-before-20261014
mkdir -p "$backup"
cp apps/admin-web/src/drama-materials.tsx apps/admin-web/src/drama-materials.css apps/admin-web/src/main.tsx apps/api/src/modules/admin/routes.ts "$backup/"
cp /tmp/materials-drama.tsx apps/admin-web/src/drama-materials.tsx
cp /tmp/materials-drama.css apps/admin-web/src/drama-materials.css
cp /tmp/materials-main.tsx apps/admin-web/src/main.tsx
cp /tmp/materials-routes.ts apps/api/src/modules/admin/routes.ts
git diff --check -- apps/admin-web/src/drama-materials.tsx apps/admin-web/src/drama-materials.css apps/admin-web/src/main.tsx apps/api/src/modules/admin/routes.ts
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build api admin 2>&1
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml up -d --no-deps --force-recreate api admin 2>&1
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin
curl --retry 8 --retry-delay 2 --retry-all-errors --max-time 5 --fail --silent --show-error https://api.evergreenprosper.com/ready

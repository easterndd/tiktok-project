set -eu
cd /opt/quickreels
git status --short -- apps/admin-web/src/drama-materials.tsx apps/admin-web/src/drama-materials.css apps/admin-web/src/main.tsx apps/api/src/modules/admin/routes.ts
sha256sum apps/admin-web/src/drama-materials.tsx apps/admin-web/src/drama-materials.css apps/admin-web/src/main.tsx apps/api/src/modules/admin/routes.ts
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin
curl --max-time 5 --fail --silent --show-error https://api.evergreenprosper.com/ready

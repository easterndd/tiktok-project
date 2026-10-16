set -eu
cd /opt/quickreels
printf 'HEAD '; git rev-parse --short HEAD
printf 'STATUS\n'; git status --short -- apps/admin-web/src/main.tsx apps/api/src/modules/admin/routes.ts apps/api/src/modules/app-entry-ads/routes.ts apps/api/src/plugins/auth.ts compose.production.self-hosted.yml
printf 'HASHES\n'; sha256sum apps/admin-web/src/main.tsx apps/api/src/modules/admin/routes.ts apps/api/src/modules/app-entry-ads/routes.ts apps/api/src/plugins/auth.ts
printf 'SERVICES\n'; sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin
printf 'DISK\n'; df -h .
printf 'READY\n'; curl --max-time 8 --fail --silent --show-error https://api.evergreenprosper.com/ready
printf '\nADMIN\n'; curl --max-time 8 --fail --silent --show-error https://admin.evergreenprosper.com/health

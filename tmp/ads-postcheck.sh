set -eu
cd /opt/quickreels
printf 'SERVICES\n'; sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin
printf 'READY\n'; curl --max-time 8 --fail --silent --show-error https://api.evergreenprosper.com/ready
printf '\nADMIN HEALTH\n'; curl --max-time 8 --fail --silent --show-error https://admin.evergreenprosper.com/health
printf '\nNEW ROUTE WITHOUT LOGIN HTTP '; curl --max-time 8 --silent --output /dev/null --write-out '%{http_code}\n' https://api.evergreenprosper.com/api/v1/admin/app-entry-ad-policies
printf 'ADMIN BUNDLE ROUTE '; sudo docker exec quickreels-admin-1 sh -c "grep -l '/admin/app-entry-ad-policies' /usr/share/nginx/html/assets/*.js | wc -l"
printf 'SOURCE HASHES\n'; sha256sum apps/admin-web/src/main.tsx apps/api/src/modules/admin/routes.ts apps/api/src/modules/app-entry-ads/routes.ts apps/api/src/plugins/auth.ts

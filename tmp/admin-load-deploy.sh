set -eu
cd /opt/quickreels
compose() { sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml "$@"; }

test "$(sha256sum apps/admin-web/src/main.tsx | cut -d' ' -f1)" = 0ffc951b8a1cfa69272a3bad036c214bffa66338010ef100a8b3f3b70ae99e82
test "$(sha256sum apps/admin-web/src/styles.css | cut -d' ' -f1)" = 73fa79a9c35af93e7e705f17ef67249bc77c6b920ea4e2ab5be950b015f464c1
test "$(sha256sum apps/api/src/modules/admin/routes.ts | cut -d' ' -f1)" = 82b2f0fb2ab400b67657efe215d33323dff7e945d2f1817be96464a3b3c5b53d
test "$(sha256sum /tmp/admin-load-main.tsx | cut -d' ' -f1)" = 9c8d24757705ab8990934fdfe9e0ac12c093969d9aeca5e136e81d9360627ef4
test "$(sha256sum /tmp/admin-load-styles.css | cut -d' ' -f1)" = 2297d4309f1ca99087e63beff2ba6195c119273480c58b7274ceb9e662738da5
test "$(sha256sum /tmp/admin-load-routes.ts | cut -d' ' -f1)" = 3a49e491ffd915d550cbcc806a1498805dd0c9a38e7bc288815de1c65213ed88

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/home/ubuntu/admin-load-before-$stamp
mkdir -p "$backup"
cp --parents apps/admin-web/src/main.tsx apps/admin-web/src/styles.css apps/api/src/modules/admin/routes.ts "$backup/"
sudo docker image tag quickreels-api:latest quickreels-api:before-admin-load-$stamp
sudo docker image tag quickreels-admin:latest quickreels-admin:before-admin-load-$stamp

complete=0
rollback() {
  status=$?
  trap - EXIT
  if [ "$complete" -ne 1 ]; then
    cp "$backup/apps/admin-web/src/main.tsx" apps/admin-web/src/main.tsx
    cp "$backup/apps/admin-web/src/styles.css" apps/admin-web/src/styles.css
    cp "$backup/apps/api/src/modules/admin/routes.ts" apps/api/src/modules/admin/routes.ts
    sudo docker image tag quickreels-api:before-admin-load-$stamp quickreels-api:latest
    sudo docker image tag quickreels-admin:before-admin-load-$stamp quickreels-admin:latest
    compose up -d --no-deps --force-recreate api admin
    printf 'ROLLED BACK TO %s\n' "$backup"
  fi
  exit "$status"
}
trap rollback EXIT

cp /tmp/admin-load-main.tsx apps/admin-web/src/main.tsx
cp /tmp/admin-load-styles.css apps/admin-web/src/styles.css
cp /tmp/admin-load-routes.ts apps/api/src/modules/admin/routes.ts
compose build api admin
compose up -d --no-deps --force-recreate api admin

healthy=0
for attempt in $(seq 1 30); do
  api_status=$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' quickreels-api-1 2>/dev/null || true)
  if [ "$api_status" = healthy ]; then healthy=1; break; fi
  if [ "$api_status" = unhealthy ] || [ "$api_status" = exited ]; then break; fi
  sleep 3
done
test "$healthy" -eq 1
curl --retry 8 --retry-delay 2 --retry-all-errors --max-time 10 --fail --silent --show-error https://api.evergreenprosper.com/ready
printf '\nADMIN '
curl --retry 8 --retry-delay 2 --retry-all-errors --max-time 10 --fail --silent --show-error https://admin.evergreenprosper.com/health
printf '\n'
compose ps api worker admin
complete=1
printf 'DEPLOYED BACKUP %s\n' "$backup"

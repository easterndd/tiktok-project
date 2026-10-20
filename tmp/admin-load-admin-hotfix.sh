set -eu
cd /opt/quickreels
compose() { sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml "$@"; }
test "$(sha256sum apps/admin-web/src/main.tsx | cut -d' ' -f1)" = 9c8d24757705ab8990934fdfe9e0ac12c093969d9aeca5e136e81d9360627ef4
test "$(sha256sum apps/admin-web/src/styles.css | cut -d' ' -f1)" = 2297d4309f1ca99087e63beff2ba6195c119273480c58b7274ceb9e662738da5
test "$(sha256sum /tmp/admin-load-main-final.tsx | cut -d' ' -f1)" = f7417432f65d3e3128f6fa26ef764141513cc3a7f37ba5769a9a305221356f74
test "$(sha256sum /tmp/admin-load-styles-final.css | cut -d' ' -f1)" = ad3239d88c8ad0aa24fedccff52492a2d7871bdd35c3eb9d46ec190b707b3981

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/home/ubuntu/admin-load-admin-before-$stamp
mkdir -p "$backup"
cp --parents apps/admin-web/src/main.tsx apps/admin-web/src/styles.css "$backup/"
sudo docker image tag quickreels-admin:latest quickreels-admin:before-admin-load-hotfix-$stamp
complete=0
rollback() {
  status=$?
  trap - EXIT
  if [ "$complete" -ne 1 ]; then
    cp "$backup/apps/admin-web/src/main.tsx" apps/admin-web/src/main.tsx
    cp "$backup/apps/admin-web/src/styles.css" apps/admin-web/src/styles.css
    sudo docker image tag quickreels-admin:before-admin-load-hotfix-$stamp quickreels-admin:latest
    compose up -d --no-deps --force-recreate admin
    printf 'ROLLED BACK TO %s\n' "$backup"
  fi
  exit "$status"
}
trap rollback EXIT

cp /tmp/admin-load-main-final.tsx apps/admin-web/src/main.tsx
cp /tmp/admin-load-styles-final.css apps/admin-web/src/styles.css
compose build admin
compose up -d --no-deps --force-recreate admin
curl --retry 8 --retry-delay 2 --retry-all-errors --max-time 10 --fail --silent --show-error https://admin.evergreenprosper.com/health
printf '\n'
compose ps api worker admin
complete=1
printf 'DEPLOYED BACKUP %s\n' "$backup"

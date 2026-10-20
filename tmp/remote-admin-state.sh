set -eu
cd /opt/quickreels
printf 'REMOTE HASHES\n'
sha256sum apps/admin-web/src/main.tsx apps/api/src/modules/admin/routes.ts
printf 'REMOTE STATUS\n'
git status --short -- apps/admin-web/src/main.tsx apps/api/src/modules/admin/routes.ts || true

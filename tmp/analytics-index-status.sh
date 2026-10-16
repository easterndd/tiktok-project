set -eu
cd /opt/quickreels
printf 'MIGRATION DIR\n'
ls apps/api/prisma/migrations/20261016023000_app_session_active_index
printf 'INDEX COUNT\n'
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from pg_indexes where indexname = '\''AppSession_userId_startedAt_idx'\'';"'
printf 'API HEALTH\n'
curl --max-time 10 --silent --show-error https://api.evergreenprosper.com/ready
printf '\nLATEST BACKUP\n'
ls -dt /home/ubuntu/analytics-index-before-* | head -1
printf 'API SRC MARKER\n'
grep -n 'recentPlatform' apps/api/src/modules/admin/routes.ts | head -2 || true

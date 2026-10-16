set -eu
cd /opt/quickreels
printf 'HTTP\n'
for url in https://api.evergreenprosper.com/ready https://api.evergreenprosper.com/api/talereels/v1/albums https://api.evergreenprosper.com/api/talereels/v1/admin/episodes https://api.evergreenprosper.com/api/talereels/v1/admin/app-entry-ad-policy?releaseId=default; do
  curl --max-time 15 -sS -o /dev/null -w '%{http_code} %{time_total}s\n' "$url"
done
printf 'ASSET STATUS LABELS\n'
sudo docker exec quickreels-admin-1 sh -c 'grep -R -l "In review" /usr/share/nginx/html/assets/*.js | wc -l'
printf 'POSTGRES CONNECTIONS\n'
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from pg_stat_activity;"'
printf 'API ERRORS\n'
sudo docker logs --since 5m quickreels-api-1 2>&1 | grep -E 'P2024|P2028|too many clients|remaining connection slots|FATAL|ERROR' | tail -20 || true
printf 'WORKER ERRORS\n'
sudo docker logs --since 5m quickreels-worker-1 2>&1 | grep -E 'P2024|P2028|too many clients|remaining connection slots|FATAL|ERROR' | tail -20 || true
printf 'POOLER ERRORS\n'
sudo docker logs --since 5m quickreels-pgbouncer-1 2>&1 | grep -E 'ERROR|FATAL|too many clients' | tail -20 || true

set -eu
cd /opt/quickreels
printf 'HEALTH\n'
curl --max-time 10 --fail --silent --show-error https://api.evergreenprosper.com/ready
printf '\n'
curl --max-time 10 --fail --silent --show-error https://admin.evergreenprosper.com/health
printf '\nBUILT\n'
sudo docker exec quickreels-api-1 sh -c 'grep -R -l "analyticsDailySummary" dist | head -3'
sudo docker exec quickreels-admin-1 sh -c 'grep -R -l "更新于" /usr/share/nginx/html/assets/*.js | head -3'
printf 'SUMMARY ROWS\n'
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*), coalesce(max(\"updatedAt\"), now()) from \"AnalyticsDailySummary\";"'
printf 'WORKER LOGS\n'
sudo docker logs --since 5m quickreels-worker-1 2>&1 | tail -40
printf 'API ERRORS\n'
sudo docker logs --since 5m quickreels-api-1 2>&1 | grep -E 'P2021|P2024|P2028|too many clients|remaining connection slots|FATAL|ERROR' | tail -20 || true
printf 'RECENT 5XX\n'
sudo docker logs --since 5m quickreels-api-1 2>&1 | grep '"statusCode":5[0-9][0-9]' | tail -20 || true
printf 'CONTAINERS\n'
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin

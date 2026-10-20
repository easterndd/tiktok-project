set -eu
cd /opt/quickreels
printf 'WORKER FULL LOG\n'
sudo docker logs --since 3m quickreels-worker-1 2>&1 | tail -100
printf 'SERVICE ENV\n'
sudo docker exec quickreels-worker-1 sh -c 'echo "$DATABASE_URL" | sed -E "s#://[^:]+:[^@]+@#://***:***@#"; echo "$DATABASE_POOLER_HOST"'
printf 'TABLE\n'
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d \"AnalyticsDailySummary\""'

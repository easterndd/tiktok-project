set -eu
cd /opt/quickreels
printf 'TODAY\n'
date -u
printf 'SUMMARY\n'
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select day, \"newUsers\", \"activeUsers\", \"updatedAt\" from \"AnalyticsDailySummary\" order by day desc limit 5;"'
printf 'ALL SCHEMAS\n'
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from information_schema.tables where table_name = '\''AnalyticsDailySummary'\'';"'
printf 'API 5XX CONTEXT\n'
sudo docker logs --since 3m quickreels-api-1 2>&1 | grep -B 4 -A 2 '"statusCode":5[0-9][0-9]' | tail -30 || true
printf 'WORKER ERRORS\n'
sudo docker logs --since 2m quickreels-worker-1 2>&1 | grep -E 'summary refresh failed|worker cycle failed|P2021|P2010' | tail -20 || true

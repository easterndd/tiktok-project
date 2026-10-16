set -eu
printf 'RESOURCE USE\n'
sudo docker stats --no-stream --format '{{.Name}} CPU={{.CPUPerc}} MEM={{.MemUsage}} NET={{.NetIO}}' quickreels-api-1 quickreels-worker-1 quickreels-pgbouncer-1 quickreels-postgres-1
printf 'RECENT API 5XX\n'
sudo docker logs --since 2m quickreels-api-1 2>&1 | grep -E '"statusCode":5[0-9][0-9]|P2024|P2028|too many clients' | tail -10 || true
printf 'POOLER STATS\n'
sudo docker logs --since 2m quickreels-pgbouncer-1 2>&1 | grep 'stats:' | tail -2 || true
printf 'POSTGRES COUNT\n'
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from pg_stat_activity;"'

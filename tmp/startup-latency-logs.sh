set -eu
printf 'API REQUEST TIMINGS 09:58-10:08 UTC\n'
sudo docker logs --since 2026-10-15T09:58:00Z --until 2026-10-15T10:08:00Z quickreels-api-1 2>&1 | python3 /tmp/startup-latency-logs.py
printf 'POOLER STATS\n'
sudo docker logs --since 2026-10-15T09:58:00Z --until 2026-10-15T10:08:00Z quickreels-pgbouncer-1 2>&1 | grep 'stats:' | tail -10 || true
printf 'RESOURCE\n'
sudo docker stats --no-stream --format '{{.Name}} CPU={{.CPUPerc}} MEM={{.MemUsage}}' quickreels-api-1 quickreels-postgres-1 quickreels-pgbouncer-1

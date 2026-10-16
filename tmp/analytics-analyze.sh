set -eu
cd /opt/quickreels
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ANALYZE talereels.\"AppSession\"; SET search_path TO talereels; EXPLAIN (ANALYZE, BUFFERS) SELECT COUNT(DISTINCT \"userId\") FROM \"AppSession\" WHERE \"startedAt\" >= TIMESTAMP '\''2026-09-16 00:00:00'\'' AND \"startedAt\" < TIMESTAMP '\''2026-10-16 00:00:00'\'';"'

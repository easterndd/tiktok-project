set -eu
cd /opt/quickreels
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml restart pgbouncer
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from pg_stat_activity;"'
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker pgbouncer

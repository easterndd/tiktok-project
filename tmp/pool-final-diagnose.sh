set -eu
cd /opt/quickreels
printf 'CONTAINERS\n'
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker pgbouncer postgres
printf 'POSTGRES CONNECTIONS\n'
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select application_name, state, count(*) from pg_stat_activity group by 1,2 order by 3 desc limit 12; select count(*) from pg_stat_activity;"'
printf 'POOLER LOG\n'
sudo docker logs --tail 40 quickreels-pgbouncer-1 2>&1

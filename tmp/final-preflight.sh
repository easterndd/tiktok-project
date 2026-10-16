set -eu
cd /opt/quickreels
printf "DISK\n"; df -h .
printf "DATABASE_SIZE\n"; sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select pg_size_pretty(pg_database_size(current_database()));"'
printf "COMPOSE\n"; sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin postgres pgbouncer
printf "MIGRATIONS\n"; sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select migration_name from talereels._prisma_migrations where finished_at is not null order by finished_at desc limit 4;"'
printf "SOURCE\n"; git status --short 2>/dev/null | head -30 || true

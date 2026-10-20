set -eu
cd /opt/quickreels
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT migration_name, finished_at, rolled_back_at, logs FROM public._prisma_migrations WHERE migration_name='\''20261016023000_app_session_active_index'\'';"'
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pid, state, wait_event_type, wait_event, left(query,120) FROM pg_stat_activity WHERE query like '\''%AppSession_userId_startedAt_idx%'\'';"'

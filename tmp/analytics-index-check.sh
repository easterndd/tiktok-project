set -eu
cd /opt/quickreels
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='\''talereels'\'' AND tablename='\''AppSession'\''; SELECT relname,n_live_tup,last_analyze,last_autoanalyze FROM pg_stat_user_tables WHERE schemaname='\''talereels'\'' AND relname='\''AppSession'\'';"'

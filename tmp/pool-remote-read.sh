set -eu
cd /opt/quickreels
printf 'COMPOSE\n'
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml config --quiet
printf 'IMAGES\n'
sudo docker image ls --format '{{.Repository}}:{{.Tag}}' | head -30
printf 'DATABASE ROUTING\n'
sudo docker exec quickreels-api-1 node -e 'const {loadEnv}=require("./dist/config/env");const {configuredMiniAppKeys,miniAppEnvironment}=require("./dist/config/mini-apps");const e=loadEnv();const apps=configuredMiniAppKeys(e);const u=x=>{const p=new URL(x);return {host:p.hostname,database:p.pathname,schema:p.searchParams.get("schema"),pool:p.searchParams.get("connection_limit")}};console.log(JSON.stringify({apps:apps.length,main:u(e.DATABASE_URL),shared:u(e.SHARED_PLATFORM_DATABASE_URL||e.DATABASE_URL),samples:Object.fromEntries(["talereels","sweetreel","crownreel"].map(k=>[k,u(miniAppEnvironment(e,k).DATABASE_URL)]))}))'
printf 'PG\n'
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "show max_connections; select count(*) from pg_stat_activity; select schema_name from information_schema.schemata where schema_name in ('"'"'public'"'"','"'"'shared'"'"');"'
printf 'DB SIZE\n'
sudo docker exec quickreels-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select pg_size_pretty(pg_database_size(current_database()));"'
printf 'BASE IMAGE\n'
sudo docker image inspect node:24-alpine --format '{{.Id}}' || true

set -eu
cd /opt/quickreels
backup=$(cat /tmp/acceptance-backup-path)
test -s "$backup/database.dump"
sudo docker exec -i quickreels-postgres-1 pg_restore -l < "$backup/database.dump" > "$backup/database.toc"
test -s "$backup/database.toc"
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml config -q
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build api worker admin > /tmp/acceptance-build.log 2>&1
tail -20 /tmp/acceptance-build.log

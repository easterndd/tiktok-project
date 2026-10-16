set -eu
cd /opt/quickreels
printf 'TIME '; date -u
printf 'SERVICES\n'; sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api postgres
printf 'API ERRORS\n'; sudo docker logs --since 15m quickreels-api-1 2>&1 | grep -E 'talereels|error|Error|P10[0-9][0-9]|Prisma|ECONN|ENOTFOUND' | tail -n 100 || true

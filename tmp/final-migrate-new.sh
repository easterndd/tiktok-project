set -eu
cd /opt/quickreels
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml run --rm --no-deps -v /tmp/analytics-migrate-all.cjs:/app/apps/api/analytics-migrate-all.cjs:ro --entrypoint node api analytics-migrate-all.cjs

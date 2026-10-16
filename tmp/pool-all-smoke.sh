set -eu
cd /opt/quickreels
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml run --rm --no-deps -T -v /tmp/pool-all-smoke.cjs:/app/apps/api/pool-all-smoke.cjs:ro api node pool-all-smoke.cjs

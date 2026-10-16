set -eu
cd /opt/quickreels
compose() { sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml "$@"; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
sudo docker image tag quickreels-worker:latest quickreels-worker:before-analytics-summary-$stamp
compose build worker
compose up -d --no-deps --force-recreate worker
printf 'WORKER_BACKUP quickreels-worker:before-analytics-summary-%s\n' "$stamp"

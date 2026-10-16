set -eu
cd /opt/quickreels
compose() { sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml "$@"; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
sudo docker image tag quickreels-api:latest quickreels-api:before-image-trial-$stamp
sudo docker image tag e7322ea2810b8f2e015bfa87ea6f1f1f176e44004714fa73369d285f9f7fd1c2 quickreels-api:latest
compose up -d --no-deps --force-recreate api
for attempt in $(seq 1 12); do
  state=$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' quickreels-api-1 2>/dev/null || true)
  printf 'ATTEMPT %s %s\n' "$attempt" "$state"
  if [ "$state" = healthy ]; then
    curl --max-time 10 --fail --silent --show-error https://api.evergreenprosper.com/ready
    printf '\nIMAGE_TRIAL_SUCCESS %s\n' "$stamp"
    exit 0
  fi
  sleep 5
done
printf 'LOGS\n'
sudo docker logs --tail 80 quickreels-api-1 2>&1 || true
sudo docker image tag quickreels-api:before-image-trial-$stamp quickreels-api:latest
compose up -d --no-deps --force-recreate api
exit 1

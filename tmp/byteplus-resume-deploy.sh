set -eu
cd /opt/quickreels
old_api=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q api)
sudo docker cp "$old_api:/tmp/resume18-network.log" /home/ubuntu/byteplus-resume-20261013/resume18-network.log || true
sudo docker cp "$old_api:/tmp/resume17-controlled.log" /home/ubuntu/byteplus-resume-20261013/resume17-controlled.log || true
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml up -d --no-deps --force-recreate api worker admin 2>&1
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin
curl --retry 10 --retry-delay 3 --retry-all-errors --max-time 5 --fail --silent --show-error https://api.evergreenprosper.com/ready
sudo docker inspect --format '{{.Name}} {{.Image}}' quickreels-api-1 quickreels-worker-1 quickreels-admin-1

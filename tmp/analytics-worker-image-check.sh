set -eu
cd /opt/quickreels
sudo docker exec quickreels-worker-1 sh -c 'ls dist/services/analytics-summary* 2>&1 || true; ls dist/jobs/tiktok-short-drama.worker.js; grep -n analytics-summary dist/jobs/tiktok-short-drama.worker.js || true'
sudo docker inspect --format '{{.Image}} {{.Config.Image}}' quickreels-worker-1
sudo docker image inspect quickreels-api:latest --format '{{.Id}}'

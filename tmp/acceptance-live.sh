set -eu
sudo docker cp /tmp/acceptance-live.cjs quickreels-api-1:/app/apps/api/acceptance-live.cjs
sudo docker exec quickreels-api-1 node acceptance-live.cjs > /tmp/acceptance-live.json
cat /tmp/acceptance-live.json

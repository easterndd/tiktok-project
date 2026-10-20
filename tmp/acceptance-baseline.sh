set -eu
sudo docker cp /tmp/acceptance-inspect.cjs quickreels-api-1:/app/apps/api/acceptance-inspect.cjs
sudo docker exec quickreels-api-1 node acceptance-inspect.cjs > /tmp/acceptance-baseline.json
cat /tmp/acceptance-baseline.json

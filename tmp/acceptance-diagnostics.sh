set -eu
sudo docker cp /tmp/acceptance-diagnostics.cjs quickreels-api-1:/app/apps/api/acceptance-diagnostics.cjs
sudo docker exec quickreels-api-1 node acceptance-diagnostics.cjs > /tmp/acceptance-diagnostics.json
cat /tmp/acceptance-diagnostics.json

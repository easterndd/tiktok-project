set -eu
sudo docker cp /tmp/acceptance-covers.cjs quickreels-api-1:/app/apps/api/acceptance-covers.cjs
sudo docker exec quickreels-api-1 node acceptance-covers.cjs --after > /tmp/acceptance-cover-after.json
cat /tmp/acceptance-cover-after.json

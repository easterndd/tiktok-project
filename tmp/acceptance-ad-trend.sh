set -eu
sudo docker cp /tmp/acceptance-ad-trend.cjs quickreels-api-1:/app/apps/api/acceptance-ad-trend.cjs
sudo docker exec quickreels-api-1 node acceptance-ad-trend.cjs > /tmp/acceptance-ad-trend.json
cat /tmp/acceptance-ad-trend.json

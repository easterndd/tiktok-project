set -eu
sudo docker cp /tmp/acceptance-ad-causes.cjs quickreels-api-1:/app/apps/api/acceptance-ad-causes.cjs
sudo docker exec quickreels-api-1 node acceptance-ad-causes.cjs > /tmp/acceptance-ad-causes.json
cat /tmp/acceptance-ad-causes.json

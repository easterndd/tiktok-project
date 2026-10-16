set -eu
cd /opt/quickreels
sudo docker cp /tmp/cover-compare.cjs quickreels-api-1:/app/apps/api/cover-compare.cjs
sudo docker exec quickreels-api-1 node cover-compare.cjs

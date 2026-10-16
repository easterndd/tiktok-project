set -eu
cd /opt/quickreels
sudo docker cp /tmp/cover-state-check.cjs quickreels-api-1:/app/apps/api/cover-state-check.cjs
sudo docker exec quickreels-api-1 node cover-state-check.cjs

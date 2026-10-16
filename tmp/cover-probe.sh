set -eu
cd /opt/quickreels
sudo docker cp /tmp/cover-probe.cjs quickreels-api-1:/app/apps/api/cover-probe.cjs
sudo docker exec quickreels-api-1 node cover-probe.cjs

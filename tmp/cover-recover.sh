set -eu
cd /opt/quickreels
sudo docker cp /tmp/cover-recover.cjs quickreels-api-1:/app/apps/api/cover-recover.cjs
sudo docker exec quickreels-api-1 node cover-recover.cjs

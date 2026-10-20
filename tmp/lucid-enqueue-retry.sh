set -eu
cd /opt/quickreels
sudo docker cp /tmp/lucid-enqueue-retry.cjs quickreels-api-1:/app/apps/api/lucid-enqueue-retry.cjs
sudo docker exec quickreels-api-1 node lucid-enqueue-retry.cjs

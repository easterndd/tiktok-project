set -eu
cd /opt/quickreels
sudo docker cp /tmp/lucid-query.cjs quickreels-api-1:/app/apps/api/lucid-query.cjs
sudo docker exec quickreels-api-1 node lucid-query.cjs

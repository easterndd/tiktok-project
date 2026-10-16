set -eu
cd /opt/quickreels
sudo docker cp /tmp/analytics-migrate-all.cjs quickreels-api-1:/app/apps/api/analytics-migrate-all.cjs
sudo docker exec quickreels-api-1 node analytics-migrate-all.cjs

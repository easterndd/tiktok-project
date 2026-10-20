set -eu
cd /opt/quickreels
sudo docker cp /tmp/analytics-backfill.cjs quickreels-worker-1:/app/apps/api/analytics-backfill.cjs
sudo docker exec quickreels-worker-1 node analytics-backfill.cjs talereels

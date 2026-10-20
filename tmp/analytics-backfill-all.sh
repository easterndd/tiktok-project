set -eu
cd /opt/quickreels
sudo docker exec quickreels-worker-1 node analytics-backfill.cjs

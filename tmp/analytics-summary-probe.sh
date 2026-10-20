set -eu
cd /opt/quickreels
sudo docker cp /tmp/analytics-summary-probe.cjs quickreels-worker-1:/app/apps/api/analytics-summary-probe.cjs
sudo docker exec quickreels-worker-1 node analytics-summary-probe.cjs

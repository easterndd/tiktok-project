set -eu
cd /opt/quickreels
sudo docker cp /tmp/cover-job-check.cjs quickreels-api-1:/app/apps/api/cover-job-check.cjs
sudo docker exec quickreels-api-1 node cover-job-check.cjs

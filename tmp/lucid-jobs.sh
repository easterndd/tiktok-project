set -eu
cd /opt/quickreels
sudo docker cp /tmp/lucid-jobs.cjs quickreels-api-1:/app/apps/api/lucid-jobs.cjs
sudo docker exec quickreels-api-1 node lucid-jobs.cjs

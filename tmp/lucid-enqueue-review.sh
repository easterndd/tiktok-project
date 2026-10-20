set -eu
cd /opt/quickreels
sudo docker cp /tmp/lucid-enqueue-review.cjs quickreels-api-1:/app/apps/api/lucid-enqueue-review.cjs
sudo docker exec quickreels-api-1 node lucid-enqueue-review.cjs

set -eu
sudo docker cp /tmp/ad-event-investigate.cjs quickreels-api-1:/app/apps/api/ad-event-investigate.cjs
sudo docker exec quickreels-api-1 node ad-event-investigate.cjs

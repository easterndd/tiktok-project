set -eu
sudo docker cp /tmp/byteplus-network.cjs quickreels-api-1:/app/apps/api/byteplus-network.cjs
sudo docker exec -d quickreels-api-1 sh -c 'node byteplus-network.cjs > /tmp/resume18-network.log 2>&1'
date -u

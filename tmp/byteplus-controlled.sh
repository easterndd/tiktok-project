set -eu
sudo docker cp /tmp/byteplus-resume17.cjs quickreels-api-1:/app/apps/api/byteplus-resume17.cjs
sudo docker cp /tmp/byteplus-controlled.cjs quickreels-api-1:/app/apps/api/byteplus-controlled.cjs
sudo docker exec -d quickreels-api-1 sh -c 'node byteplus-controlled.cjs > /tmp/resume17-controlled.log 2>&1'
date -u

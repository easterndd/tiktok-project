set -eu
cd /opt/quickreels
sudo docker cp /tmp/byteplus-resume18.cjs quickreels-api-1:/app/apps/api/byteplus-resume18.cjs
sudo docker exec -d quickreels-api-1 sh -c 'node byteplus-resume18.cjs > /tmp/resume18.log 2>&1'
date -u

set -eu
cd /opt/quickreels
sudo docker cp /tmp/cover-probe.cjs quickreels-api-1:/app/apps/api/cover-probe.cjs
sudo docker exec quickreels-api-1 node cover-probe.cjs https://api.evergreenprosper.com/api/v1/assets/covers/12a69a19edff24d7b09a1ed8e42cf589455acea2990fe85a2042f522c403b044.png previously-successful-png

set -eu
cd /opt/quickreels
sudo docker cp /tmp/inspect-album.cjs quickreels-api-1:/app/apps/api/inspect-album.cjs
sudo docker exec quickreels-api-1 node inspect-album.cjs

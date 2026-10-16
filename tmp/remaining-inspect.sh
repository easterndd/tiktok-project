set -eu
sudo docker ps --format '{{.Names}} {{.Image}}'
sudo docker inspect caddy --format '{{json .Mounts}}' 2>/dev/null || true
sudo docker inspect quickreels-api-1 quickreels-worker-1 --format '{{.Name}} {{.Image}}'

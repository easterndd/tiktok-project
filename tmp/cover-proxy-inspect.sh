set -eu
sudo docker inspect evergreenprosper-website-web-1 --format '{{json .Mounts}}'
sudo docker exec evergreenprosper-website-web-1 cat /etc/caddy/Caddyfile

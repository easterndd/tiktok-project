set -eu
sudo docker pull node:24-alpine
sudo docker run --rm node:24-alpine sh -c 'apk update >/dev/null && apk policy pgbouncer'

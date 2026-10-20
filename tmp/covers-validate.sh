set -eu
sudo docker run --rm -v /tmp/quickreels-covers-nginx.conf:/etc/nginx/conf.d/default.conf:ro nginx:1.27-alpine nginx -t

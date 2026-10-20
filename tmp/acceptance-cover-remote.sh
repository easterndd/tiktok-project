set -eu
ls -l /tmp/acceptance-cover-before.json || true
sudo docker ps --format '{{.Names}} {{.Status}}' | grep -E 'quickreels-(api|worker|admin|covers)-1|evergreenprosper-website-web-1'
curl --silent --show-error --max-time 10 --output /dev/null --write-out 'api %{http_code} %{time_total}s\n' https://api.evergreenprosper.com/ready
curl --silent --show-error --max-time 10 --output /dev/null --write-out 'admin %{http_code} %{time_total}s\n' https://admin.evergreenprosper.com/health

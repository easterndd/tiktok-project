set -eu
backup=$(cat /tmp/acceptance-backup-path)
file=/opt/evergreenprosper-website/Caddyfile
cp "$file" "$backup/Caddyfile.before-cover"
sudo docker exec evergreenprosper-website-web-1 sh -c 'wget -qS -O /dev/null http://covers/api/v1/assets/covers/063785bdf3654161393ea04558153fdd08cf14644124ac0b81f1177bd48b085e.png 2>&1 | tail -12'
python3 - <<'PY'
from pathlib import Path
p=Path('/opt/evergreenprosper-website/Caddyfile')
s=p.read_text()
old='api.evergreenprosper.com {\n    encode gzip\n    reverse_proxy api:3000\n}'
new='api.evergreenprosper.com {\n    encode gzip\n    handle /api/v1/assets/covers/* {\n        reverse_proxy covers:80\n    }\n    handle {\n        reverse_proxy api:3000\n    }\n}'
assert s.count(old)==1
Path('/tmp/acceptance-Caddyfile').write_text(s.replace(old,new))
PY
sudo cp /tmp/acceptance-Caddyfile "$file"
if ! sudo docker exec evergreenprosper-website-web-1 caddy validate --config /etc/caddy/Caddyfile; then sudo cp "$backup/Caddyfile.before-cover" "$file"; exit 1; fi
if ! sudo docker exec evergreenprosper-website-web-1 caddy reload --config /etc/caddy/Caddyfile; then sudo cp "$backup/Caddyfile.before-cover" "$file"; sudo docker exec evergreenprosper-website-web-1 caddy reload --config /etc/caddy/Caddyfile; exit 1; fi
for url in https://api.evergreenprosper.com/ready https://api.evergreenprosper.com/api/v1/assets/covers/063785bdf3654161393ea04558153fdd08cf14644124ac0b81f1177bd48b085e.png https://api.evergreenprosper.com/api/v1/assets/covers/063785bdf3654161393ea04558153fdd08cf14644124ac0b81f1177bd48b085e.png.w360.webp; do
  curl --max-time 12 -sS -o /dev/null -w '%{http_code} %{size_download} %{time_total}s\n' "$url"
done

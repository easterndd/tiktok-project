set -eu
url='https://api.evergreenprosper.com/api/v1/assets/covers/da3bd51e717fdd8950812a102b7866897960433094805dd823fdfca8df09baa0.png'
etag=$(curl -sSIL --max-time 20 "$url" | awk -F': ' 'tolower($1)=="etag" {gsub("\r", "", $2); print $2; exit}')
test -n "$etag"
printf 'ETAG %s\n' "$etag"
curl -sSIL --max-time 20 -H "If-None-Match: $etag" "$url" | sed -n '1,20p'

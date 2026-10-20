set -eu
curl -sSIL --max-time 20 https://api.evergreenprosper.com/api/v1/assets/covers/da3bd51e717fdd8950812a102b7866897960433094805dd823fdfca8df09baa0.png | sed -n '1,20p'

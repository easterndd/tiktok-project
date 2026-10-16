set -eu
sudo docker run --rm -v quickreels_cover_assets:/covers:ro alpine:3.21 sh -c 'find /covers -maxdepth 1 -type f | sed "s#^/covers/##" | sort'

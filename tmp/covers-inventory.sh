set -eu
cd /opt/quickreels
sudo docker run --rm -v quickreels_cover_assets:/covers:ro alpine:3.21 sh -c 'find /covers -maxdepth 1 -type f | wc -l; du -sh /covers; find /covers -maxdepth 1 -type f -name "*.w360.webp" | wc -l'
df -h /opt/quickreels

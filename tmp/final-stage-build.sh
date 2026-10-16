set -eu
cd /opt/quickreels
test -s /home/ubuntu/final-release-before-20261016T031637Z/database.dump
tar -tzf /tmp/final-release-files.tar.gz > /tmp/final-release-files.list
test "$(wc -l < /tmp/final-release-files.list)" -eq 56
tar -xzf /tmp/final-release-files.tar.gz
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml config -q
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build api worker admin
printf "BUILD_OK\n"

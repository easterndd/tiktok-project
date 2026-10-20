set -eu
cd /opt/quickreels
expected=d19ef2d446b5f31cf02a0674a6dd07c774d6907706b6326402371b76c08681b3
actual=$(sha256sum apps/api/src/services/byteplus-vod.service.ts | cut -d ' ' -f 1)
test "$actual" = "$expected"
git apply --check /tmp/byteplus-speed.patch
backup=/home/ubuntu/byteplus-speed-20261014
mkdir -p "$backup"
cp apps/api/src/services/byteplus-vod.service.ts "$backup/byteplus-vod.service.ts"
cp /tmp/byteplus-speed.patch "$backup/byteplus-speed.patch"
for service in api worker; do
  container=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q "$service")
  image=$(sudo docker inspect --format '{{.Image}}' "$container")
  sudo docker tag "$image" "quickreels-${service}:before-speed-20261014"
done
git apply /tmp/byteplus-speed.patch
git diff --check
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build api worker 2>&1
sudo docker image inspect --format '{{.RepoTags}} {{.Id}}' quickreels-api:latest quickreels-worker:latest

set -eu
cd /opt/quickreels
api_id=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q api)
sudo docker exec "$api_id" node byteplus-recover.cjs queue cmv6iyf9n7gjfpg013jlb537p
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker
curl --fail --silent --show-error https://api.evergreenprosper.com/ready

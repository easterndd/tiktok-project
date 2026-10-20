set -eu
cd /opt/quickreels
api_id=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q api)
sudo docker exec "$api_id" node byteplus-recover.cjs queue | tee /home/ubuntu/byteplus-recovery-20261013/recovery-actions.jsonl
sudo docker exec "$api_id" node byteplus-recover.cjs status | grep -Ev '"status":"PENDING"|tags length exceeds 36'
curl --fail --silent --show-error https://api.evergreenprosper.com/ready

set -eu
cd /opt/quickreels
api_id=$(sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps -q api)
sudo docker cp /tmp/byteplus-recover.cjs "$api_id:/app/apps/api/byteplus-recover.cjs"
sudo docker exec "$api_id" node byteplus-recover.cjs prepare
sudo docker cp "$api_id:/tmp/byteplus-jobs-full-before.json" /home/ubuntu/byteplus-recovery-20261013/jobs-full-before.json
sudo docker cp "$api_id:/tmp/byteplus-recovery-plan.json" /home/ubuntu/byteplus-recovery-20261013/recovery-plan.json
sudo chmod 600 /home/ubuntu/byteplus-recovery-20261013/*.json
sudo docker exec "$api_id" node byteplus-recover.cjs status
curl --fail --silent --show-error https://api.evergreenprosper.com/ready

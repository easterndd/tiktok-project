set -eu
cd /opt/quickreels
test "$(sha256sum compose.production.self-hosted.yml | cut -d' ' -f1)" = '3fbe92c81ff349bb4698614f3098a69b7999e7c153e3b4be9633aab0dd6d430c'
sudo docker compose --project-directory /opt/quickreels --env-file /opt/quickreels/.env.production -f /tmp/compose.production.self-hosted.protected.yml config -q
sudo docker compose --project-directory /opt/evergreenprosper-website -f /tmp/website-compose-protected.yml config -q
cp -p compose.production.self-hosted.yml /home/ubuntu/compose.production.self-hosted.before-disk-protection.yml
cp -p /opt/evergreenprosper-website/docker-compose.yml /home/ubuntu/website-compose.before-disk-protection.yml
cp /tmp/compose.production.self-hosted.protected.yml compose.production.self-hosted.yml
sudo cp /tmp/website-compose-protected.yml /opt/evergreenprosper-website/docker-compose.yml
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml config -q
cd /opt/evergreenprosper-website
sudo docker compose config -q
echo 'Both Compose configs valid; originals backed up in /home/ubuntu.'

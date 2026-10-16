set -eu
cd /opt/quickreels
git status --short
git log -3 --oneline
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml logs --since 2h --tail 40 worker 2>&1 | sed -E 's/(Authorization|Secret|Token|Password)[=:][^ ,}]*/\1=[redacted]/g'

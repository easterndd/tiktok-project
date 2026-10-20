set -eu
cd /opt/quickreels
test "$(sha256sum apps/admin-web/src/main.tsx | cut -d' ' -f1)" = 0ffc951b8a1cfa69272a3bad036c214bffa66338010ef100a8b3f3b70ae99e82
test "$(sha256sum apps/admin-web/src/styles.css | cut -d' ' -f1)" = 73fa79a9c35af93e7e705f17ef67249bc77c6b920ea4e2ab5be950b015f464c1
test "$(sha256sum apps/api/src/modules/admin/routes.ts | cut -d' ' -f1)" = 82b2f0fb2ab400b67657efe215d33323dff7e945d2f1817be96464a3b3c5b53d
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml config --quiet
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps api worker admin
df -h /opt/quickreels
curl --max-time 10 --fail --silent --show-error https://api.evergreenprosper.com/ready
curl --max-time 10 --fail --silent --show-error https://admin.evergreenprosper.com/health

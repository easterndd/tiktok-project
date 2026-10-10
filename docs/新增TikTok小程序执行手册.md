# 新增 TikTok Mini 小程序执行手册

本手册适用于在 QuickReels 项目中新增一个独立 TikTok Mini。当前示例已经准备好两个应用：`CineReels`（内部 key：`cinereels`）和 `TaleReels`（内部 key：`talereels`）。两者共用代码、API 进程和可选的 BytePlus VOD 媒资，但各自使用独立 PostgreSQL schema、TikTok 凭据、API 路径和管理员账号。

## 1. 先在 TikTok Developer Portal 创建应用

为每个品牌分别创建 TikTok Mini，并记录以下值。真实值只写入本地 `.env` 或服务器 `.env.production`，不要提交 Git，也不要发到聊天中。

| 应用 | 内部 key | API 路径 | 前端目录 | 本手册中的管理员邮箱 |
| --- | --- | --- | --- | --- |
| CineReels | `cinereels` | `/api/cinereels/v1` | `apps/cinereels` | `caijiarong2@xuyins.com` |
| TaleReels | `talereels` | `/api/talereels/v1` | `apps/talereels` | `caijiarong2@xuyins.com` |

Portal 中分别取得 App ID、Client Key、Client Secret。Client Secret 只放服务端；Mini 包内只放 Client Key。`cinereels` 和 `talereels` 是项目内部 key，已在各自的 `vite.config.ts` 中固定，不从 Portal 获取，也不需要写入 `.env`。广告位 ID 仅在启用相应广告功能时另行创建和填写。

## 2. 本地创建前端配置

以 CineReels 为例：

```powershell
Set-Location 'D:\my project\tiktok-project'
Copy-Item apps/cinereels/.env.example apps/cinereels/.env
notepad apps/cinereels/.env
```

填写：

```env
VITE_API_BASE_URL=https://api.evergreenprosper.com/api/cinereels/v1
VITE_TIKTOK_CLIENT_KEY=<CineReels Client Key>
VITE_DEMO_MODE=false
VITE_USE_MOCK_API=false
VITE_ENABLE_MOCK_FALLBACK=false
```

然后编辑 `apps/cinereels/minis.config.json`：

```json
{
  "appId": "<CineReels 的数字 App ID>",
  "dev": {
    "name": "CineReels",
    "ppLink": "https://www.yya.ai/capy/privacypolicy.html",
    "tosLink": "https://www.yya.ai/capy/termsofservice.html"
  }
}
```

TaleReels 使用同样流程，把目录、API 路径、Client Key 和 App ID 换成对应值。内部 key 和显示名称已由应用代码指定。不要把 `<...>` 占位符留在正式构建中。

## 3. 服务器 `.env.production` 配置

服务器项目目录为 `/opt/quickreels`。复制现有 `DATABASE_URL` 的主机、数据库、用户和密码，只把 schema 改成对应小程序名。不能使用 `schema=public`，也不能让两个应用共用同一个 schema。

```env
# CineReels
CINEREELS_DATABASE_URL=postgresql://quickreels:<same-password>@postgres:5432/quickreels?schema=cinereels
CINEREELS_TIKTOK_CLIENT_KEY=<CineReels Client Key>
CINEREELS_TIKTOK_CLIENT_SECRET=<CineReels Client Secret>
CINEREELS_TIKTOK_APP_ID=<CineReels App ID>
# 启用广告后再填写：
# CINEREELS_REWARDED_PLACEMENT_ID=<CineReels rewarded placement ID>
# CINEREELS_APP_ENTRY_PLACEMENT_ID=<CineReels entry placement ID>

# TaleReels
TALEREELS_DATABASE_URL=postgresql://quickreels:<same-password>@postgres:5432/quickreels?schema=talereels
TALEREELS_TIKTOK_CLIENT_KEY=<TaleReels Client Key>
TALEREELS_TIKTOK_CLIENT_SECRET=<TaleReels Client Secret>
TALEREELS_TIKTOK_APP_ID=<TaleReels App ID>
# 启用广告后再填写：
# TALEREELS_REWARDED_PLACEMENT_ID=<TaleReels rewarded placement ID>
# TALEREELS_APP_ENTRY_PLACEMENT_ID=<TaleReels entry placement ID>

# Admin image build arguments. These are public API URLs and ad defaults.
VITE_CINEREELS_API_BASE_URL=https://api.evergreenprosper.com/api/cinereels/v1
# VITE_CINEREELS_REWARDED_PLACEMENT_ID=<CineReels rewarded placement ID>
# VITE_CINEREELS_APP_ENTRY_PLACEMENT_ID=<CineReels entry placement ID>
VITE_TALEREELS_API_BASE_URL=https://api.evergreenprosper.com/api/talereels/v1
# VITE_TALEREELS_REWARDED_PLACEMENT_ID=<TaleReels rewarded placement ID>
# VITE_TALEREELS_APP_ENTRY_PLACEMENT_ID=<TaleReels entry placement ID>
```

`BYTEPLUS_ACCOUNT_ID`、`BYTEPLUS_SPACE_NAME`、`BYTEPLUS_REGION`、`BYTEPLUS_ACCESS_KEY` 和 `BYTEPLUS_SECRET_KEY` 继续使用已有公共值。BytePlus 上传成功的媒资可绑定到多个小程序，不需要为每个应用重复上传。

只有三个 Portal 值时，可以先完成小程序接入、登录和免费剧集播放；后台暂时不要启用激励解锁或进入广告。广告位 ID 创建后，再填写对应变量并重新构建管理后台、重建 API/Worker。

## 4. 创建 schema 并执行迁移

```bash
cd /opt/quickreels
export ENV_FILE=/opt/quickreels/.env.production
export COMPOSE_FILE=compose.production.self-hosted.yml

sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE SCHEMA IF NOT EXISTS cinereels; CREATE SCHEMA IF NOT EXISTS talereels;"'

set -a
. "$ENV_FILE"
set +a

sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm --no-deps \
  -e DATABASE_URL="$CINEREELS_DATABASE_URL" api npx prisma migrate deploy

sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm --no-deps \
  -e DATABASE_URL="$TALEREELS_DATABASE_URL" api npx prisma migrate deploy
```

不要运行 `prisma migrate dev`、`db:seed`、`docker compose down -v`。迁移只建表，不会复制主应用内容；正式剧目需要通过后台创建或共享剧目授权流程处理。

## 5. 创建两个独立管理员

管理员邮箱和密码写入各自 schema 的 `adminUser` 表，不需要写入 `.env.production`。两个应用可以使用同一个邮箱，但每个 schema 都要单独执行一次 bootstrap。密码在终端输入时不会回显，也不要提交或发送密码。

```bash
export CINE_ADMIN_EMAIL='caijiarong2@xuyins.com'
read -r -s -p 'CineReels 管理员密码（至少 12 位）: ' CINE_ADMIN_PASSWORD
printf '\n'
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm --no-deps \
  -e DATABASE_URL="$CINEREELS_DATABASE_URL" \
  -e ADMIN_BOOTSTRAP_EMAIL="$CINE_ADMIN_EMAIL" \
  -e ADMIN_BOOTSTRAP_PASSWORD="$CINE_ADMIN_PASSWORD" \
  api node dist/scripts/bootstrap-admin.js
unset CINE_ADMIN_EMAIL CINE_ADMIN_PASSWORD

export TALE_ADMIN_EMAIL='caijiarong2@xuyins.com'
read -r -s -p 'TaleReels 管理员密码（至少 12 位）: ' TALE_ADMIN_PASSWORD
printf '\n'
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm --no-deps \
  -e DATABASE_URL="$TALEREELS_DATABASE_URL" \
  -e ADMIN_BOOTSTRAP_EMAIL="$TALE_ADMIN_EMAIL" \
  -e ADMIN_BOOTSTRAP_PASSWORD="$TALE_ADMIN_PASSWORD" \
  api node dist/scripts/bootstrap-admin.js
unset TALE_ADMIN_EMAIL TALE_ADMIN_PASSWORD
```

输出 `Administrator created.` 后即可在后台选择对应品牌登录。账号已存在时显示 `Administrator already exists; no changes were made.`，这表示不会重置原密码。

## 6. 重建 API、Worker 和后台

修改 `.env.production` 后必须重建容器，使新环境变量生效：

```bash
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build --pull api worker admin
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps --force-recreate api worker admin
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
curl -fsS https://api.evergreenprosper.com/ready
```

验证 API 路由已经注册：

```bash
curl -i -X POST https://api.evergreenprosper.com/api/cinereels/v1/admin/auth/login -H 'content-type: application/json' -d '{}'
curl -i -X POST https://api.evergreenprosper.com/api/talereels/v1/admin/auth/login -H 'content-type: application/json' -d '{}'
```

空请求返回 `400` 表示路由存在；返回 `404` 表示服务器没有读到对应 `*_DATABASE_URL` 或仍在运行旧镜像。此时检查：

```bash
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec api sh -c 'test -n "$CINEREELS_DATABASE_URL" && echo cinereels-configured'
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec api sh -c 'test -n "$TALEREELS_DATABASE_URL" && echo talereels-configured'
```

## 7. 法律页和 Portal 配置

当前 CineReels、TaleReels 使用同一组已提供的法律页。两个 TikTok Developer Portal 都填写：

| Portal 字段 | 值 |
| --- | --- |
| Privacy policy URL | `https://www.yya.ai/capy/privacypolicy.html` |
| Terms of Service URL | `https://www.yya.ai/capy/termsofservice.html` |
| Domain of your service | `https://www.yya.ai` |

Portal URL 是外部法律页；小程序 Profile 页面里的 Privacy Policy 和 Terms of Service 来自 Mini 包内文案。修改 `legal-docs.ts` 后，必须分别重新构建 CineReels、TaleReels Mini ZIP，并上传到对应应用的 Preview，内置页面才会更新。

两个应用的 `minis.config.json` 也已使用上述 Privacy Policy 与 Terms of Service URL。`Domain of your service` 填域名，不要附加 `/capy`。API 主机 `https://api.evergreenprosper.com` 仍须另加到 Developer Portal 的 Trusted Domains。

确认这两个公共法律页无需登录即可访问并返回 HTTP 200：

```powershell
curl.exe -IL https://www.yya.ai/capy/privacypolicy.html
curl.exe -IL https://www.yya.ai/capy/termsofservice.html
```

下面的独立品牌法律页生成和 SSH 部署步骤仅在你决定另外托管 CineReels、TaleReels 专属法律页时才需要；使用上表给定的 Portal URL 时无需执行。

独立页面生成命令；输出位于 `deploy/website/cinereels/` 和 `deploy/website/talereels/`：

```powershell
pnpm --filter cinereels export:legal
pnpm --filter talereels export:legal
```

### 本机提交并推送

在 Windows PowerShell 中，只暂存本次法律页发布需要的文件；本手册不加入这次提交：

```powershell
Set-Location 'D:\my project\tiktok-project'

git add deploy/website/Caddyfile.quickreels-snippet `
  deploy/website/cinereels `
  deploy/website/talereels

git diff --cached --check
git diff --cached --stat
git status --short
```

确认暂存列表只包含手册、Caddy 规则和这两个法律页后提交并推送：

```powershell
git commit -m "docs: add CineReels and TaleReels legal pages"
git push origin main
git rev-parse --short HEAD
```

记下最后显示的提交号，服务器更新时核对同一个提交。

### SSH 部署到官网

连接当前官网服务器并检查工作区。若 `git status --short` 有输出，先查明原因，不要覆盖服务器本地改动：

```powershell
ssh ubuntu@43.172.66.90
```

在 SSH 服务器终端执行：

```bash
cd /opt/quickreels
git status --short
```

确认工作区干净后快进到刚推送的提交：

```bash
git fetch origin main
git merge --ff-only FETCH_HEAD
git rev-parse --short HEAD
```

确认提交号与本机一致。接着核对官网容器挂载：

```bash
sudo docker inspect evergreenprosper-website-web-1 \
  --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
```

以下命令使用现有部署记录中的静态根目录 `/opt/evergreenprosper-website`。只有当上一步确认该目录对应 Caddy 的网站根目录时才继续；若输出路径不同，将下方目录替换成实际宿主机挂载路径：

```bash
export WEBSITE_ROOT=/opt/evergreenprosper-website
sudo install -d -m 755 \
  "$WEBSITE_ROOT/cinereels" \
  "$WEBSITE_ROOT/talereels"
sudo cp -a deploy/website/cinereels/. "$WEBSITE_ROOT/cinereels/"
sudo cp -a deploy/website/talereels/. "$WEBSITE_ROOT/talereels/"
```

### Caddy 路由

检查官网 Caddyfile 是否已有 CineReels 和 TaleReels 的四条 rewrite 规则。先查看容器挂载以找到宿主机上的 Caddyfile：

```bash
sudo docker inspect evergreenprosper-website-web-1 \
  --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
```

若规则尚不存在，在 `evergreenprosper.com` 站点块中、最终 `file_server` 之前添加 `deploy/website/Caddyfile.quickreels-snippet` 里的 CineReels 和 TaleReels 规则。编辑前对实际 Caddyfile 做备份：

```bash
CADDYFILE=$(sudo docker inspect evergreenprosper-website-web-1 \
  --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
if [ -z "$CADDYFILE" ]; then
  echo 'Caddyfile is not mounted at /etc/caddy/Caddyfile; inspect the container mounts and set CADDYFILE to its host path.'
else
  printf 'Caddyfile: %s\n' "$CADDYFILE"
  sudo cp -a "$CADDYFILE" "$CADDYFILE.bak-$(date +%Y%m%d-%H%M%S)"
  sudo nano "$CADDYFILE"
fi
```

保存后校验并重载：

```bash
sudo docker exec evergreenprosper-website-web-1 \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker exec evergreenprosper-website-web-1 \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
curl -IL https://evergreenprosper.com/cinereels/privacy
curl -IL https://evergreenprosper.com/cinereels/terms
curl -IL https://evergreenprosper.com/talereels/privacy
curl -IL https://evergreenprosper.com/talereels/terms
```

四个页面最终都必须返回 `200`。`curl` 若先显示重定向，请确认最终响应也是 `200`。正式提交 Portal 前，核对页面中的运营主体、地址、地区、托管位置和联系邮箱；本项目为 CineReels、TaleReels 自动替换品牌名和联系邮箱，其他法律事实仍需按真实业务确认。

## 8. 构建和上传 Mini 包

在本机分别执行：

```powershell
pnpm install --frozen-lockfile
pnpm --filter cinereels lint
pnpm --filter cinereels build:minis:release
pnpm --filter talereels lint
pnpm --filter talereels build:minis:release
```

每个应用会生成自己的 `apps/<key>/dist/minis.config.zip`。把对应 ZIP 上传到对应 TikTok Developer Portal 的 Preview；不要交叉上传。确认预览访问的是对应 `/api/<key>/v1`，再分别提交审核。

## 9. 共享媒资和平台授权

新应用内容上传成功后，后台选择对应品牌，使用“共享剧目”流程把已有 BytePlus/TikTok 主剧目授权给目标应用。授权流程使用目标 Client Key，并复用已上传的 BytePlus VID；不会重复上传视频，也不会把已通过审核的主版本当成新上传媒资。每个 Mini 自己的代码包审核、剧目授权和上架状态仍需分别在 Portal 与后台完成。

## 10. 验收清单

- [ ] 两个应用各自的 App ID、Client Key、Client Secret 已填写，且没有占位符。
- [ ] `cinereels`、`talereels` schema 已创建，迁移完成，未运行生产 seed。
- [ ] 两个管理员都用 `caijiarong2@xuyins.com` 创建成功，密码未写入配置文件。
- [ ] `/api/cinereels/v1`、`/api/talereels/v1` 空登录请求返回 400 而不是 404。
- [ ] 后台选择器能切换 QuicK ReeLS、TaleTV、CineReels、TaleReels，并分别登录。
- [ ] 四个法律页公网返回 200。
- [ ] 两个 Mini 包各自通过 `ttdx minis check --output` 和 `check-release.mjs`。
- [ ] 预览包能加载对应剧集、播放视频、申请匿名会话；启用广告后再验证对应广告位。
- [ ] 共享剧目授权能复用 VID，未产生重复 BytePlus 上传。

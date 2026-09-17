# QuicK ReeLS 腾讯云生产部署与 TikTok Mini 发布手册

适用项目：QuicK ReeLS。
现有官网：`evergreenprosper.com`。
新增公网入口：`api.evergreenprosper.com`、`admin.evergreenprosper.com`。
适用服务器：腾讯云 Ubuntu Docker 镜像，已有 Evergreen Prosper 官网 Caddy 容器。

本手册覆盖两件相互独立的事：将 API、Worker 和运营后台部署到腾讯云；在 Windows 本机或 CI 构建并通过 TikTok Developer Portal 上传 Mini 包。**服务器部署不会自动发布 Mini 包。**

> 本项目的用户端采用匿名访客身份，不要求 TikTok 登录。不要为用户端配置账户授权、回调地址或用户 token 刷新/撤销任务。
>
> 所有会影响服务器、DNS、证书、Portal 的命令都应由有权限的运维人员在备份完成后执行。本文不授权在未核验的机器上直接操作。

## 1. 架构与安全边界

```text
用户 / TikTok Mini
        |
        | HTTPS
        v
腾讯云 CVM（同一公网 IP）
        |
        +-- evergreenprosper.com       -> 既有官网和法律页面
        +-- api.evergreenprosper.com   -> Caddy -> api:3000
        +-- admin.evergreenprosper.com -> Caddy -> admin:80

Docker 私网
        api + worker + 托管 PostgreSQL（推荐）
        或 api + worker + 内部 postgres（仅自建数据库方案）
```

已有官网的 Caddy 容器应独占 `80/tcp`、`443/tcp`、`443/udp`。QuicK ReeLS 的 Compose 服务只使用 Docker 网络中的 `expose`，不向主机发布 `3000` 或 `5432`。不要安装宿主机 Nginx、Certbot 或第二个公网反向代理。

部署前以下信息必须以服务器实际输出为准，而不是假定：Caddy 容器名称、Caddyfile 宿主机路径、官网静态根目录以及外部 Docker 网络名。本文用下列当前预期值示例：

```text
官网目录：/opt/evergreenprosper-website
Caddyfile：/opt/evergreenprosper-website/Caddyfile
Caddy 容器：evergreenprosper-website-web-1
共享网络：quickreels-proxy
```

## 2. 上线前检查

### 2.1 服务器与 Caddy

通过 SSH 登录服务器后先只读检查：

```bash
sudo ss -lntup | grep -E ':80|:443|:3000|:5432'
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
docker network ls
sudo sed -n '1,240p' /opt/evergreenprosper-website/Caddyfile
df -h
free -h
```

确认官网 Caddy 正常运行、`quickreels-proxy` 已存在或可由有权限人员创建，且没有其他服务占用 80/443。若容器名或目录不同，后续命令应统一替换为实际值。

### 2.2 腾讯云安全组、UFW 与 DNS

腾讯云安全组应为：

| 用途 | 协议/端口 | 来源 |
| --- | --- | --- |
| SSH 运维 | TCP 22 | 固定办公公网 IP |
| HTTP 与证书校验 | TCP 80 | `0.0.0.0/0`、`::/0` |
| HTTPS | TCP 443 | `0.0.0.0/0`、`::/0` |
| HTTP/3 | UDP 443 | `0.0.0.0/0`、`::/0` |

不开放 `2375`、`2376`、`3000`、`5432` 或 Caddy 管理端口。若启用了 UFW，先允许 SSH 再启用：

```bash
sudo ufw allow from <办公公网IP> to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
sudo ufw status verbose
```

在 DNS 中新增以下 A 记录，根域名和既有 `www` 记录不修改：

| 主机记录 | 类型 | 记录值 | TTL |
| --- | --- | --- | --- |
| `api` | A | CVM 公网 IPv4 | 600 |
| `admin` | A | CVM 公网 IPv4 | 600 |

DNS 生效后验证：

```powershell
Resolve-DnsName api.evergreenprosper.com
Resolve-DnsName admin.evergreenprosper.com
```

返回必须是目标 CVM IP。DNS、80/443 未正确就绪前，不要改 Caddy 或填写 Portal 的 Trusted Domain。

### 2.3 备份与发布记录

首次部署和每次生产发布前，创建云硬盘快照并验证数据库备份。服务器上至少备份当前 Caddyfile 和容器状态：

```bash
sudo install -d -m 700 /root/pre-quickreels-backup
sudo cp -a /opt/evergreenprosper-website/Caddyfile \
  /root/pre-quickreels-backup/Caddyfile.$(date +%F-%H%M%S)
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' \
  | sudo tee /root/pre-quickreels-backup/docker-ps.$(date +%F-%H%M%S).txt
```

记录发布 Git commit、镜像构建时间、迁移版本和操作人。不要以 `docker compose down -v` 作为普通更新步骤，它会删除命名卷。

## 3. 生产配置

### 3.1 选择 Compose 文件

| 数据库方案 | Compose 文件 | 用途 |
| --- | --- | --- |
| 腾讯云托管 PostgreSQL，推荐 | `compose.production.yml` | API、Worker、Admin；数据库经私网连接 |
| 私有 Docker PostgreSQL | `compose.production.self-hosted.yml` | API、Worker、Admin、内部 postgres；仅早期测试或已有恢复方案时使用 |

托管 PostgreSQL 应只允许 CVM 所在 VPC/安全组访问 5432，并启用自动备份和恢复演练。自建 PostgreSQL 不得配置 `ports: "5432:5432"`。

### 3.2 密钥文件

在服务器建立一个不随代码发布覆盖的配置目录：

```bash
sudo install -d -m 750 -o "$USER" -g "$USER" /opt/quickreels/shared
sudo touch /opt/quickreels/shared/api.production.env
sudo chmod 600 /opt/quickreels/shared/api.production.env
```

`/opt/quickreels/shared/api.production.env` 示例：

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3000

DATABASE_URL=postgresql://<app_user>:<strong_password>@<private_db_host>:5432/quickreels?schema=public
JWT_SECRET=<至少32位的随机值>
API_CORS_ORIGIN=https://admin.evergreenprosper.com
TRUST_GEO_COUNTRY_HEADER=false

# 管理后台构建时会使用，属于公开浏览器配置。
VITE_API_BASE_URL=https://api.evergreenprosper.com/api/v1

USER_JWT_EXPIRES_IN=3600
ADMIN_JWT_EXPIRES_IN=28800

# 按实际启用的媒体供应商填写，密钥仅留在此文件。
BYTEPLUS_ACCOUNT_ID=<account_id>
BYTEPLUS_SPACE_NAME=<space_name>
BYTEPLUS_REGION=ap-southeast-1
BYTEPLUS_ACCESS_KEY=<backend_only_key>
BYTEPLUS_SECRET_KEY=<backend_only_secret>
BYTEPLUS_VOD_ENDPOINT=https://vod.byteplusapi.com
API_PUBLIC_BASE_URL=https://api.evergreenprosper.com
COVER_ASSET_STORAGE_DIR=/var/lib/quickreels/cover-assets
UPLOAD_WORKER_INTERVAL_MS=30000
UPLOAD_MAX_RETRIES=5
```

使用真实 TikTok Preview 请求日志确认 Mini 的 `Origin` 后，才将其精确追加到 `API_CORS_ORIGIN`（逗号分隔）。不要设置为 `*`。`TRUST_GEO_COUNTRY_HEADER` 只有在可信代理会覆盖该请求头时才可设为 `true`。

`JWT_SECRET`、数据库密码、BytePlus 密钥不得进入 Git、`VITE_*` 变量、Mini ZIP、截图或日志。`VITE_TIKTOK_CLIENT_KEY` 仅在本机/CI Mini 构建时设置，不属于服务器 API 密钥文件。

## 4. 首次服务器部署

以下示例使用 `/opt/quickreels/current`。也可以采用带 Git commit 的不可变 release 目录并用符号链接切换；无论哪种方式，配置文件必须位于 release 目录之外。

```bash
sudo install -d -m 755 -o "$USER" -g "$USER" /opt/quickreels
cd /opt/quickreels
git clone <你的Git仓库SSH或HTTPS地址> current
cd current
```

仅在 `docker network inspect quickreels-proxy` 确认网络不存在时创建共享网络：

```bash
docker network inspect quickreels-proxy >/dev/null 2>&1 || docker network create quickreels-proxy
```

设定 env 文件位置并在启动前校验 Compose 展开结果：

```bash
export QUICKREELS_ENV_FILE=/opt/quickreels/shared/api.production.env
docker compose --env-file "$QUICKREELS_ENV_FILE" -f compose.production.yml config
docker compose --env-file "$QUICKREELS_ENV_FILE" -f compose.production.yml build
```

数据库迁移只执行生产安全命令，且必须在备份完成后执行：

```bash
docker compose --env-file "$QUICKREELS_ENV_FILE" -f compose.production.yml \
  run --rm api npx prisma migrate deploy

docker compose --env-file "$QUICKREELS_ENV_FILE" -f compose.production.yml \
  up -d api worker admin
docker compose --env-file "$QUICKREELS_ENV_FILE" -f compose.production.yml ps
```

生产环境不要执行开发迁移或演示数据 seed。若选用自建数据库，将所有上述 `compose.production.yml` 替换为 `compose.production.self-hosted.yml`，并在首次 `up -d` 后再执行迁移。

检查容器及共享网络：

```bash
docker network inspect quickreels-proxy --format '{{range .Containers}}{{println .Name}}{{end}}'
docker compose --env-file "$QUICKREELS_ENV_FILE" -f compose.production.yml logs --tail=100 api worker admin
```

## 5. Caddy、HTTPS 与运营后台

确认 API 和 Admin 已加入 `quickreels-proxy` 后，在现有 Caddyfile 中保留官网站点块，并增加：

```caddy
api.evergreenprosper.com {
    encode gzip
    reverse_proxy api:3000
}

admin.evergreenprosper.com {
    encode gzip
    reverse_proxy admin:80
}
```

在修改前备份、校验并重载 Caddy。将容器名替换为第 2.1 节得到的真实值：

```bash
export CADDY_CONTAINER=evergreenprosper-website-web-1
sudo cp /opt/evergreenprosper-website/Caddyfile \
  /opt/evergreenprosper-website/Caddyfile.bak.$(date +%F-%H%M%S)

sudo docker exec "$CADDY_CONTAINER" \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker exec "$CADDY_CONTAINER" \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker logs --tail=150 "$CADDY_CONTAINER"
```

Caddy 在 DNS 正确且 80/443 可达时自动签发和续期证书。不要再为这两个子域名安装 Certbot。验证入口：

```bash
curl -fsS https://api.evergreenprosper.com/health
curl -I https://admin.evergreenprosper.com
curl -I https://evergreenprosper.com
```

若日志显示 `lookup api` 或 `lookup admin`，优先检查服务是否在 `quickreels-proxy` 网络中，而不是修改 DNS。

## 6. 发布法律页面

法律文本源于 Mini 前端，并能导出为官网静态页：

```bash
pnpm --filter mini-web export:legal
```

输出目录：

```text
deploy/website/quickreels/privacy/index.html
deploy/website/quickreels/terms/index.html
```

建议在本机或 CI 导出、复核后随发布包上传。也可以在有依赖的服务器 release 目录执行。部署前先根据实际 Caddyfile 核对官网 `root` 指向；以下以 `/opt/evergreenprosper-website` 为静态根目录示例：

```bash
cd /opt/quickreels/current
pnpm --filter mini-web export:legal
sudo install -d -m 755 /opt/evergreenprosper-website/quickreels
sudo cp -a deploy/website/quickreels/. /opt/evergreenprosper-website/quickreels/
```

将 [`deploy/website/Caddyfile.quickreels-snippet`](../deploy/website/Caddyfile.quickreels-snippet) 的内容加到 `evergreenprosper.com` 站点块中最终 `file_server` 之前，然后按第 5 节校验并重载 Caddy。验证 TikTok Portal 要填写的 URL：

```bash
curl -IL https://evergreenprosper.com/quickreels/privacy
curl -IL https://evergreenprosper.com/quickreels/terms
```

两条命令最终都应返回 `200`。法律页内容与实际匿名观看记录、广告、数据存储位置和支持渠道必须保持一致，正式审核前应由合规人员确认。

## 7. 将本机更新同步到服务器

服务器不会自动感知本机代码变化。一次完整同步遵循以下链路：

```text
本机修改并验证
        -> Git 提交并推送到 origin
        -> 服务器拉取指定 commit
        -> 构建新镜像
        -> 执行生产迁移（如有）
        -> 重建 api / worker / admin
        -> 健康检查、日志检查、真机验证
```

不要把本机整个项目目录直接复制到正在运行的 `/opt/quickreels/current`，也不要用 `git reset --hard`、`git clean -fd`、`rm -rf` 来“同步”。前者会造成代码和运行镜像不一致，后者可能删除服务器上尚未处理的文件或配置。

### 7.1 先判断本次需要同步什么

| 本次改动 | 需要在服务器发布 | 需要在 TikTok Portal 重新上传 Mini |
| --- | --- | --- |
| `apps/api/`、`packages/`、Prisma migration、生产 Compose | 是 | 若 Mini API 合同/用户行为改变，建议一并上传 |
| `apps/admin-web/` 或后台 API 地址 | 是 | 否 |
| `apps/mini-web/` 的页面、广告、播放器、匿名会话 | API 支持变化时是 | 是 |
| `deploy/website/quickreels/` 或法律文本 | 是，复制法律静态页并重载 Caddy | 否 |
| 仅文档、测试或本地工具 | 否 | 否 |
| `.env.production.example` | 仅检查是否需要手工补充真实服务器 env | 否 |

Mini 包和服务器镜像是两份独立产物：发布 API 后，已安装的 Mini 包仍然是旧前端；仅上传 Mini 后，旧 API 也仍会继续运行。改动涉及两端时必须分别完成两次发布。

### 7.2 本机发布前准备

在 Windows PowerShell 的项目根目录执行。先检查改动，确认没有把真实密钥、临时文件或意外删除的文件混入提交：

```powershell
Set-Location 'D:\my project\tiktok-project'
git status --short
git diff --check
pnpm lint
pnpm test
```

有数据库结构改动时，还需确认 Prisma migration 已在 `apps/api/prisma/migrations/` 中，并检查生成的 SQL；不要只修改 `schema.prisma` 就发布。需要发布 Mini 时，再运行：

```powershell
$env:VITE_API_BASE_URL = 'https://api.evergreenprosper.com/api/v1'
$env:VITE_TIKTOK_CLIENT_KEY = '<TikTok Portal Client Key>'

pnpm --filter mini-web export:legal
pnpm --filter mini-web build:minis:release
pnpm --filter mini-web check:minis:output
```

将本次改动作为一个可追溯版本提交。下面的 `<文件或目录>` 必须替换为本次实际要发布的内容；不要对不明文件直接执行 `git add .`：

```powershell
git add <文件或目录>
git commit -m 'feat: <本次更新说明>'
git push origin main

$releaseCommit = git rev-parse HEAD
git tag -a "release-$(Get-Date -Format yyyyMMdd-HHmm)" -m "Release $releaseCommit"
git push origin --tags
Write-Host "本次服务器发布版本：$releaseCommit"
```

服务器应发布该输出的 commit 或 tag，而不是“当时 main 最新的内容”。在多人协作或自动化部署中，这一点能避免把其他未验收提交带入生产。

### 7.3 登录服务器并建立发布上下文

在本机连接服务器：

```powershell
ssh <服务器用户>@<服务器公网IP>
```

登录后执行下列命令。`COMPOSE_FILE` 二选一：托管 PostgreSQL 使用 `compose.production.yml`；自建 PostgreSQL 使用 `compose.production.self-hosted.yml`。后续同一终端都使用这四个变量：

```bash
export APP_DIR=/opt/quickreels/current
export QUICKREELS_ENV_FILE=/opt/quickreels/shared/api.production.env
export COMPOSE_FILE=compose.production.yml
export CADDY_CONTAINER=evergreenprosper-website-web-1

cd "$APP_DIR"
git status --short
git rev-parse --short HEAD
docker compose --env-file "$QUICKREELS_ENV_FILE" -f "$COMPOSE_FILE" ps
```

若 `git status --short` 有输出，先停止发布并确认原因。服务器代码目录原则上不应手工修改；生产密钥必须保留在 `/opt/quickreels/shared/api.production.env`，不应放在 Git 工作区。不要用强制 Git 命令消除未知改动。

### 7.4 备份、记录当前可回滚版本并拉取代码

每次准备更新前保存旧版本值并创建数据库备份。托管数据库使用腾讯云控制台的即时备份或已验证的逻辑备份；自建数据库请按实际容器/卷备份流程操作。

```bash
cd "$APP_DIR"
export PREVIOUS_COMMIT=$(git rev-parse HEAD)
export TARGET_COMMIT=<第7.2节输出的commit或tag>
printf 'previous=%s\ntarget=%s\nstarted=%s\n' \
  "$PREVIOUS_COMMIT" "$TARGET_COMMIT" "$(date -Is)" \
  | sudo tee /opt/quickreels/shared/last-release.txt >/dev/null

git fetch --tags origin
git show --stat --oneline "$TARGET_COMMIT"
```

在 `git show` 中确认改动确实是准备上线的内容，再切换：

```bash
git checkout --detach "$TARGET_COMMIT"
git rev-parse HEAD
git status --short
```

如果团队约定服务器始终跟随 `main`，可改为 `git switch main && git pull --ff-only origin main`；仍需先记录 `PREVIOUS_COMMIT`，并且只在服务器工作区干净时执行。固定 commit/tag 更适合生产回滚。

### 7.5 检查生产配置并构建镜像

代码更新不会自动修改服务器密钥文件。对照当前 checkout 的 `.env.production.example` 检查是否增加了必须变量；只用编辑器手工补充真实值，绝不使用示例文件覆盖 `/opt/quickreels/shared/api.production.env`。

```bash
cd "$APP_DIR"
sudo stat -c '%a %U:%G %n' "$QUICKREELS_ENV_FILE"
docker compose --env-file "$QUICKREELS_ENV_FILE" -f "$COMPOSE_FILE" config >/tmp/quickreels-compose.rendered.yml
sed -n '1,260p' /tmp/quickreels-compose.rendered.yml
docker compose --env-file "$QUICKREELS_ENV_FILE" -f "$COMPOSE_FILE" build --pull api worker admin
```

预期密钥文件权限为 `600`。`config` 失败、缺变量、服务名/网络不正确时不要继续。默认使用 Docker 缓存是正常的：发生 Dockerfile、依赖锁文件或构建异常时，才针对受影响服务追加 `--no-cache` 重新构建，而不是每次全量无缓存构建。

### 7.6 迁移数据库并更新服务

只有本次包含新的 Prisma migration 时才执行迁移；迁移必须在数据库备份完成后进行。生产只允许使用：

```bash
docker compose --env-file "$QUICKREELS_ENV_FILE" -f "$COMPOSE_FILE" \
  run --rm api npx prisma migrate deploy
```

随后重建服务。`--no-deps` 不会停止或重建托管数据库；自建数据库方案中也不会在普通应用发布时触碰 `postgres`：

```bash
docker compose --env-file "$QUICKREELS_ENV_FILE" -f "$COMPOSE_FILE" \
  up -d --no-deps --force-recreate api worker admin

docker compose --env-file "$QUICKREELS_ENV_FILE" -f "$COMPOSE_FILE" ps
docker compose --env-file "$QUICKREELS_ENV_FILE" -f "$COMPOSE_FILE" logs --tail=150 api worker admin
```

不要执行 `prisma migrate dev`，不要在生产执行 seed，也不要在常规更新中使用 `docker compose down -v`。

### 7.7 验证新版本

容器显示 `Up` 不代表接口和数据库已经可用。依次验证容器健康、内部服务、Caddy 公网入口和日志：

```bash
docker compose --env-file "$QUICKREELS_ENV_FILE" -f "$COMPOSE_FILE" ps
docker compose --env-file "$QUICKREELS_ENV_FILE" -f "$COMPOSE_FILE" logs --tail=200 api worker admin
curl -fsS https://api.evergreenprosper.com/health
curl -I https://admin.evergreenprosper.com
curl -I https://evergreenprosper.com
```

注意：当前 API 没有向主机发布 `3000`；健康检查应通过 Caddy 的公网 HTTPS 入口完成。检查 `quickreels-proxy` 网络：

```bash
docker network inspect quickreels-proxy --format '{{range .Containers}}{{println .Name}}{{end}}'
sudo docker logs --tail=150 "$CADDY_CONTAINER"
```

最后用浏览器验证后台，并用 TikTok Preview 真机验证受本次改动影响的匿名首开、进入广告、剧集解锁、播放器、历史记录和继续观看。发布日志出现持续报错、health 失败或核心验收失败时，不要继续发布 Mini 正式版本。

### 7.8 法律页、Caddyfile 与 Mini 包的同步

**法律页有改动时**，先在本机构建并确认 Git 提交中包含 `deploy/website/quickreels/`；然后从 Windows 上传该目录，而不是覆盖官网根目录：

```powershell
$server = '<服务器用户>@<服务器公网IP>'
$releaseCommit = git rev-parse HEAD
scp -r '.\deploy\website\quickreels' "${server}:/tmp/quickreels-legal-$releaseCommit"
```

在服务器检查内容后再复制到已核对的官网静态根目录：

```bash
export RELEASE_COMMIT=<第7.2节输出的commit>
sudo find "/tmp/quickreels-legal-$RELEASE_COMMIT" -maxdepth 3 -type f -print
sudo install -d -m 755 /opt/evergreenprosper-website/quickreels
sudo cp -a "/tmp/quickreels-legal-$RELEASE_COMMIT/." \
  /opt/evergreenprosper-website/quickreels/
curl -IL https://evergreenprosper.com/quickreels/privacy
curl -IL https://evergreenprosper.com/quickreels/terms
```

**Caddyfile 有改动时**，先备份，再执行 `caddy validate` 成功后才 reload，命令见第 5 节。不要重启或重建已有官网 Caddy 容器来应用普通 API 更新。

**Mini 前端有改动时**，按第 8 节在本机/CI 重新构建，将 `apps/mini-web/dist` 的实际 CLI 产物上传 TikTok Developer Portal，生成新的 Preview 后再真机验证。仅发布服务器不会更新用户手机上的 Mini 前端。

### 7.9 回滚

应用代码或镜像出问题且数据库没有不兼容迁移时，先回到第 7.4 节记录的旧版本：

```bash
cd "$APP_DIR"
export ROLLBACK_COMMIT=$(sed -n 's/^previous=//p' /opt/quickreels/shared/last-release.txt)
test -n "$ROLLBACK_COMMIT"
git checkout --detach "$ROLLBACK_COMMIT"
docker compose --env-file "$QUICKREELS_ENV_FILE" -f "$COMPOSE_FILE" build api worker admin
docker compose --env-file "$QUICKREELS_ENV_FILE" -f "$COMPOSE_FILE" \
  up -d --no-deps --force-recreate api worker admin
curl -fsS https://api.evergreenprosper.com/health
```

若已经执行了数据库迁移，不要假定仅回退应用就完全安全。先停止进一步写入，评估旧版本是否兼容新 schema；不兼容时按已演练的数据库恢复计划处理。Caddyfile 回滚则恢复第 2.3 节备份文件，先校验再 reload。Mini 回滚需要在 Portal 选择或重新上传上一份已验证的 Mini 版本。

## 8. Windows 本机或 CI 构建 TikTok Mini

Mini 的上传产物必须本机或 CI 构建，不能由服务器的 Docker Compose 生成。PowerShell 示例：

```powershell
Set-Location 'D:\my project\tiktok-project'

$env:VITE_API_BASE_URL = 'https://api.evergreenprosper.com/api/v1'
$env:VITE_TIKTOK_CLIENT_KEY = '<TikTok Portal Client Key>'

pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm --filter mini-web export:legal
pnpm --filter mini-web build:minis:release
pnpm --filter mini-web check:minis:output
```

`build:minis:release` 会构建 Web、生成生产 Mini 包并验证以下约束：API 地址必须是非 localhost 的 HTTPS URL；Client Key 不可为空或占位符；构建产物必须包含两项公开配置。实际上传目录以命令生成的 `apps/mini-web/dist` 内容为准，不要手工压缩源代码目录替代 CLI 产物。

生产 Mini 构建变量只能包含公开值，例如 API 地址、Client Key 和已获批准的广告 Placement ID。服务端密钥、数据库连接串和 JWT Secret 不得进入 Mini 构建。

## 9. TikTok Developer Portal 与真机验收

在 TikTok Developer Portal 使用同一个 Mini App 的 App ID 和 Client Key，按以下顺序配置：

1. 填写公开可访问的隐私政策和服务条款：
   `https://evergreenprosper.com/quickreels/privacy`、`https://evergreenprosper.com/quickreels/terms`。
2. 在 Trusted Domains 添加 `https://api.evergreenprosper.com`。不要填 API path、端口、通配符或 `http` URL。
3. 上传第 8 节 CLI 产生的生产 Mini 产物，创建 Preview 并配置测试用户。
4. 用真机 TikTok 扫 Preview 二维码，查看 API 日志并把真实必要 Origin 精确写入 `API_CORS_ORIGIN` 后重新发布 API。
5. 完成匿名访客首开、进入广告（开关与观看次数）、剧集广告、播放、继续观看、历史记录、前后台切换、弱网与错误提示的验收。

进入广告如使用 `REWARDED_GATED`，需先确认 Portal 广告政策和 Placement 已获批准，并与剧集解锁广告使用不同的 Placement。

对于美国、欧盟、英国等首发市场，提交前还需按 TikTok Portal 的地区发布审批、数据处理和广告政策完成材料；隐私政策必须准确披露服务器、数据库、日志和第三方媒体服务的实际地域。

## 10. 生产验收清单

### 基础设施

- [ ] 官网、API、后台均可访问，且新 Caddy 配置没有覆盖官网。
- [ ] `api`、`admin` DNS 已解析到正确 CVM，HTTPS 证书有效。
- [ ] 安全组和 UFW 未对公网开放 3000、5432 或 Docker API。
- [ ] 数据库为私网访问，自动备份已启用并完成过恢复演练。
- [ ] `api`、`worker`、`admin` 均处于运行状态，日志没有持续错误。

### 应用与 Mini

- [ ] `https://api.evergreenprosper.com/health` 健康检查成功。
- [ ] 管理员可登录后台，匿名用户不会获得管理员权限。
- [ ] 生产 API 使用精确 CORS 白名单，未启用不可信地理请求头。
- [ ] 所有真实密钥均在服务器 Secret 文件或 CI Secret 中，不在仓库和 Mini 产物中。
- [ ] Mini 产物无 localhost、Mock 配置或占位 Client Key。
- [ ] 真机 Preview 已完成匿名观看、进入广告、剧集广告、播放进度与历史记录验证。

### Portal 与合规

- [ ] Trusted Domain 为 `https://api.evergreenprosper.com`。
- [ ] 隐私政策和服务条款为公开 HTTPS 页面且最终响应为 200。
- [ ] Portal App ID 与 `apps/mini-web/minis.config.json` 一致。
- [ ] 目标市场、广告 Placement、企业/行业资质及地区审批已按 Portal 要求完成。

## 11. 常见故障

| 现象 | 优先检查 |
| --- | --- |
| 证书签发失败 | DNS 是否已生效，安全组/UFW 是否放行 TCP 80、443，Caddy 日志是否有挑战失败信息 |
| API 502 | `docker compose ... ps`、API healthcheck、`quickreels-proxy` 是否有 `api` 容器 |
| 后台空白或 API 请求失败 | `VITE_API_BASE_URL` 是否为 HTTPS API 地址，浏览器 Console 与 CORS 白名单是否一致 |
| Mini 不能请求 API | Trusted Domains 是否填写根域名而非 path，生产包是否真的使用 HTTPS API 地址 |
| 法律页 404 | Caddy `root` 是否和复制目录一致，rewrite 规则是否位于 `file_server` 之前 |
| 发布后功能异常 | 比对发布 commit、环境变量和迁移结果；先回退应用，再按备份计划处理数据库 |

## 12. 官方资料

- [TikTok Mini Development Configuration](https://developers.tiktok.com/docs/en/set-up-development-configuration)
- [TikTok Minis Server APIs Overview](https://developers.tiktok.com/docs/en/minis-server-apis-overview)
- [TikTok U.S. and EU/UK Launch Approval Process](https://developers.tiktok.com/docs/en/us-launch-approval-process)
- [Tencent Cloud CVM Documentation](https://www.tencentcloud.com/document/product/213)

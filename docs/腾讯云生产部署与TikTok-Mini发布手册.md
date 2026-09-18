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
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
sudo docker network ls
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
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' \
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

标准部署将真实生产变量保存在项目根目录的 `/opt/quickreels/.env.production`，该文件已被 Git 忽略，代码更新不会覆盖它。新服务器创建该文件后限制权限：

```bash
sudo touch /opt/quickreels/.env.production
sudo chmod 600 /opt/quickreels/.env.production
```

`/opt/quickreels/.env.production` 示例：

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3000

DATABASE_URL=postgresql://<app_user>:<strong_password>@<private_db_host>:5432/quickreels?schema=public
JWT_SECRET=<至少32位的随机值>
# 允许后台与 TikTok Mini WebView；仅接受 HTTPS 的 tiktok.com 子域名。
API_CORS_ORIGIN=https://admin.evergreenprosper.com,https://*.tiktok.com
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

`API_CORS_ORIGIN` 是逗号分隔的白名单。TikTok Mini 预览会从 `*.tiktok.com` 的 HTTPS WebView 发起请求，因此生产环境应保留 `https://*.tiktok.com`；它只匹配 `tiktok.com` 的子域名，不匹配任意站点或伪造域名。不要设置为 `*`。`TRUST_GEO_COUNTRY_HEADER` 只有在可信代理会覆盖该请求头时才可设为 `true`。

`JWT_SECRET`、数据库密码、BytePlus 密钥不得进入 Git、`VITE_*` 变量、Mini ZIP、截图或日志。`VITE_TIKTOK_CLIENT_KEY` 仅在本机/CI Mini 构建时设置，不属于服务器 API 密钥文件。

## 4. 首次服务器部署

以下示例使用当前服务器已验证的 `/opt/quickreels` 目录。也可以采用带 Git commit 的不可变 release 目录并用符号链接切换，但必须同步调整第 7 节的 `APP_DIR` 与 `ENV_FILE`。

```bash
sudo install -d -m 755 -o "$USER" -g "$USER" /opt
cd /opt
git clone <你的Git仓库SSH或HTTPS地址> quickreels
cd /opt/quickreels
```

仅在 `docker network inspect quickreels-proxy` 确认网络不存在时创建共享网络：

```bash
sudo docker network inspect quickreels-proxy >/dev/null 2>&1 || sudo docker network create quickreels-proxy
```

设定 env 文件位置并在启动前校验 Compose 展开结果：

```bash
export ENV_FILE=/opt/quickreels/.env.production
sudo docker compose --env-file "$ENV_FILE" -f compose.production.yml config
sudo docker compose --env-file "$ENV_FILE" -f compose.production.yml build
```

数据库迁移只执行生产安全命令，且必须在备份完成后执行：

```bash
sudo docker compose --env-file "$ENV_FILE" -f compose.production.yml \
  run --rm api npx prisma migrate deploy

sudo docker compose --env-file "$ENV_FILE" -f compose.production.yml \
  up -d api worker admin
sudo docker compose --env-file "$ENV_FILE" -f compose.production.yml ps
```

生产环境不要执行开发迁移或演示数据 seed。若选用自建数据库，将所有上述 `compose.production.yml` 替换为 `compose.production.self-hosted.yml`，并在首次 `up -d` 后再执行迁移。

检查容器及共享网络：

```bash
sudo docker network inspect quickreels-proxy --format '{{range .Containers}}{{println .Name}}{{end}}'
sudo docker compose --env-file "$ENV_FILE" -f compose.production.yml logs --tail=100 api worker admin
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
curl -fsS https://api.evergreenprosper.com/ready
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
cd /opt/quickreels
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

## 7. 可复用的更新发布流程

服务器不会自动感知本机代码变化。每次发布必须将本机改动提交到 Git，并让服务器拉取一个明确的 tag 或 commit。当前腾讯云服务器已验证的运行环境如下：

```text
SSH 用户：ubuntu（Docker 命令必须使用 sudo）
项目目录：/opt/quickreels
生产 env：/opt/quickreels/.env.production
数据库：Docker 自建 PostgreSQL（容器 quickreels-postgres-1）
Compose：compose.production.self-hosted.yml
Caddy 容器：evergreenprosper-website-web-1
官网静态目录：/opt/evergreenprosper-website
```

如果未来切换到腾讯云托管 PostgreSQL，才将 `COMPOSE_FILE` 改为 `compose.production.yml`；两种方案不能混用。

```text
本机修改并验证
        -> Git 提交、推送并创建 release tag
        -> 备份 Caddy、容器清单和数据库
        -> 服务器拉取并 checkout 固定 tag
        -> 检查真实生产 env，再构建镜像
        -> 执行 prisma migrate deploy（仅有 migration 时）
        -> 重建 api / worker / admin
        -> 健康检查、日志、法律页、Mini 真机验证
```

不要把本机整个项目目录直接复制到服务器，不要使用 `git reset --hard`、`git clean -fd`、`rm -rf`、`docker compose down -v` 来“同步”。它们会删除未知文件、配置或数据卷。

### 7.1 先判断本次需要发布什么

| 本次改动 | 服务器更新 | Portal 重新上传 Mini |
| --- | --- | --- |
| `apps/api/`、`packages/`、Prisma migration、生产 Compose | 是 | 若影响 Mini API 合同或用户流程，建议同时上传 |
| `apps/admin-web/` | 是 | 否 |
| `apps/mini-web/` 的页面、广告、播放器、匿名会话 | API 有配套改动时是 | 是 |
| `deploy/website/quickreels/` 或法律文本 | 是，复制静态页 | 否 |
| 仅文档、测试或本地工具 | 否 | 否 |
| `.env.production.example` | 检查服务器真实 env 是否需手工新增变量 | 否 |

Mini 包和服务器镜像是两份独立产物。服务器发布不会更新用户手机上的 Mini 前端；只上传 Mini 也不会更新 API。

### 7.2 本机发布前准备与 Git 版本

在 Windows PowerShell 执行。确认提交中不含真实密钥、构建产物、`tmp/` 或本地测试媒体：

```powershell
Set-Location 'D:\my project\tiktok-project'
git status --short
git diff --check
pnpm lint
pnpm test
pnpm build
```

有数据库结构改动时，必须确认 `apps/api/prisma/migrations/` 包含新 migration，并审阅 SQL；不能只改 `schema.prisma`。需要发布 Mini 时，再运行：

```powershell
$env:VITE_API_BASE_URL = 'https://api.evergreenprosper.com/api/v1'
$env:VITE_TIKTOK_CLIENT_KEY = '<TikTok Portal Client Key>'

pnpm --filter mini-web export:legal
pnpm --filter mini-web build:minis:release
pnpm --filter mini-web check:minis:output
```

提交并创建可回滚版本。`<文件或目录>` 仅填本次确认要发布的内容：

```powershell
git add <文件或目录>
git commit -m 'feat: <本次更新说明>'
git push origin main

$releaseCommit = git rev-parse HEAD
$releaseTag = "release-$(Get-Date -Format yyyyMMdd-HHmmss)"
git tag -a $releaseTag -m "Release $releaseCommit"
git push origin $releaseTag
Write-Host "服务器应发布：$releaseTag ($releaseCommit)"
```

### 7.3 发布前备份

登录服务器并建立本次终端上下文：

```bash
ssh ubuntu@<服务器公网IP>

export APP_DIR=/opt/quickreels
export ENV_FILE=/opt/quickreels/.env.production
export COMPOSE_FILE=compose.production.self-hosted.yml
export CADDY_CONTAINER=evergreenprosper-website-web-1
export POSTGRES_CONTAINER=quickreels-postgres-1
cd "$APP_DIR"
```

先确认服务器代码目录干净、env 文件存在；如 `git status --short` 有输出，停止发布，不要强制清理：

```bash
git status --short
git rev-parse --short HEAD
sudo test -f "$ENV_FILE" && echo '生产环境文件存在'
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
```

创建 Caddy、容器和数据库备份。数据库备份文件必须大于 `0B`：

```bash
sudo install -d -m 700 /root/pre-quickreels-backup
sudo cp -a /opt/evergreenprosper-website/Caddyfile \
  "/root/pre-quickreels-backup/Caddyfile.$(date +%F-%H%M%S)"
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' \
  | sudo tee "/root/pre-quickreels-backup/docker-ps.$(date +%F-%H%M%S).txt"

set -o pipefail
DB_BACKUP="/root/pre-quickreels-backup/quickreels-db-$(date +%F-%H%M%S).sql.gz"
sudo docker exec "$POSTGRES_CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip \
  | sudo tee "$DB_BACKUP" > /dev/null
sudo ls -lh "$DB_BACKUP"
```

托管 PostgreSQL 不使用上面的容器备份命令，应改用腾讯云控制台即时备份或已验证的逻辑备份。

### 7.4 拉取固定版本并检查环境变量

将 `<release-tag>` 换成第 7.2 节创建的值。使用 `--no-pager` 防止 `git show` 进入分页器；若已进入并看到 `(END)` 或 `:`，按 `q` 返回终端。

```bash
cd "$APP_DIR"
PREVIOUS_COMMIT=$(git rev-parse HEAD)
TARGET_RELEASE=<release-tag>
printf 'previous=%s\ntarget=%s\nstarted=%s\n' \
  "$PREVIOUS_COMMIT" "$TARGET_RELEASE" "$(date -Is)" \
  | sudo tee /root/pre-quickreels-backup/last-release.txt >/dev/null

git fetch --tags origin
git --no-pager show --stat --oneline "$TARGET_RELEASE"
git checkout --detach "$TARGET_RELEASE"
git rev-parse --short HEAD
git status --short
```

代码更新不会自动更新服务器真实 env 文件。只显示变量名以确认配置，不要将完整 env 内容发给任何人：

```bash
sudo awk -F= '/^(VITE_API_BASE_URL|API_PUBLIC_BASE_URL|COVER_ASSET_STORAGE_DIR)=/ {print $1 "=<已配置>"}' "$ENV_FILE"
```

如发布版本的 `.env.production.example` 有新增必填项，使用编辑器在真实 env 文件中补充，不要用示例文件覆盖它。当前版本需要以下两项用于公开封面地址和持久化封面目录：

```bash
sudo nano "$ENV_FILE"
```

```env
API_PUBLIC_BASE_URL=https://api.evergreenprosper.com
COVER_ASSET_STORAGE_DIR=/var/lib/quickreels/cover-assets
```

### 7.5 校验、构建、迁移和重建

先让 Compose 使用真实 env 展开配置。出现缺变量、网络不存在或语法错误时停止，不要继续：

```bash
cd "$APP_DIR"
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  config >/tmp/quickreels-compose.yml
echo 'Compose 配置校验成功'
```

构建 API、Worker、后台镜像。Docker 使用缓存是正常现象；仅在 Dockerfile、依赖或构建异常排查时才对受影响服务增加 `--no-cache`：

```bash
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  build --pull api worker admin
```

仅在本次 release 含有新的 Prisma migration 时执行迁移。确认备份存在后，生产只允许使用 `migrate deploy`：

```bash
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  run --rm api npx prisma migrate deploy
```

然后重建应用服务。`--no-deps` 不会停止、删除或重建 PostgreSQL；新增的命名卷会由 Compose 自动创建：

```bash
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  up -d --no-deps --force-recreate api worker admin
```

不要在生产执行 `prisma migrate dev`、seed 脚本或 `docker compose down -v`。

### 7.6 发布后验证

服务刚启动时 API 可能短暂显示 `health: starting`；等待健康检查周期后应转为 `healthy`。公网 `/ready` 返回 `database: ok` 才表示 API 和数据库都可用：

```bash
sleep 35
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  logs --tail=150 api worker admin

curl -fsS https://api.evergreenprosper.com/ready
curl -I https://admin.evergreenprosper.com
curl -I https://evergreenprosper.com
```

API 没有向宿主机发布 `3000`，因此不要用 `http://127.0.0.1:3000` 作为服务器验收地址。需要检查反向代理时：

```bash
sudo docker network inspect quickreels-proxy \
  --format '{{range .Containers}}{{println .Name}}{{end}}'
sudo docker logs --tail=150 "$CADDY_CONTAINER"
```

### 7.7 同步法律页与 Mini 包

本次 `deploy/website/quickreels/` 有改动时，代码已随 Git 拉取到服务器。确认官网静态根目录后直接复制，不必重新 clone 或覆盖官网根目录；只更新静态文件时无需重启 Caddy：

```bash
cd "$APP_DIR"
sudo install -d -m 755 /opt/evergreenprosper-website/quickreels
sudo cp -a deploy/website/quickreels/. \
  /opt/evergreenprosper-website/quickreels/

curl -IL https://evergreenprosper.com/quickreels/privacy
curl -IL https://evergreenprosper.com/quickreels/terms
```

只有 Caddyfile 本身发生改动时，才备份、校验并 reload Caddy；普通 API、后台或法律页更新都不需要重启官网 Caddy 容器。

Mini 前端有改动时，回到 Windows 本机或 CI，使用第 8 节生成 `apps/mini-web/dist/minis.config.zip` 并上传 TikTok Developer Portal。先发布服务器 API，再上传 Mini Preview，最后用真机验证匿名首开、进入广告、剧集解锁、播放进度、历史记录和继续观看。

### 7.8 回滚

应用异常且数据库 schema 仍兼容旧版本时，读取备份目录中的旧 commit 并重建旧版本应用：

```bash
cd "$APP_DIR"
ROLLBACK_COMMIT=$(sudo sed -n 's/^previous=//p' /root/pre-quickreels-backup/last-release.txt)
test -n "$ROLLBACK_COMMIT"
git checkout --detach "$ROLLBACK_COMMIT"
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build api worker admin
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  up -d --no-deps --force-recreate api worker admin
curl -fsS https://api.evergreenprosper.com/ready
```

已执行数据库迁移时，不要假定应用回滚即可恢复。先停止继续写入，评估旧版本是否兼容新 schema；不兼容则根据第 7.3 节的数据库备份恢复。Caddyfile 回滚应恢复备份文件，先 `caddy validate` 再 reload；Mini 回滚则在 Portal 选择或重新上传上一份已验证的版本。

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

`build:minis:release` 会构建 Web、生成生产 Mini 配置、验证以下约束，并生成唯一可上传文件 `apps/mini-web/dist/minis.config.zip`：API 地址必须是非 localhost 的 HTTPS URL；Client Key 不可为空或占位符；构建产物必须包含两项公开配置。不要上传 `dist` 目录、`index.html`，也不要手工压缩源代码目录替代该 ZIP。

生产 Mini 构建变量只能包含公开值，例如 API 地址、Client Key 和已获批准的广告 Placement ID。服务端密钥、数据库连接串和 JWT Secret 不得进入 Mini 构建。

## 9. TikTok Developer Portal 与真机验收

在 TikTok Developer Portal 使用同一个 Mini App 的 App ID 和 Client Key，按以下顺序配置：

1. 填写公开可访问的隐私政策和服务条款：
   `https://evergreenprosper.com/quickreels/privacy`、`https://evergreenprosper.com/quickreels/terms`。
2. 在 Trusted Domains 添加 `https://api.evergreenprosper.com`。不要填 API path、端口、通配符或 `http` URL。
3. 上传第 8 节 CLI 产生的 `apps/mini-web/dist/minis.config.zip`，创建 Preview 并配置测试用户。
4. 用真机 TikTok 扫 Preview 二维码，确认匿名会话请求返回 200；服务器的 `API_CORS_ORIGIN` 必须包含 `https://*.tiktok.com`，修改后重新发布 API。
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

- [ ] `https://api.evergreenprosper.com/ready` 返回 `database: ok`。
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
| API 502 | `sudo docker compose ... ps`、API healthcheck、`quickreels-proxy` 是否有 `api` 容器 |
| 后台空白或 API 请求失败 | `VITE_API_BASE_URL` 是否为 HTTPS API 地址，浏览器 Console 与 CORS 白名单是否一致 |
| Mini 无法打开或不能请求 API | 先确认上传的是 `dist/minis.config.zip`，不是 `dist` 目录或 `index.html`；Trusted Domains 填写 `https://api.evergreenprosper.com`（不带 path）；服务器 `.env.production` 的 `API_CORS_ORIGIN` 应包含 `https://*.tiktok.com`，修改后重建并重启 API |
| 法律页 404 | Caddy `root` 是否和复制目录一致，rewrite 规则是否位于 `file_server` 之前 |
| `docker.sock: permission denied` | 当前 SSH 用户不在 Docker 用户组；将每条 Docker 命令改为 `sudo docker ...`，而不是只给管道末尾的 `tee` 加 sudo |
| `VITE_API_BASE_URL is missing` | Compose 未使用生产 env 文件；确认 `ENV_FILE=/opt/quickreels/.env.production`，并加 `--env-file "$ENV_FILE"` |
| `git show` 停在 `(END)` 或 `:` | Git 正在 `less` 分页器中，按 `q` 返回 shell；后续使用 `git --no-pager show --stat --oneline <tag>` |
| API 显示 `health: starting` | 刚重建后的正常短暂状态；等待约 35 秒，使用公网 `/ready` 检查数据库是否为 `ok` |
| `migrate deploy` 失败 | 立即停止后续 `up` 操作；保留错误输出，使用发布前数据库备份和旧 commit 评估恢复，绝不改用 `migrate dev` |
| 发布后功能异常 | 比对发布 commit、环境变量和迁移结果；先回退应用，再按备份计划处理数据库 |

## 12. 官方资料

- [TikTok Mini Development Configuration](https://developers.tiktok.com/docs/en/set-up-development-configuration)
- [TikTok Minis Server APIs Overview](https://developers.tiktok.com/docs/en/minis-server-apis-overview)
- [TikTok U.S. and EU/UK Launch Approval Process](https://developers.tiktok.com/docs/en/us-launch-approval-process)
- [Tencent Cloud CVM Documentation](https://www.tencentcloud.com/document/product/213)

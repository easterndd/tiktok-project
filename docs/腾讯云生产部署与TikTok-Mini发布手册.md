# QuicK ReeLS：腾讯云生产部署与 TikTok Mini 发布手册

**适用 App ID：** `7681547859254429717`
**适用域名：** `evergreenprosper.com`
**目标：** 不影响既有官网，在腾讯云服务器上新增 QuicK ReeLS API、运营后台和公开法律页面，并完成 TikTok Mini Preview 的前置条件。

> 本手册不执行服务器、DNS、Portal 或证书变更；每一项会影响公网服务的操作都应在确认备份、维护窗口和回滚方案后由有服务器权限的人员执行。
>
> 本项目当前的 `docker-compose.yml` 仅用于本地 PostgreSQL 开发，**不能原样用于生产环境**。生产部署前需要补充独立的生产 Compose、后台静态站构建和管理员初始化流程。

---

## 1. 推荐架构

现有官网无需迁移。使用同一个公网 IP、不同 HTTPS 域名即可由现有 Caddy 正确分流：

```text
用户 / TikTok Mini
        |
        | HTTPS
        v
腾讯云 CVM / Lighthouse（现有公网 IP）
        |
        +-- evergreenprosper.com
        |     现有官网（保持不动）
        |
        +-- api.evergreenprosper.com
        |     Caddy -> QuicK ReeLS Fastify API:3000
        |
        +-- admin.evergreenprosper.com
              Caddy -> QuicK ReeLS 管理后台静态文件

API / Worker / PostgreSQL 仅在私网 Docker 网络或 localhost 通信。
3000、5432 不向公网开放。
```

### 1.2 已确认的本机实际情况

本项目目标服务器当前已核验为：

```text
操作系统：Ubuntu
公网 IP：43.172.66.90
现有官网入口：Docker 容器 evergreenprosper-website-web-1
入口软件：Caddy 2.11.4
官网目录：/opt/evergreenprosper-website
Caddyfile：/opt/evergreenprosper-website/Caddyfile
公网端口：Caddy 容器独占 80/tcp、443/tcp、443/udp
共享 Docker 网络：quickreels-proxy
```

因此本机**不要安装宿主机 Nginx**，也不要让 QuicK ReeLS 的任何容器发布 80/443。Caddy 继续负责官网、两个新子域名的 HTTPS 和反向代理。

对外法律页可优先放在已有官网：

```text
https://evergreenprosper.com/quickreels/privacy
https://evergreenprosper.com/quickreels/terms
```

这样既不增加域名，又能为 TikTok Portal 的 Basic Information 提供稳定、公开、HTTPS 的隐私政策和服务条款链接。

本仓库会从 Mini 前端使用的同一份法律文本导出官网静态页：

```bash
pnpm --filter mini-web export:legal
```

导出结果位于：

```text
deploy/website/quickreels/privacy/index.html
deploy/website/quickreels/terms/index.html
```

为避免 TikTok Portal 填写的无尾斜杠 URL 发生 404，应把 `deploy/website/Caddyfile.quickreels-snippet` 中的 rewrite 规则加入现有 `evergreenprosper.com` 站点块，并放在最终 `file_server` 指令之前。

### 1.1 域名分工

| 域名 | DNS | 对外用途 | 是否填入 TikTok Trusted Domains |
| --- | --- | --- | --- |
| `evergreenprosper.com` | 保持现状 | 既有官网、法律页 | 仅当 Mini 直接请求它时才填写 |
| `api.evergreenprosper.com` | 新增 A 记录 | Mini 用户端 API | 是，填 `https://api.evergreenprosper.com` |
| `admin.evergreenprosper.com` | 新增 A 记录 | 内部运营后台 | 否 |

TikTok Trusted Domains 只接受 HTTPS 域名，不填 URL path、端口或通配符。TikTok Mini 运行时会拒绝未登记域名的网络请求；官方上限为 20 个域名。

---

## 2. 上线前必须决定的事项

### 2.1 服务器地区与首发市场

当前服务器在美国硅谷，技术上可以托管 API；服务器位置本身不会阻止 DNS、证书或 Mini Preview。

但发布市场和数据位置必须一致：

- **首发美国、英国或欧盟：** 在 TikTok Developer Portal 提交相应 Launch Approval；如启用 IAA 广告，需要按 Portal 指引披露主体、团队、支持人员、数据中心和第四方服务商，并可能进入 TPRM 与数据安全协议流程。
- **首发非美国/欧盟/英国市场：** 仍应在隐私政策中如实说明美国服务器、数据库、日志和运维人员的访问位置；不要沿用“数据仅在新加坡”的旧表述。
- **首发市场偏东南亚或东亚：** 建议将 API 和数据库部署到新加坡等靠近目标用户的地域，降低延迟并简化数据驻留说明。

在没有美国发布批准前，不要把美国设为 Mini 的正式可用地区，也不要开启面向美国用户的 IAA。

### 2.2 现有官网的技术栈

登录服务器后先确认现有站点使用什么方式运行。以下命令只读取状态，不会改动服务：

```bash
sudo ss -ltnp | grep -E ':80|:443|:3000|:5432'
sudo nginx -T
docker ps
docker compose ls
```

记录：

1. 当前 Nginx 配置目录和 `server_name`；
2. 当前官网的部署目录、容器名称或进程管理方式；
3. 是否已有证书及证书管理方式；
4. 操作系统版本、磁盘余量、内存余量；
5. 当前备份策略。

**不要**先替换 `/etc/nginx/nginx.conf`、不要停止 Nginx、不要执行会删除 Docker 卷的命令。

### 2.3 推荐最低规格

首期测试环境建议至少：

| 项目 | 建议 |
| --- | --- |
| 系统 | Ubuntu 22.04 LTS 或 24.04 LTS |
| CPU / 内存 | 2 vCPU / 4 GB 起步 |
| 磁盘 | 60 GB SSD 起步，日志和备份另行规划 |
| 数据库 | 优先腾讯云 PostgreSQL 托管实例；低成本测试可用私有 Docker PostgreSQL |
| 备份 | 每日数据库逻辑备份 + 腾讯云快照/托管备份 |
| 网络 | 仅开放 22、80、443；22 仅允许固定办公 IP |

---

## 3. 腾讯云控制台操作

### 3.1 安全组

在 CVM/Lighthouse 对应实例的安全组中配置：

| 方向 | 协议 / 端口 | 来源 | 用途 |
| --- | --- | --- | --- |
| 入站 | TCP 22 | 你的固定公网 IP | SSH 运维 |
| 入站 | TCP 80 | `0.0.0.0/0`、`::/0` | HTTP 到 HTTPS 跳转、证书验证 |
| 入站 | TCP 443 | `0.0.0.0/0`、`::/0` | 官网、API、后台 HTTPS |
| 入站 | TCP 3000 | 不开放 | Fastify 仅本机/容器网络 |
| 入站 | TCP 5432 | 不开放 | PostgreSQL 仅私网 |

若服务器还启用了 UFW，规则应与安全组一致：

```bash
sudo ufw allow from <你的固定公网IP> to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

启用 UFW 前先保持当前 SSH 会话不关闭，并确认 22 端口规则已生效。

### 3.2 DNSPod / 云解析 DNS

在 `evergreenprosper.com` 的解析区域新增：

| 主机记录 | 类型 | 记录值 | TTL |
| --- | --- | --- | --- |
| `api` | A | 腾讯云服务器公网 IPv4 | 600 |
| `admin` | A | 腾讯云服务器公网 IPv4 | 600 |

不修改根记录 `@` 或 `www`，现有官网不会因此变化。

验证解析：

```bash
nslookup api.evergreenprosper.com
nslookup admin.evergreenprosper.com
```

返回的地址必须是预期服务器公网 IP。未生效前不要申请证书或修改 TikTok Portal 配置。

### 3.3 备份与快照

在第一次安装新服务前：

1. 在腾讯云控制台为云硬盘创建快照；
2. 备份现有 Caddyfile 和网站目录；
3. 记录当前运行中的容器镜像版本；
4. 确认数据库备份可恢复。

示例：

```bash
sudo mkdir -p /root/pre-quickreels-backup
sudo cp -a /opt/evergreenprosper-website/Caddyfile /root/pre-quickreels-backup/Caddyfile
sudo docker inspect evergreenprosper-website-web-1 > /root/pre-quickreels-backup/caddy-container-inspect.json
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' | tee /root/pre-quickreels-backup/docker-ps.txt
```

---

## 4. 服务器基础环境

以下以 Ubuntu 为例。现有官网已使用 Docker 和 Caddy，不安装宿主机 Nginx，也不占用 Caddy 已使用的 80/443 端口。

```bash
sudo apt update
sudo apt install -y ca-certificates curl git ufw
node --version
pnpm --version
docker --version
docker compose version
```

项目构建当前使用 Node 24 和 pnpm 11。生产建议使用 Docker 多阶段镜像固定构建环境，不依赖服务器上临时安装的 Node 版本。

建议目录：

```text
/opt/quickreels/
  releases/                 # 每次发布一个不可变目录或 Git commit
  shared/
    api.production.env       # 仅服务器可读，权限 600
    postgres/                # 若采用自建 PostgreSQL
  backups/
  current -> releases/<git-sha>
```

创建并限制密钥文件权限：

```bash
sudo install -d -m 750 -o $USER -g $USER /opt/quickreels/shared
sudo touch /opt/quickreels/shared/api.production.env
sudo chmod 600 /opt/quickreels/shared/api.production.env
```

密钥只写入服务器文件、腾讯云密钥管理系统或 CI Secret；绝不放入 Git、前端 `.env`、Portal ZIP、截图或日志。

---

## 5. 生产环境变量

### 5.1 API 服务端

`/opt/quickreels/shared/api.production.env` 的示意内容：

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3000

DATABASE_URL=postgresql://<app_user>:<long_password>@<private_db_host>:5432/quickreels?schema=public
JWT_SECRET=<至少32位、随机生成的值>

# 不要填 localhost；实际 Mini Preview 的 Origin 需要先通过日志核对后再精确配置。
API_CORS_ORIGIN=<TikTok Preview验证后的必要Origin>,https://admin.evergreenprosper.com
TRUST_GEO_COUNTRY_HEADER=false

TIKTOK_CLIENT_KEY=<Portal Client Key>
TIKTOK_CLIENT_SECRET=<Portal Client Secret>
TIKTOK_OAUTH_TOKEN_URL=https://open.tiktokapis.com/v2/oauth/token/
TIKTOK_USER_INFO_URL=https://open.tiktokapis.com/v2/user/info/?fields=open_id

USER_JWT_EXPIRES_IN=3600
ADMIN_JWT_EXPIRES_IN=28800
```

说明：

- 不在此处写 `VITE_*` 变量；这些会被编译进 Mini 前端。
- 不要使用 `API_CORS_ORIGIN=*` 和携带凭证的跨域组合。
- `TRUST_GEO_COUNTRY_HEADER` 在没有可信 CDN/GeoIP 反向代理覆盖该 Header 前必须保持 `false`。
- 当前项目需要补齐 TikTok OAuth token 的加密保存、refresh 与 revoke 后，才可将 OAuth 标为生产完成。
- 生产管理员不要使用演示 seed 自动创建；应补充独立的管理员初始化/轮换流程。

### 5.2 Mini 前端构建变量

只可放公开配置：

```env
VITE_API_BASE_URL=https://api.evergreenprosper.com/api/v1
VITE_DEMO_MODE=false
VITE_USE_MOCK_API=false
VITE_ENABLE_MOCK_FALLBACK=false
VITE_TIKTOK_CLIENT_KEY=<Portal Client Key>
VITE_REWARDED_AD_UNIT_ID=<Rewarded Placement ID，未获批前不要填生产值>
VITE_INTERSTITIAL_AD_UNIT_ID=<Interstitial Placement ID，功能完成后再填>
```

`TIKTOK_CLIENT_SECRET`、数据库密码、JWT Secret、任何第三方密钥都不能使用 `VITE_` 前缀。

---

## 6. 数据库方案

### 6.1 推荐：腾讯云托管 PostgreSQL

优点：自动备份、私网访问、扩容、监控和恢复更可靠。

要求：

1. 数据库与 CVM 放在可私网访问的网络；
2. 仅允许 CVM/容器所在安全组访问 5432；
3. 创建专用业务用户，不使用超级管理员账号；
4. 开启每日自动备份与恢复演练；
5. 数据库连接串只保存到服务器密钥文件。

### 6.2 低成本测试：服务器私有 Docker PostgreSQL

仅适合 Preview/早期测试。PostgreSQL 容器不使用 `ports: "5432:5432"`，仅加入内部 Docker network，并配置持久化 volume 与异机备份。

当前腾讯云 CVM 的可执行步骤见 [自建 PostgreSQL 部署手册](腾讯云CVM自建PostgreSQL部署步骤.md)。该方案使用独立的 `compose.production.self-hosted.yml`，不会修改现有托管数据库 Compose 文件。

### 6.3 迁移原则

在服务器上的生产 Compose 中，只执行：

```bash
sudo docker compose --env-file .env.production -f compose.production.yml \
  run --rm api ./node_modules/.bin/prisma migrate deploy
```

不要在生产执行 `prisma migrate dev`，不要在未检查内容的情况下执行会写入演示剧集的 seed 脚本。

发布前先备份数据库；迁移失败时停止继续发布并按已验证的恢复流程处理。

---

## 7. Docker 与进程拓扑

目标生产 Compose 至少要有：

```text
api       Fastify HTTP 服务，仅容器网络暴露 3000
worker    独立上传/异步任务进程
postgres  仅当不使用托管数据库时启用
admin     管理后台静态文件服务，或由宿主机 Nginx 直接托管
```

仓库已包含 API、Worker 和后台生产镜像。正式发布前仍须完成独立管理员初始化、日志保留策略、数据库备份和恢复演练；不要将开发模式 `pnpm dev:*` 常驻在公网服务器上。

本仓库现在已补充以下生产部署资产：

```text
compose.production.yml          # API + Worker + Admin，接入外部 quickreels-proxy
.env.production.example         # 生产变量模板，不含真实密钥
apps/admin-web/Dockerfile       # 管理后台生产镜像
apps/admin-web/nginx.conf       # 管理后台 SPA 路由回退
```

这套 Compose 默认连接腾讯云托管 PostgreSQL，因此没有自建数据库服务，也不会发布 5432。API 和 Worker 只加入 `quickreels-proxy`，不发布 3000；Caddy 通过 Docker 服务名 `api`、`admin` 访问它们。

在服务器取得代码后，执行：

```bash
cd /opt/quickreels
cp .env.production.example .env.production
chmod 600 .env.production
# 使用编辑器填写托管 PostgreSQL、TikTok、JWT 和 BytePlus 变量
sudo docker compose --env-file .env.production -f compose.production.yml config
sudo docker compose --env-file .env.production -f compose.production.yml build
sudo docker compose --env-file .env.production -f compose.production.yml up -d
```

`docker compose ... config` 报 `env file not found` 表示尚未创建 `.env.production`；这是预期的安全行为，不要用占位模板直接当生产密钥文件启动。

### 7.1 Caddy 反向代理

当前服务器使用 Caddy，因此应在 `/opt/evergreenprosper-website/Caddyfile` 中保留原官网块，并追加以下两个站点块。Caddy 会自动申请和续期证书；不要在 Caddy 容器外另行申请同一域名证书。

QuicK ReeLS 的 Compose 服务名建议固定为 `api` 和 `admin`，并加入外部网络 `quickreels-proxy`：

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

在 API/后台容器已经启动并加入网络后，先备份并验证 Caddy 配置：

```bash
sudo cp /opt/evergreenprosper-website/Caddyfile /opt/evergreenprosper-website/Caddyfile.bak.$(date +%F-%H%M%S)
sudo docker exec evergreenprosper-website-web-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker exec evergreenprosper-website-web-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker logs --tail=100 evergreenprosper-website-web-1
```

验证网络和公网入口：

```bash
sudo docker network inspect quickreels-proxy --format '{{range .Containers}}{{println .Name}}{{end}}'
curl -I https://evergreenprosper.com
curl -i https://api.evergreenprosper.com/health
curl -I https://admin.evergreenprosper.com
```

如果 Caddy 日志出现 `dial tcp: lookup api` 或 `lookup admin`，说明 QuicK ReeLS 容器尚未加入 `quickreels-proxy`，不要修改 DNS。

### 7.2 TLS 证书

Caddy 在 DNS 已指向本机且 80/443 可访问时，会自动为 `api.evergreenprosper.com` 和 `admin.evergreenprosper.com` 申请并续期证书。不要安装 Certbot，也不要在 Caddy 容器外申请同一子域名证书。通过 Caddy 日志检查签发结果：

```bash
sudo docker logs --tail=150 evergreenprosper-website-web-1
```

---

## 8. 发布流程

### 8.1 测试服务器演练

先在测试子域名上演练，例如：

```text
api-staging.evergreenprosper.com
admin-staging.evergreenprosper.com
```

测试域名也必须有 HTTPS；真正让 TikTok Mini 请求它时，也需登记为 Trusted Domain。

测试清单：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
pnpm --filter mini-web check:minis:local
pnpm --filter mini-web build:minis:prod
pnpm --filter mini-web check:minis:output
pnpm --filter mini-web check:release
```

只有 `check:release` 通过，且构建产物内没有 `localhost`、Mock、测试 Placement 或占位 Client Key，才能上传 Portal Preview。

### 8.2 API / 后台发布顺序

1. 创建数据库备份；
2. 拉取指定 Git commit 或发布包；
3. 检查生产 env 文件权限与变量完整性；
4. 构建 API、后台和 Mini；
5. 执行 `prisma migrate deploy`；
6. 启动或滚动更新 API 和 Worker；
7. 发布后台静态文件；
8. 检查 `https://api.evergreenprosper.com/health`；
9. 用管理员账户验证后台登录、内容查询；
10. 验证现有官网、API、后台三者均可访问；
11. 记录发布 commit、镜像 tag、迁移版本和操作人。

### 8.3 回滚原则

- Caddy 配置：恢复已备份的 Caddyfile 后执行 `caddy reload`；
- API/Worker：切回上一个镜像 tag 或 release directory；
- 数据库：迁移通常不可简单倒退，发布前先备份；发现迁移问题时停止业务写入并按恢复演练操作；
- DNS 和证书不是普通代码发布的一部分，不在故障时随意修改。

---

## 9. TikTok Developer Portal 配置顺序

### 9.1 App 与基础资料

1. 确认当前 App 为 QuicK ReeLS，App ID 为 `7681547859254429717`；
2. 填写名称、图标、简介、目标国家/地区；
3. 填写公开 HTTPS 的隐私政策和服务条款 URL：
   - `https://evergreenprosper.com/quickreels/privacy`
   - `https://evergreenprosper.com/quickreels/terms`
4. 按目标市场完成企业验证和 Mini Drama 行业资质；
5. IAA 上线前确认 Organization 已完成商业验证与广告能力审批。

### 9.1.1 部署官网法律页

在服务器执行以下步骤，将仓库导出的法律页放入现有官网，并让无尾斜杠路径可直接访问。

```bash
cd /opt/quickreels
git pull --ff-only origin main

# 如需重新生成，先确保服务器具备 pnpm 依赖；否则可直接使用仓库中的 deploy/website 目录。
pnpm --filter mini-web export:legal

# 先确认现有官网 Caddyfile 和站点根目录。
sudo sed -n '1,180p' /opt/evergreenprosper-website/Caddyfile

# 默认假设 /opt/evergreenprosper-website 是现有官网静态根目录。
# 如果 Caddyfile 中 root 指向其它宿主机挂载目录，应把下面目标目录替换为那个 root。
sudo mkdir -p /opt/evergreenprosper-website/quickreels
sudo cp -a deploy/website/quickreels/. /opt/evergreenprosper-website/quickreels/
```

编辑 `/opt/evergreenprosper-website/Caddyfile`，在 `evergreenprosper.com` 站点块的最终 `file_server` 之前加入：

```caddy
@quickreelsPrivacy path /quickreels/privacy
rewrite @quickreelsPrivacy /quickreels/privacy/index.html

@quickreelsTerms path /quickreels/terms
rewrite @quickreelsTerms /quickreels/terms/index.html

header /quickreels/* Cache-Control "public, max-age=300"
```

保存后校验并重载 Caddy：

```bash
sudo docker exec evergreenprosper-website-web-1 \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

sudo docker exec evergreenprosper-website-web-1 \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

最后验证 Portal 要填写的两个 URL 不再返回 404：

```bash
curl -IL https://evergreenprosper.com/quickreels/privacy
curl -IL https://evergreenprosper.com/quickreels/terms

curl -L https://evergreenprosper.com/quickreels/privacy | grep -i "QuicK ReeLS Privacy Policy"
curl -L https://evergreenprosper.com/quickreels/terms | grep -i "QuicK ReeLS Terms of Service"
```

预期结果：`curl -IL` 最终状态为 `HTTP/2 200`，页面内容能 grep 到对应标题。正式提交 TikTok 前，隐私政策和服务条款仍需由美国律师或合规人员审阅。

### 9.2 Development configuration

在 Security / Trusted Domains 添加：

```text
https://api.evergreenprosper.com
```

不要填写：

```text
http://api.evergreenprosper.com
https://api.evergreenprosper.com/api/v1
https://*.evergreenprosper.com
```

若以后启用支付、订单或其他 TikTok 事件，在 Webhooks 中配置真实处理端点，例如：

```text
https://api.evergreenprosper.com/webhooks/tiktok
```

但当前仓库没有该处理路由，不能先点击 Portal 的 Test URL。应先实现签名校验、幂等、日志脱敏和失败重试，再在测试环境验证。

### 9.3 Mini 构建与 Preview

1. 用生产公开变量构建 Mini；
2. 运行本地与输出检查；
3. 上传 CLI 生成的代码资产到 Portal；
4. 配置测试用户并生成 Preview QR；
5. 在真实 TikTok 测试设备扫码；
6. 核对 API 访问日志中的 Origin，回填精确 CORS 白名单；
7. 依次验证登录、公开浏览、受限操作、播放器、广告、弱网与前后台切换；
8. 所有 P0 验收通过后才提交审核。

---

## 10. 生产验收清单

### 基础设施

- [ ] 现有官网访问正常，未被新的 Caddy 配置覆盖
- [ ] `api`、`admin` DNS 指向正确服务器
- [ ] 两个子域名均为有效 HTTPS，证书自动续期已测试
- [ ] 安全组和 UFW 不开放 3000、5432
- [ ] 数据库处于私网，备份已启用且测试过恢复
- [ ] API、Worker 配置重启策略与日志轮转

### 应用

- [ ] `https://api.evergreenprosper.com/health` 返回数据库正常
- [ ] 管理后台可登录，普通用户 token 无法访问管理员 API
- [ ] 所有生产环境变量无占位符
- [ ] Mini 构建内无 `localhost`、Mock 开关或密钥
- [ ] API CORS 只允许经 Preview 验证的来源
- [ ] TikTok OAuth 已实现 token 存储、刷新和撤销
- [ ] Rewarded 和 Interstitial 均通过真实设备测试后才开启生产 Placement

### Portal 与合规

- [ ] `https://api.evergreenprosper.com` 已加入 Trusted Domains
- [ ] 隐私政策、服务条款公开可访问且与真实数据中心一致
- [ ] Portal App ID 与 `apps/mini-web/minis.config.json` 一致
- [ ] 目标市场、企业验证、行业资质和广告能力已获批
- [ ] 若覆盖美国/欧盟/英国，已完成 Launch Approval / TPRM / 协议要求
- [ ] 已在 TikTok 真机 Preview 完成登录、播放器、广告和故障路径验收

---

## 11. 当前项目在服务器部署前仍需补齐的工程项

1. 新增生产 Compose、后台静态镜像或可回滚发布脚本；
2. 实现 TikTok OAuth token 的加密持久化、refresh 与 revoke；
3. 实现 Interstitial 广告实际触发与频控；
4. 实现需要时的 TikTok Webhook；
5. 增加 CI：lint、test、build、Mini release check；
6. 接入生产日志、错误告警、监控和数据库备份校验；
7. 建立非演示管理员初始化、密码轮换和最小权限流程；
8. 使用测试子域名完成一次完整发布和回滚演练。

---

## 12. 官方资料

- [TikTok Mini Development Configuration](https://developers.tiktok.com/docs/en/set-up-development-configuration)
- [TikTok Minis Server APIs Overview](https://developers.tiktok.com/docs/en/minis-server-apis-overview)
- [TikTok Mini OAuth](https://developers.tiktok.com/docs/en/minis-oauth)
- [TikTok U.S. and EU/UK Launch Approval Process](https://developers.tiktok.com/docs/en/us-launch-approval-process)
- [Tencent Cloud CVM Documentation](https://www.tencentcloud.com/document/product/213)

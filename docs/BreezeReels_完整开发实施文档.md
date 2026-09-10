# QuicK ReeLS TikTok Mini Drama 完整开发实施文档

**版本：** v1.2  
**本次修订：** 2026-09-08  
**适用应用：** QuicK ReeLS  
**TikTok App ID：** `7668887325719529492`  
**运行形态：** TikTok Minis / Mini Drama（TikTok App 内 WebView）  
**首期变现范围：** In-App Ads（IAA）中的 Rewarded Ads 与 Interstitial Ads  
**不包含：** IAP、订阅、自建视频分发、评论系统、推荐算法

> 本文是工程实施文档，不是 TikTok 或 BytePlus 的实时 API Reference。本文按当前 TikTok Mini Drama + BytePlus 媒资管理 + TikTok Minis VePlayer 的链路编写；TikTok Minis SDK、TikTok Short Drama Open API 路径、地区能力、字段和审核规则在编码及提交前必须以官方当前页面为准。不要将 TikTok Client Secret、BytePlus AccessKey 或 SecretKey 发给任何人，也不要放入前端项目。

---

## 0. 先说结论：你的理解哪里正确，哪里需要修正

你的整体理解是正确的：前端是上传到 TikTok 的 H5 代码资产，后端和数据库部署在公网服务器，前端通过服务器 API 域名获取业务数据。需要修正的是视频播放这一段：**前端不能直接调用 BytePlus API，也不能把 BytePlus 返回的裸 MP4/HLS 地址放进 `<video>` 播放。** Mini Drama 必须接入 TikTok 官方指定的 VePlayer，由 VePlayer 按 TikTok 的审核、上架和账号绑定状态控制播放。

### 0.1 部署后的真实分工

```text
开发完成
  ├─ Mini 前端：pnpm build -> minis build -> ZIP -> 上传 TikTok Developer Portal
  ├─ 后端 API + Worker：部署到公网 HTTPS 服务器
  ├─ PostgreSQL：部署在私有网络或使用托管 PostgreSQL
  └─ BytePlus VOD：存放短剧视频、转码/媒资信息和播放资源

TikTok 内的 Mini H5
  └─ https://api.example.com/api/v1  ──> QuicK ReeLS API
                                      ├─ PostgreSQL（用户、专辑、剧集、进度、解锁）
                                      └─ TikTok Short Drama Open API（服务端调用）
                                             └─ BytePlus VOD（视频实际托管）
```

前端构建时通过 `VITE_API_BASE_URL` 写入 API 地址，例如 `https://api.example.com/api/v1`；同时还要在 TikTok Developer Portal 的 `Trusted domains` 中登记 `https://api.example.com`。这两个配置不是让用户在页面上填写的内容，而是部署/构建配置。

### 0.2 视频从上传到播放的正确理解

| 阶段 | 实际负责方 | QuicK ReeLS 要做什么 |
| --- | --- | --- |
| 上传 | BytePlus VOD + TikTok Short Drama Open API | 运营可先把视频上传到已绑定的 BytePlus 空间；也可让后端通过 TikTok Open API 提供 `sourceUrl`，由平台转存到 BytePlus |
| 媒资信息 | TikTok Open API/BytePlus | 后端轮询任务，保存 `byteplus_vid`、时长、封面等元数据 |
| 专辑/剧集 | TikTok Short Drama Open API | 后端提交标题、简介、封面、集数、顺序和 `byteplus_vid` |
| 审核/上架 | TikTok 平台 | 后端查询审核结果，设置 online version 和上架状态 |
| 首页/详情 | QuicK ReeLS API | 前端只调用自己的 API 获取封面、简介、集数和可观看状态 |
| 播放 | TikTok Minis VePlayer（底层使用 BytePlus 播放能力） | 前端取得 `album_id`、`episode_id`、`vid`，通过 `TTMinis.getPlayer('byteplus')` 播放 |

所以，“视频源是否来自 BytePlus”的答案是：**是，视频媒资最终由已绑定的 BytePlus VOD 空间托管；但用户端不是直接拿 BytePlus 播放 URL，而是使用 TikTok Mini Drama 官方播放器。** 上传方式可以是 BytePlus 控制台/API 直传，也可以是 TikTok Open API 从公开 `sourceUrl` 异步转存，首期建议只选一种并在后台统一封装。

### 0.3 一次完整播放请求

```text
1. 用户点击第 N 集
2. Mini 前端 -> GET /episodes/:episodeId/play（请求 QuicK ReeLS API）
3. QuicK ReeLS API 校验：用户登录、剧集 ONLINE、是否已解锁、平台 ID 是否齐全
4. 后端返回：album_id、episode_id、vid；必要时返回短期 play_auth_token
5. 前端调用 TTMinis.getPlayer('byteplus')
6. VePlayer 使用这些标识连接 BytePlus 播放能力
7. TikTok 平台再次按审核、上架、账号绑定状态执行播放控制
8. 播放进度仍由前端同步回 QuicK ReeLS API 保存
```

`album_id`/`episode_id` 是 TikTok Short Drama 的平台标识，`vid` 是 BytePlus 视频标识；它们与数据库里的本地 `Album.id`/`Episode.id` 不同，必须建立映射。后端可以保存并返回封面和时长，但不应把 `byteplus_url`、AK/SK 或内部上传任务信息返回给用户端。

### 0.4 对当前几个问题的直接回答

| 你的问题 | 结论 |
| --- | --- |
| 完成 Web 项目后上传到 TikTok 吗？ | 是。只上传构建后的 Mini H5 ZIP；后端、数据库、视频文件不放进 ZIP。 |
| 前端填写服务器域名吗？ | 是，以构建环境变量写入 API Base URL，并在 Portal 配置 Trusted domain；用户不需要手填。 |
| 前端请求通过服务器域名到后端吗？ | 是。专辑、封面、简介、集数、解锁状态和播放元信息都先请求 QuicK ReeLS API。 |
| 视频源直接通过 BytePlus 获取吗？ | 视频实际托管在 BytePlus，但前端不直接拿 BytePlus URL；由 VePlayer 按 TikTok 平台标识播放。 |
| 上传短剧后封面/简介/集数怎么来？ | 运营后台提交资料；后端通过 TikTok Short Drama API 写入专辑/剧集，自己的数据库保存业务副本，再提供给前端。 |
| 播放是怎么实现的？ | 后端返回 `album_id`、`episode_id`、`vid`（旧版必要时加临时 `play_auth_token`），前端用 `TTMinis.getPlayer('byteplus')` 创建 VePlayer。 |
| 数据库保存视频文件吗？ | 不保存。数据库只保存平台 ID、封面/时长等元数据、用户进度和解锁记录。 |

### 0.5 最终确认链路（开发时按此实现）

```text
内容生产/运营
  -> 将视频放入已绑定的 BytePlus 账号和同一 Space
     （可由运营直传 BytePlus，也可由后端用 TikTok Short Drama Open API 转存）
  -> 得到 BytePlus vid
  -> 后端调用 TikTok Short Drama API 写入 album/episode、封面、集数和 vid
  -> 提交审核 -> 设置 online version -> Listed
  -> 后端把线上内容和元数据同步到 quickreels 数据库

TikTok 用户
  -> 打开 QuicK ReeLS Mini H5（TikTok ZIP 代码资产）
  -> TTMinis.login() -> QuicK ReeLS API 建立业务会话
  -> QuicK ReeLS API 返回封面/简介/集数/解锁状态
  -> 用户点击剧集
  -> QuicK ReeLS API 校验权限和平台状态
  -> 返回 album_id、episode_id、vid（旧版需要时返回短期 play_auth_token）
  -> TTMinis.getPlayer('byteplus') 创建官方 VePlayer
  -> VePlayer 按 TikTok 播放控制从 BytePlus 获取视频流
  -> 前端把播放进度同步回 QuicK ReeLS API，数据库保存进度
```

**边界必须保持不变：** Mini 前端只请求 QuicK ReeLS API 和 TikTok Minis SDK；不直接调用 BytePlus 管理 API，不接触 BytePlus AK/SK，不播放裸 MP4/HLS；QuicK ReeLS API 也不代理整段视频流，只负责业务鉴权、元数据和必要的临时播放凭证。

---

## 1. 最终架构

TikTok Mini Drama 是标准 H5 Web 应用，不是传统小程序。前端代码被构建、校验并上传为 TikTok Portal 的 ZIP 代码资产；后端和数据库仍需要部署在自己的公网 HTTPS 环境。

```text
┌──────────────────────────────────────────────────────────────┐
│ TikTok App                                                    │
│  └─ WebView                                                    │
│      └─ QuicK ReeLS Mini H5（TikTok Portal 的 ZIP 代码资产）   │
│          ├─ React 页面                                         │
│          ├─ window.TTMinis：登录、广告、VePlayer 获取           │
│          ├─ VePlayer：按 album_id/episode_id/vid 播放           │
│          └─ HTTPS 请求                                         │
└───────────────────────────────────┬──────────────────────────┘
                                    │ https://api.example.com
                                    ▼
┌──────────────────────────────────────────────────────────────┐
│ QuicK ReeLS API（Node.js + Fastify + TypeScript）              │
│  ├─ TikTok 登录 code 交换和业务会话                             │
│  ├─ 专辑、剧集、观看进度和广告解锁                              │
│  ├─ 运营后台接口                                                │
│  ├─ TikTok Short Drama Open API：上传、审核、上架、播放凭证     │
│  └─ 日志、限流、权限与健康检查                                  │
└───────────────┬──────────────────────────────┬───────────────┘
                │                              │
                ▼                              ▼
      PostgreSQL 数据库                   TikTok / BytePlus 媒资能力
      用户/剧集/进度/记录                 审核、上架控制 / 视频托管与传输
```

### 1.1 三类资产必须分开

| 资产 | 存放位置 | 作用 | 绝不能包含 |
| --- | --- | --- | --- |
| Mini 前端代码资产 | TikTok Portal 的 Code version ZIP | 运行页面、调用 TTMinis、请求后端 | AK/SK、Client Secret、数据库密码、视频文件 |
| 后端服务 | 公网 HTTPS 服务器 | 业务逻辑、业务会话、数据库访问、调用 TikTok Short Drama Open API | 前端私有构建依赖无需部署给用户 |
| 视频媒资 | BytePlus VOD / Media Asset Management | 视频托管、转码和传输；TikTok 负责短剧审核、上架和播放控制 | 前端 ZIP 不保存全集视频 |

### 1.2 建议生产域名

```text
API：          https://api.example.com
运营后台：     https://admin.example.com
法律页面：     https://www.example.com/privacy
               https://www.example.com/terms
Webhook：      https://api.example.com/webhooks/tiktok
```

TikTok Portal 中：

- `Service domains`：填写法律页面所属的域名，例如 `https://www.example.com`。
- `Trusted domains`：填写 Mini 前端实际请求的 API 域名，例如 `https://api.example.com`。不填路径、不用通配符、必须 HTTPS。
- `Webhook URL`：TikTok 向你的后端发通知的地址，与前端请求白名单不是一回事。

BytePlus 账号还必须在同一个 TikTok App 的 `Industry solutions -> Media asset management` 中完成绑定；绑定后，该 App 的 TikTok Short Drama Open API 才能使用对应 BytePlus 账号/空间的短剧媒资。单部短剧的全部剧集必须属于同一个 BytePlus 账号和空间。

---

## 2. 技术选型

TypeScript 和 Node.js 并不冲突：TypeScript 是编写代码的语言，Node.js 是运行后端 JavaScript 的环境。

| 层级 | 技术 | 选择理由 |
| --- | --- | --- |
| 包管理/单仓库 | pnpm workspace | 一个仓库管理前端、后端和共享类型 |
| Mini 前端 | React + Vite + TypeScript | 标准 H5、构建速度快、适合 TikTok WebView |
| 前端路由 | React Router | 首页、详情、播放页路由清晰 |
| 前端请求与缓存 | TanStack Query | 自动处理加载、错误、缓存与重试 |
| 前端状态 | Zustand | 管理登录态、播放器与 UI 状态，简单轻量 |
| 前端样式 | CSS Modules | 没有额外运行时依赖，样式可控 |
| 后端 | Node.js LTS + Fastify + TypeScript | 高性能、插件结构清晰、前后端统一语言 |
| API 校验 | Zod | 入参、环境变量和接口响应可校验 |
| 数据库 | PostgreSQL | 事务、索引、关系查询适合内容和用户数据 |
| ORM | Prisma | 数据迁移和类型安全更易维护 |
| 异步任务 | 数据库任务表 + Node worker | 首期足够处理 TikTok Short Drama 上传/状态轮询，不必上复杂队列 |
| 部署 | Docker Compose + Nginx | 可重复部署，适合第一版 |
| 日志 | Pino（Fastify 内置生态） | 结构化日志，便于排障 |

### 2.1 第一版不建议使用

```text
微服务架构
Kubernetes
Redis 集群
Kafka/RabbitMQ 集群
复杂 DDD 分层
自建视频 CDN、裸 MP4/HLS 或原生 `<video>` 播放链路（Mini Drama 不允许）
```

先用一个 API 服务、一个 Worker 进程、一个 PostgreSQL 数据库跑通「上传视频 -> 上架 -> 看剧 -> 看广告解锁」闭环。流量增长后再拆分。

---

## 3. 功能范围与产品规则

### 3.1 用户端 MVP

1. 静默 TikTok 登录。
2. 短剧专辑列表。
3. 专辑详情与剧集目录。
4. 官方 Mini Drama 播放方式播放已上线剧集。
5. 观看进度保存与续播。
6. 免费剧集直接播放。
7. 锁定剧集通过完整观看激励广告解锁。
8. 在合适的章节过渡点展示插屏广告。
9. 网络、广告和播放失败的降级提示。

### 3.2 广告规则

| 广告类型 | 业务目的 | 推荐触发点 | 禁止/不建议触发点 |
| --- | --- | --- | --- |
| Rewarded Ads | 解锁一集或获得明确奖励 | 用户主动点击“看广告解锁第 N 集” | 自动弹出、未完整看完即解锁 |
| Interstitial Ads | 章节或页面过渡变现 | 第 N 集播完后，用户确认进入下一集前 | 首次打开 App、首次打开短剧、播放过程中、高频连续弹出 |

业务频控建议：

```text
插屏：每看完 2 集最多 1 次
插屏：两次展示间隔至少 8 分钟
插屏：单次会话最多 3 次
广告加载/展示失败：继续用户原来的观看流程
激励：同一集解锁后永久标记为已解锁
```

### 3.3 TikTok 平台前置条件

1. 企业认证和 Mini Drama 行业资质审核完成。
2. Basic Information 已填写：名称、图标、描述、隐私政策、服务条款、服务域名等。
3. Organization 的 IAA 能力已申请、签约并获批。
4. App 的 Monetization 页面中已创建并启用：
   - 一个 `Rewarded ad` Placement。
   - 一个 `Interstitial ad` Placement。
5. 保存两个 `Placement ID`，供前端使用。
6. 已配置所有 Trusted domains。

IAA 要求 TikTok App 版本不低于 `44.2.0`；必须先调用 `TTMinis.canIUse()` 做能力检测。TikTok Pro Android 当前不支持短剧 IAA，需要降级处理。

---

## 4. 仓库和目录结构

建立单仓库 `quickreels`：

```text
quickreels/
├── apps/
│   ├── mini-web/                           # 上传 TikTok 的 Mini H5 前端
│   │   ├── public/
│   │   │   ├── icons/
│   │   │   └── fallback-cover.webp
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── App.tsx
│   │   │   │   ├── router.tsx
│   │   │   │   └── providers.tsx
│   │   │   ├── components/
│   │   │   │   ├── AlbumCard.tsx
│   │   │   │   ├── EpisodeList.tsx
│   │   │   │   ├── PlayerShell.tsx
│   │   │   │   └── LoadingState.tsx
│   │   │   ├── features/
│   │   │   │   ├── auth/
│   │   │   │   ├── ads/
│   │   │   │   ├── albums/
│   │   │   │   ├── episodes/
│   │   │   │   └── watch-progress/
│   │   │   ├── pages/
│   │   │   │   ├── HomePage.tsx
│   │   │   │   ├── AlbumPage.tsx
│   │   │   │   ├── WatchPage.tsx
│   │   │   │   ├── PrivacyPage.tsx
│   │   │   │   └── TermsPage.tsx
│   │   │   ├── lib/
│   │   │   │   ├── api-client.ts
│   │   │   │   ├── ttminis.ts
│   │   │   │   └── format.ts
│   │   │   ├── styles/
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── minis.config.json
│   │   ├── vite.config.ts
│   │   ├── package.json
│   │   └── .env.example
│   │
│   ├── api/                                # 业务 API 与第三方服务调用
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   ├── config/
│   │   │   │   └── env.ts
│   │   │   ├── plugins/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── prisma.ts
│   │   │   │   └── error-handler.ts
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── albums/
│   │   │   │   ├── episodes/
│   │   │   │   ├── progress/
│   │   │   │   ├── ads/
│   │   │   │   ├── admin/
│   │   │   │   └── media-assets/
│   │   │   ├── services/
│   │   │   │   ├── tiktok-oauth.service.ts
│   │   │   │   ├── tiktok-short-drama.service.ts
│   │   │   │   └── token.service.ts
│   │   │   └── jobs/
│   │   │       └── tiktok-short-drama.worker.ts
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── seed.ts
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── .env.example
│   │
│   └── admin-web/                          # 独立运营后台，不上传 TikTok ZIP
│       ├── src/
│       ├── package.json
│       └── vite.config.ts
│
├── packages/
│   └── shared-types/                       # 前后端共享的 DTO 和枚举
│       ├── src/
│       │   ├── album.ts
│       │   ├── episode.ts
│       │   ├── api.ts
│       │   └── index.ts
│       └── package.json
│
├── infra/
│   ├── nginx/
│   │   └── default.conf
│   └── docker-compose.production.yml
├── docs/
│   ├── api-openapi.yaml
│   └── runbook.md
├── package.json
├── pnpm-workspace.yaml
├── docker-compose.yml
├── .gitignore
└── README.md
```

### 4.1 为什么运营后台独立

运营后台会处理视频文件、审核、上架、下线和管理员权限。它不属于普通 TikTok 用户的 Mini 前端，放入代码资产 ZIP 会扩大攻击面、增大包体积，也会让审核边界混乱。

---

## 5. 本地开发环境

### 5.1 安装软件

```text
Node.js：当前 LTS 版本
pnpm：9 或更高
Docker Desktop：用于本地 PostgreSQL
Git
TikTok App 测试环境（按官方调试要求）
TikTok Minis CLI
```

检查版本：

```bash
node -v
corepack enable
pnpm -v
docker --version
```

安装 Minis CLI：

```bash
npm install tiktok-minis-cli -g --registry=https://registry.npmjs.org
minis -v
```

### 5.2 创建工作区

在 PowerShell 中执行：

```powershell
mkdir quickreels
cd quickreels
pnpm init
```

根目录 `pnpm-workspace.yaml`：

```yaml
packages:
  - apps/*
  - packages/*
```

根目录 `package.json` 推荐脚本：

```json
{
  "name": "quickreels",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "dev:mini": "pnpm --filter mini-web dev",
    "dev:api": "pnpm --filter api dev",
    "dev:admin": "pnpm --filter admin-web dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test"
  }
}
```

### 5.3 创建前端项目

```bash
pnpm create vite apps/mini-web --template react-ts
pnpm --dir apps/mini-web add react-router-dom @tanstack/react-query zustand zod
pnpm --dir apps/mini-web add -D @types/node
```

### 5.4 创建后端项目

```bash
mkdir apps/api
cd apps/api
pnpm init
pnpm add fastify @fastify/cors @fastify/jwt @fastify/rate-limit zod dotenv pino-pretty
pnpm add @prisma/client
pnpm add -D typescript tsx prisma @types/node
pnpm prisma init
```

建议的 API 脚本：

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:seed": "tsx prisma/seed.ts",
    "worker": "tsx src/jobs/tiktok-short-drama.worker.ts"
  }
}
```

### 5.5 启动本地 PostgreSQL

根目录 `docker-compose.yml`：

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: quickreels
      POSTGRES_USER: quickreels
      POSTGRES_PASSWORD: change-this-local-password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

启动：

```bash
docker compose up -d postgres
pnpm --dir apps/api db:migrate --name init
pnpm --dir apps/api db:generate
pnpm --dir apps/api db:seed
```

---

## 6. 环境变量与密钥管理

### 6.1 Mini 前端 `.env.example`

```env
VITE_API_BASE_URL=https://api.example.com/api/v1
VITE_TIKTOK_CLIENT_KEY=your_tiktok_client_key
VITE_REWARDED_AD_UNIT_ID=your_rewarded_placement_id
VITE_INTERSTITIAL_AD_UNIT_ID=your_interstitial_placement_id
```

这些值会出现在构建后的浏览器代码中，因此只能包含可公开标识：`Client Key` 和广告 `Placement ID`。不把 Secret 放在 `VITE_` 变量中。

### 6.2 API `.env.example`

```env
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgresql://quickreels:change-this-local-password@localhost:5432/quickreels?schema=public

API_CORS_ORIGIN=http://localhost:5173
JWT_SECRET=replace-with-a-long-random-secret

TIKTOK_CLIENT_KEY=your_tiktok_client_key
TIKTOK_CLIENT_SECRET=never-expose-this-value

# 已在 Developer Portal 绑定并授权给此 App 的 BytePlus 媒资空间
BYTEPLUS_ACCOUNT_ID=your_bound_byteplus_account_id
BYTEPLUS_SPACE_NAME=your_bound_vod_space_name
BYTEPLUS_REGION=ap-southeast-1

# 只有在另行使用 BytePlus VOD 直连 API 时才配置；Mini Drama Open API 默认不需要
# BYTEPLUS_ACCESS_KEY=never-expose-this-value
# BYTEPLUS_SECRET_KEY=never-expose-this-value
```

### 6.3 必须遵守的规则

```text
.env 永远不提交 Git
生产密钥使用服务器环境变量或密钥管理服务
BytePlus AK/SK 通过 TikTok Developer Portal 的 Media asset management 绑定流程管理；不把它们放入 Mini 前端，也不要为了短剧 Open API 在应用服务器中复制一份
日志不可输出 Authorization、code、access_token、AK、SK
配置错误时只显示变量名，不显示变量值
泄漏后的密钥必须立即在平台轮换
```

`.gitignore` 至少包含：

```gitignore
node_modules/
dist/
.env
.env.*
!.env.example
coverage/
*.log
```

---

## 7. 数据库设计

### 7.1 核心实体关系

```text
User 1 ── * WatchProgress * ── 1 Episode * ── 1 Album
User 1 ── * EpisodeUnlock * ── 1 Episode
User 1 ── * AdEvent
Album 1 ── * Episode
Episode 1 ── * UploadJob
AdminUser 1 ── * AuditLog
```

### 7.2 Prisma Schema（可作为初始版本）

`apps/api/prisma/schema.prisma`：

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum AlbumStatus {
  DRAFT
  REVIEWING
  ONLINE
  OFFLINE
  REJECTED
}

enum EpisodeStatus {
  DRAFT
  UPLOADING
  READY
  REVIEWING
  ONLINE
  OFFLINE
  ERROR
}

enum UnlockType {
  FREE
  REWARDED_AD
  ADMIN_GRANT
}

enum UploadStatus {
  PENDING
  PROCESSING
  SUCCEEDED
  FAILED
}

enum AdType {
  REWARDED
  INTERSTITIAL
}

enum AdEventType {
  REQUESTED
  SHOWN
  CLOSED_COMPLETED
  CLOSED_INCOMPLETE
  FAILED
}

model User {
  id              String          @id @default(cuid())
  tiktokOpenId    String          @unique
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  watchProgresses WatchProgress[]
  episodeUnlocks  EpisodeUnlock[]
  adEvents        AdEvent[]
}

model Album {
  id            String       @id @default(cuid())
  tiktokAlbumId String?      @unique
  tiktokVersion Int?
  onlineVersion Int?
  reviewStatus  String?
  publishStatus String?
  title         String
  description   String       @db.Text
  coverUrl      String
  language      String       @default("en")
  regions       Json?
  status        AlbumStatus  @default(DRAFT)
  episodes      Episode[]
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  @@index([status, updatedAt])
}

model Episode {
  id              String        @id @default(cuid())
  albumId         String
  tiktokEpisodeId String?       @unique
  byteplusVid     String?       @unique
  tiktokCoverPicId String?
  byteplusCoverUrl String?
  episodeNo       Int
  title           String
  description     String?       @db.Text
  coverUrl        String?
  durationMs      Int?
  isFree          Boolean       @default(false)
  sortOrder       Int
  status          EpisodeStatus @default(DRAFT)
  album           Album         @relation(fields: [albumId], references: [id], onDelete: Cascade)
  uploadJobs      UploadJob[]
  watchProgresses WatchProgress[]
  unlocks         EpisodeUnlock[]
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@unique([albumId, episodeNo])
  @@index([albumId, status, sortOrder])
}

model WatchProgress {
  id         String   @id @default(cuid())
  userId     String
  episodeId  String
  positionMs Int      @default(0)
  durationMs Int?
  completed  Boolean  @default(false)
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  episode    Episode  @relation(fields: [episodeId], references: [id], onDelete: Cascade)

  @@unique([userId, episodeId])
  @@index([userId, updatedAt])
}

model EpisodeUnlock {
  id          String     @id @default(cuid())
  userId      String
  episodeId   String
  unlockType  UnlockType
  placementId String?
  unlockedAt  DateTime   @default(now())
  user        User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  episode     Episode    @relation(fields: [episodeId], references: [id], onDelete: Cascade)

  @@unique([userId, episodeId])
  @@index([episodeId, unlockedAt])
}

model AdEvent {
  id          String      @id @default(cuid())
  userId      String
  adType      AdType
  eventType   AdEventType
  placementId String
  episodeId   String?
  sessionId   String?
  errorCode   String?
  createdAt   DateTime    @default(now())
  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, adType, createdAt])
  @@index([placementId, eventType, createdAt])
}

model UploadJob {
  id            String       @id @default(cuid())
  episodeId     String
  providerJobId String?      @unique
  sourceUrl     String
  sourceExpiresAt DateTime?
  status        UploadStatus @default(PENDING)
  errorMessage  String?
  retryCount    Int          @default(0)
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime     @default(now())
  episode       Episode      @relation(fields: [episodeId], references: [id], onDelete: Cascade)

  @@index([status, createdAt])
}

model AdminUser {
  id           String     @id @default(cuid())
  email        String     @unique
  passwordHash String
  role         String     @default("EDITOR")
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  auditLogs    AuditLog[]
}

model AuditLog {
  id          String    @id @default(cuid())
  adminUserId String
  action      String
  resource    String
  resourceId  String?
  metadata    Json?
  createdAt   DateTime  @default(now())
  adminUser   AdminUser @relation(fields: [adminUserId], references: [id], onDelete: Cascade)

  @@index([resource, resourceId, createdAt])
}
```

### 7.3 数据规则

1. 只向用户端返回 `ONLINE` 专辑和剧集。
2. `EpisodeUnlock` 的 `(userId, episodeId)` 唯一，确保广告重复回调也只能解锁一次。
3. 更新 `WatchProgress.positionMs` 时做边界校验：`0 <= positionMs <= durationMs`。
4. 不允许通过删除数据库记录替代内容下线，使用 `OFFLINE` 状态保留审计轨迹。
5. `AdEvent` 是分析和风控记录，不作为“广告真实结算”的唯一依据。

---

## 8. API 设计

### 8.1 通用约定

```text
Base URL：https://api.example.com/api/v1
格式：JSON
认证：Authorization: Bearer <business-session-token>
时间：ISO 8601，例如 2026-09-08T10:00:00.000Z
ID：字符串（cuid/平台 ID），前端不可假定为数字
```

统一错误响应：

```json
{
  "error": {
    "code": "EPISODE_LOCKED",
    "message": "Watch a rewarded ad to unlock this episode.",
    "requestId": "req_123"
  }
}
```

常用错误码：

| HTTP | code | 说明 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 请求字段不合法 |
| 401 | `UNAUTHORIZED` | 登录态缺失或失效 |
| 403 | `FORBIDDEN` | 无权限或地区不可访问 |
| 404 | `NOT_FOUND` | 资源不存在 |
| 409 | `CONFLICT` | 状态冲突或重复操作 |
| 429 | `RATE_LIMITED` | 请求过于频繁 |
| 500 | `INTERNAL_ERROR` | 内部错误，不能泄漏密钥 |

### 8.2 用户端接口

| 方法 | 路径 | 认证 | 作用 |
| --- | --- | --- | --- |
| `POST` | `/auth/tiktok/login` | 否 | 交换 TikTok login code，创建业务会话 |
| `GET` | `/me` | 是 | 当前用户资料与会话信息 |
| `GET` | `/albums` | 可选 | 线上专辑列表，支持分页 |
| `GET` | `/albums/:albumId` | 可选 | 专辑详情 |
| `GET` | `/albums/:albumId/episodes` | 可选 | 剧集目录及用户解锁状态 |
| `GET` | `/episodes/:episodeId/play` | 是 | 校验权限并获取 VePlayer 播放元信息 |
| `PUT` | `/me/watch-progress` | 是 | 保存观看进度 |
| `GET` | `/me/watch-progress` | 是 | 获取最近观看记录 |
| `POST` | `/episodes/:episodeId/reward-unlock` | 是 | 在前端确认完整看完广告后，幂等解锁剧集 |
| `POST` | `/ad-events` | 是 | 记录广告请求、展示、关闭、失败事件 |

#### `POST /auth/tiktok/login`

请求：

```json
{
  "code": "code_from_TTMinis_login"
}
```

后端行为：

```text
校验 code 格式
-> 调用 TikTok OAuth token API（后端）
-> 获取/更新 open_id 对应用户
-> 签发短期 QuicK ReeLS session token
-> 返回业务会话
```

成功响应：

```json
{
  "accessToken": "business_session_token",
  "expiresIn": 3600,
  "user": {
    "id": "usr_abc"
  }
}
```

#### `GET /albums`

查询参数：

```text
cursor=<optional>
limit=20
```

响应：

```json
{
  "items": [
    {
      "id": "alb_001",
      "title": "The Last Summer",
      "description": "...",
      "coverUrl": "https://...",
      "episodeCount": 60,
      "updatedAt": "2026-09-08T10:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

#### `GET /albums/:albumId/episodes`

响应必须根据当前用户返回可观看状态：

```json
{
  "items": [
    {
      "id": "ep_001",
      "episodeNo": 1,
      "title": "Episode 1",
      "durationMs": 90000,
      "isFree": true,
      "access": "PLAYABLE"
    },
    {
      "id": "ep_003",
      "episodeNo": 3,
      "title": "Episode 3",
      "durationMs": 86000,
      "isFree": false,
      "access": "REWARDED_AD_REQUIRED"
    }
  ]
}
```

#### `GET /episodes/:episodeId/play`

规则：

- 免费或已解锁时返回官方 VePlayer 需要的 TikTok 专辑/剧集标识和 BytePlus `vid`。
- TikTok 旧版客户端（官方文档注明低于 `44.5.0` 的兼容场景）需要短期 `play_auth_token` 时，由后端服务端调用对应的 TikTok 播放凭证接口后再返回；只在确认即将播放时获取，不做长期缓存。
- 未解锁时返回 `403 EPISODE_LOCKED`。
- 不返回裸 MP4/HLS 播放地址、BytePlus AK/SK、后台上传 URL 或 TikTok 服务端 access token。

示例响应：

```json
{
  "albumId": "tiktok_album_id",
  "episodeId": "tiktok_episode_id",
  "vid": "byteplus_vid",
  "playAuthToken": "short_lived_token_or_null",
  "title": "Episode 3",
  "coverUrl": "https://...",
  "durationMs": 86000,
  "resumePositionMs": 24000
}
```

`albumId`、`episodeId`、`vid` 是播放专用的第三方平台标识，不是本地数据库主键。前端把它们交给 VePlayer；`playAuthToken` 只作为旧版客户端兼容字段，不能当作登录 token 或业务解锁凭证。

#### `PUT /me/watch-progress`

请求：

```json
{
  "episodeId": "ep_003",
  "positionMs": 24000,
  "durationMs": 86000,
  "completed": false
}
```

前端建议在以下时机调用：每 15 秒、暂停、切换剧集、页面隐藏、播放器结束。后端应限流，并只保存有意义的进度变化。

#### `POST /episodes/:episodeId/reward-unlock`

请求：

```json
{
  "placementId": "rewarded_ad_placement_id",
  "clientEventId": "uuid-generated-on-client"
}
```

后端规则：

```text
验证用户、剧集和剧集线上状态
-> 若免费或已解锁，直接成功返回（幂等）
-> 创建 EpisodeUnlock(REWARDED_AD)
-> 写入 AdEvent(CLOSED_COMPLETED)
-> 返回 PLAYABLE
```

> TikTok 文档允许前端在 `onClose` 回调的 `isEnded === true` 后发奖并同步后端记录。除非官方另行提供可验证的服务端回调或签名，不要对外宣称后端能独立验证广告完整播放。

### 8.3 运营后台接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/admin/auth/login` | 管理员登录 |
| `GET` | `/admin/albums` | 专辑列表与审核状态 |
| `POST` | `/admin/albums` | 创建专辑草稿 |
| `PATCH` | `/admin/albums/:albumId` | 编辑专辑 |
| `POST` | `/admin/episodes` | 创建剧集草稿 |
| `PATCH` | `/admin/episodes/:episodeId` | 编辑剧集与排序 |
| `POST` | `/admin/upload-jobs` | 创建 TikTok Short Drama -> BytePlus 异步上传任务 |
| `GET` | `/admin/upload-jobs/:jobId` | 查询任务进度 |
| `POST` | `/admin/albums/:albumId/review-submit` | 提交短剧内容审核 |
| `POST` | `/admin/albums/:albumId/online` | 设置线上版本/上架 |
| `POST` | `/admin/albums/:albumId/offline` | 下架，保留数据 |

所有 `/admin/*` 路由需要独立的管理员认证和审计日志。普通 TikTok 用户 token 不可访问。

### 8.4 健康检查

```text
GET /health
```

响应：

```json
{
  "status": "ok",
  "database": "ok",
  "timestamp": "2026-09-08T10:00:00.000Z"
}
```

---

## 9. 前端实现

### 9.1 `index.html` 初始化 TikTok Minis SDK

`apps/mini-web/index.html`：

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>QuicK ReeLS</title>

    <script src="https://connect.tiktok-minis.com/drama/sdk.js"></script>
    <script>
      window.TTMinis?.init({
        clientKey: '%VITE_TIKTOK_CLIENT_KEY%'
      });
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

> 实际 Vite 环境变量是否可在内联脚本中直接替换，需在本地构建验证。若不支持，在 `main.tsx` 中读取 `import.meta.env.VITE_TIKTOK_CLIENT_KEY` 并在 React 启动前调用 `TTMinis.init()`。无论哪种写法，都必须在调用登录和广告 API 前完成初始化。

### 9.2 TypeScript 类型声明

`apps/mini-web/src/types/ttminis.d.ts`：

```ts
declare global {
    interface Window {
    TTMinis?: {
      init(options: { clientKey: string }): void;
      login(): Promise<{ code: string }>;
      canIUse(apiName: string): boolean;
      getPlayer(channel?: 'byteplus' | 'volcengine'): Promise<VePlayerConstructor>;
      createRewardedVideoAd(options: { adUnitId: string }): RewardedVideoAd;
      createInterstitialAd(options: { adUnitId: string }): InterstitialAd;
    };
  }
}

interface VePlayerConstructor {
  new (options: {
    id?: string;
    root?: HTMLElement;
    vid: string;
    albumId: string;
    episodeId: string;
    lang?: string;
    defaultDefinition?: string;
    getVideoByToken?: { playAuthToken?: string | null; needPoster?: boolean };
  }): VePlayerInstance;
}

interface VePlayerInstance {
  player?: {
    currentTime: number;
    paused: boolean;
    ended: boolean;
    play(): Promise<void> | void;
    pause(): void;
  };
  on(event: string, callback: (data?: unknown) => void): void;
  destroy(): void;
  playNext?(options: Record<string, unknown>): Promise<void>;
}

interface RewardedVideoAd {
  show(): Promise<void>;
  onClose(callback: (result: { isEnded: boolean }) => void): void;
  offClose(callback: (result: { isEnded: boolean }) => void): void;
  onError(callback: (error: unknown) => void): void;
  offError(callback: (error: unknown) => void): void;
}

interface InterstitialAd {
  show(): Promise<void>;
  onClose(callback: () => void): void;
  offClose(callback: () => void): void;
  onError(callback: (error: unknown) => void): void;
  offError(callback: (error: unknown) => void): void;
}

export {};
```

这只是首期类型声明。提交前应以当前 SDK API Reference 对照参数、事件和返回字段。

### 9.3 TikTok 静默登录

`apps/mini-web/src/features/auth/login.ts`：

```ts
import { apiClient } from '../../lib/api-client';

export async function loginWithTikTok(): Promise<void> {
  const minis = window.TTMinis;

  if (!minis) {
    throw new Error('TikTok Minis SDK is unavailable. Open this page in TikTok.');
  }

  const { code } = await minis.login();
  const response = await apiClient.post('/auth/tiktok/login', { code });

  sessionStorage.setItem('quickreels_access_token', response.accessToken);
}
```

前端只把 `code` 交给后端。后端使用 `TIKTOK_CLIENT_SECRET` 调 OAuth API；该 Secret 永远不能进入前端。

### 9.4 激励广告实现

`apps/mini-web/src/features/ads/rewarded-ad.ts`：

```ts
import { apiClient } from '../../lib/api-client';

const rewardedPlacementId = import.meta.env.VITE_REWARDED_AD_UNIT_ID;

export async function unlockEpisodeByRewardedAd(episodeId: string): Promise<void> {
  const minis = window.TTMinis;

  if (!minis?.canIUse('createRewardedVideoAd')) {
    throw new Error('Rewarded ads are not supported by this TikTok version.');
  }

  // TikTok 建议每次展示前创建新的广告实例。
  const ad = minis.createRewardedVideoAd({ adUnitId: rewardedPlacementId });

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      ad.offClose(onClose);
      ad.offError(onError);
    };

    const onClose = async (result: { isEnded: boolean }) => {
      cleanup();

      if (!result.isEnded) {
        reject(new Error('The ad was not completed. The episode remains locked.'));
        return;
      }

      try {
        await apiClient.post(`/episodes/${episodeId}/reward-unlock`, {
          placementId: rewardedPlacementId,
          clientEventId: crypto.randomUUID()
        });
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    const onError = (error: unknown) => {
      cleanup();
      reject(error);
    };

    ad.onClose(onClose);
    ad.onError(onError);
    ad.show().catch(onError);
  });
}
```

关键规则：

1. 调用前必须 `canIUse('createRewardedVideoAd')`。
2. 每次展示创建一个新实例。
3. **仅当** `onClose` 返回 `isEnded === true` 才能解锁。
4. 用户中途关闭、拉取素材失败、播放失败都不能解锁。
5. 解锁接口必须幂等，网络重试也不应导致重复数据。

### 9.5 插屏广告实现

`apps/mini-web/src/features/ads/interstitial-ad.ts`：

```ts
const interstitialPlacementId = import.meta.env.VITE_INTERSTITIAL_AD_UNIT_ID;

export async function showInterstitialThenContinue(
  onContinue: () => Promise<void> | void
): Promise<void> {
  const minis = window.TTMinis;

  if (!minis?.canIUse('createInterstitialAd')) {
    await onContinue();
    return;
  }

  const ad = minis.createInterstitialAd({ adUnitId: interstitialPlacementId });

  await new Promise<void>((resolve) => {
    let completed = false;

    const continueOnce = async () => {
      if (completed) return;
      completed = true;
      ad.offClose(onClose);
      ad.offError(onError);
      await onContinue();
      resolve();
    };

    const onClose = () => void continueOnce();
    const onError = () => void continueOnce();

    ad.onClose(onClose);
    ad.onError(onError);
    ad.show().catch(onError);
  });
}
```

关键规则：

1. 插屏没有“完成后发奖励”语义。
2. 广告关闭后继续播放下一集。
3. 广告失败也必须继续播放下一集，不能卡住用户。
4. 用前端和后端的频控数据避免频繁弹出。
5. 每次展示重新创建实例。

### 9.6 VePlayer 播放实现

Mini Drama 播放必须使用 TikTok Minis 官方 VePlayer。TikTok 官方文档明确禁止第三方播放器和原生 HTML `<video>` 播放短剧；否则可能被替换为不可播放的拦截界面。

`apps/mini-web/src/features/player/create-player.ts`：

```ts
type PlayInfo = {
  albumId: string;
  episodeId: string;
  vid: string;
  playAuthToken?: string | null;
};

export async function createDramaPlayer(
  root: HTMLElement,
  info: PlayInfo,
) {
  const minis = window.TTMinis;
  if (!minis) throw new Error('TikTok Minis SDK is unavailable.');

  // 官方播放器通过 TTMinis.getPlayer 获取，不要 import 一个普通 Web 播放器。
  const VePlayer = await minis.getPlayer('byteplus');
  const player = new VePlayer({
    root,
    vid: info.vid,
    albumId: info.albumId,
    episodeId: info.episodeId,
    lang: 'en',
    getVideoByToken: {
      // 新版客户端通常可由平台按 vid 处理；旧版兼容时使用短期 token。
      playAuthToken: info.playAuthToken ?? undefined,
      needPoster: true,
    },
  });

  player.on('timeupdate', (data) => {
    // 按实际 VePlayer.Events.TIME_UPDATE 常量/事件名适配。
    const currentTime = (data as { currentTime?: number } | undefined)?.currentTime;
    if (typeof currentTime === 'number') void currentTime;
  });

  return player;
}
```

React 页面必须在卸载时销毁实例，并保证一个容器只对应一个播放器实例。切换下一集时，优先调用官方播放器的 `playNext({ albumId, episodeId, vid, getVideoByToken })`；如果当前 SDK 版本不支持，再销毁旧实例并创建新实例。`VePlayer` 的构造参数、事件常量和字段名在实际开发时以当前 SDK/Player Reference 为准。

播放数据来源必须是：

```text
前端 GET /episodes/:episodeId/play
-> QuicK ReeLS API 校验用户权限和内容状态
-> 返回 albumId、episodeId、vid、playAuthToken（如需）
-> TTMinis.getPlayer('byteplus')
-> new VePlayer({ vid, albumId, episodeId, getVideoByToken })
```

不要：

```text
不要把 byteplus_url 写进 <video src>
不要在前端调用 BytePlus AK/SK 签名接口
不要把 TikTok access_token 当作播放器 token 返回
不要只用本地 episodeId 而漏传平台 albumId/episodeId
```

### 9.7 播放与进度保存策略

```text
开始播放：读取 /episodes/:episodeId/play 的 resumePositionMs
每 15 秒：PUT /me/watch-progress
暂停：保存进度
切换剧集：保存旧剧集进度，再加载新剧集
页面隐藏/卸载：尽力保存进度
播放结束：positionMs = durationMs，completed = true
```

播放实现必须对接 TikTok Mini Drama 官方指定播放器，并使用实际返回的 `album_id`、`episode_id`、`vid`。不要自行以 `<video src="裸 MP4/HLS 地址">` 代替官方流程。

### 9.8 前端状态

建议拆分：

```text
authStore：业务 token、当前用户、登录状态
playerStore：当前专辑、当前剧集、播放状态、最近进度
adStore：当前广告展示中状态，防止用户重复点击
TanStack Query：专辑、剧集、进度等服务端缓存
```

---

## 10. 后端实现

### 10.1 Fastify 应用骨架

`apps/api/src/app.ts`：

```ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: process.env.API_CORS_ORIGIN?.split(',') ?? false,
    credentials: true
  });

  await app.register(jwt, {
    secret: process.env.JWT_SECRET!
  });

  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute'
  });

  app.get('/health', async () => ({ status: 'ok' }));

  // registerAuthRoutes(app)
  // registerAlbumRoutes(app)
  // registerEpisodeRoutes(app)
  // registerProgressRoutes(app)
  // registerAdminRoutes(app)

  return app;
}
```

### 10.2 TikTok 登录后端流程

```text
POST /auth/tiktok/login
  -> 接收前端 TTMinis.login() 的 code
  -> 后端调用 TikTok OAuth token endpoint
  -> 使用返回的 open_id 查询/创建 User
  -> 签发短期业务 JWT
  -> 前端携带 JWT 请求 QuicK ReeLS API
```

要求：

- OAuth 请求只在后端执行。
- `TIKTOK_CLIENT_SECRET` 仅从安全环境变量读取。
- `code` 只可用一次，失败时返回通用错误，不记录原始 code。
- Token 过期由前端重新静默登录恢复。

### 10.3 激励广告解锁后端事务

`POST /episodes/:episodeId/reward-unlock` 应在数据库事务中：

```text
查找 episode 并确认 ONLINE
-> 如果免费：返回可播放
-> 查找 (userId, episodeId) 是否已有 unlock
-> 已有：返回可播放（幂等）
-> 没有：创建 EpisodeUnlock(REWARDED_AD)
-> 创建 AdEvent(CLOSED_COMPLETED)
-> 返回可播放
```

不要把前端事件当作财务结算凭据。它是业务解锁事件和风控记录；TikTok 广告结算以平台报表为准。

### 10.4 插屏频控服务

在调用插屏前，前端可请求：

```text
GET /me/ad-eligibility?type=INTERSTITIAL&episodeId=ep_003
```

后端判断：

```text
过去 8 分钟是否已展示插屏
当前会话展示次数是否 < 3
当前用户距上次插屏后是否已完成至少 2 集
用户、地区、内容是否允许广告
```

响应：

```json
{
  "eligible": true,
  "reason": null
}
```

前端应把该判断当成减少打扰的控制，不要依赖它阻塞播放。广告失败或不支持时仍然继续播放。

### 10.5 TikTok Short Drama / BytePlus 服务职责

前端上传视频文件不应拿到 BytePlus AK/SK，也不应直接调用 TikTok Open API。推荐把第三方调用集中在后端的 `TikTokShortDramaService`：

```text
运营后台选择视频
-> 后端校验版权、格式、大小，并得到一个临时公开可下载 sourceUrl
-> 后端调用 TikTok Short Drama Open API 的异步视频上传接口
   （API 使用已绑定的 BytePlus account_id + space_name）
-> TikTok/BytePlus 将视频写入 BytePlus VOD，返回 job_id
-> Worker 轮询 job_id
-> 成功：保存 byteplus_vid、封面、时长，Episode = READY
-> 后端调用 image / album update 等 Open API 写入封面和剧集元数据
-> 提交专辑版本审核
-> 审核通过：设置 online version，再执行 show listing
-> TikTok 播放控制与 BytePlus VePlayer 可用，Episode/Album = ONLINE
```

这里有两套服务端凭证，不能混用：

```text
用户登录：前端 TTMinis.login() code -> /auth/tiktok/login -> TikTok OAuth -> QuicK ReeLS 用户会话
媒资管理：QuicK ReeLS API -> TikTok client_credentials -> Short Drama Open API
```

媒资管理的 client access token 由后端缓存到过期前并自动刷新；它不是用户登录 token，也不是 `play_auth_token`。调用视频、图片、专辑、审核和上架接口时，后端按当前 API Reference 使用对应的 `Authorization: Bearer ...` 和 `client_key` 字段。

当前官方 API 的关键概念如下（具体区域前缀、字段和枚举以 API Reference 为准）：

| 能力 | 后端调用结果 | QuicK ReeLS 应保存 |
| --- | --- | --- |
| 异步上传视频 | `job_id`，完成后得到 `byteplus_vid` | `providerJobId`、`byteplusVid`、`durationMs`、`byteplusCoverUrl`（仅后端/运营使用） |
| 上传图片 | `open_pic_id`、预览地址 | `tiktokCoverPicId`、可展示的封面地址 |
| 创建/更新专辑版本 | `album_id`、`version`、episode ID 映射 | `tiktokAlbumId`、当前版本、每集 `tiktokEpisodeId` |
| 查询专辑 | 审核状态、`online_version`、上架状态 | `reviewStatus`、`onlineVersion`、`publishStatus` |
| 设置在线版本/上架 | 平台状态更新 | 本地 `ONLINE`/`OFFLINE` 状态和审计日志 |
| 获取旧版播放凭证 | 短期 `play_auth_token` | 不持久化，按播放请求临时获取 |

后端接口可设计为：

```ts
interface TikTokShortDramaService {
  createVideoUpload(input: {
    sourceUrl: string; // 必须是第三方 API 可公开下载的 HTTPS 地址
    title: string;
    spaceName: string;
    byteplusAccountId: string;
  }): Promise<{ providerJobId: string; byteplusVid?: string }>;

  getVideoUploadStatus(input: {
    providerJobId?: string;
    byteplusVid?: string;
    byteplusAccountId: string;
  }): Promise<{
    status: 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
    byteplusVid?: string;
    byteplusUrl?: string; // 仅服务端排障使用，不返回用户端
    coverUrl?: string;
    durationMs?: number;
    errorMessage?: string;
  }>;

  uploadCover(input: { imageUrl: string }): Promise<{ tiktokPicId: string }>;
  createAlbum(): Promise<{ tiktokAlbumId: string; version: number }>;
  updateAlbum(input: {
    tiktokAlbumId: string;
    version?: number;
    album: Record<string, unknown>;
    episodes: Array<Record<string, unknown>>;
  }): Promise<{ version: number; episodeIdMap: Record<string, string> }>;
  queryAlbum(input: { tiktokAlbumId: string; version?: number }): Promise<unknown>;
  submitReview(input: { tiktokAlbumId: string; version: number }): Promise<void>;
  setOnlineVersion(input: { tiktokAlbumId: string; version: number }): Promise<void>;
  setListing(input: { tiktokAlbumId: string; listed: boolean }): Promise<void>;
  getPlayAuthToken(input: { tiktokEpisodeId: string }): Promise<string>;
}
```

`sourceUrl` 必须能被 TikTok Open API 从公网下载；若原片只在本地电脑，先放到受保护、限时有效的上传源地址，上传任务完成后立即失效。具体 API path、签名/Authorization、地区参数、BytePlus account 绑定、字段和审核状态必须按当前官方 API Reference 实现；不要把文档示例字段名当作永久不变的生产契约。

### 10.6 上传任务 Worker

首期 Worker 每 30 秒查询一次 `PENDING`/`PROCESSING` 任务：

```text
PENDING：调用 TikTok Short Drama 视频上传接口，保存 providerJobId，置 PROCESSING
PROCESSING：查询远端状态
SUCCEEDED：更新 Episode.byteplusVid、封面/时长和 Episode.status = READY
FAILED：保存脱敏错误，Episode.status = ERROR
```

重试建议：

```text
网络/5xx：指数退避，最多 5 次
鉴权/参数/内容审核错误：不自动无限重试，转人工处理
每次重试写审计日志
```

---

## 11. TikTok Short Drama + BytePlus 内容发布流程

### 11.1 一部剧从文件到用户可看

```text
1. 运营创建 Album（草稿）
2. 运营创建 Episode（草稿）
3. 创建 UploadJob
4. 后端通过 TikTok Short Drama Open API 提交视频 sourceUrl，并指定已绑定的 BytePlus account_id + space_name
5. Worker 轮询 job_id，确认成功后写入 byteplus_vid、视频时长和封面
6. 后端通过图片 Open API 上传专辑/剧集封面，保存 open_pic_id
7. 创建/更新 TikTok Short Drama album 版本和 episode 元数据（含 byteplus_vid）
8. 对 album_id + version 提交内容审核
9. 审核通过，设置 online version
10. 执行 show listing；仅 listing 成功后才允许播放
11. 同步平台审核/上架状态到本地，Album/Episode = ONLINE
12. 用户端 API 开始返回该内容和可播放信息
```

### 11.2 状态机

```text
Episode:
DRAFT -> UPLOADING -> READY -> REVIEWING -> ONLINE
                      -> ERROR
REVIEWING -> REJECTED / ONLINE
ONLINE -> OFFLINE

Album:
DRAFT -> REVIEWING -> ONLINE -> OFFLINE
REVIEWING -> REJECTED

TikTok 专辑版本（平台状态）：
草稿 -> 审核中 -> 审核通过 -> 设置 online version -> Listed
                              -> Delisted（下架）
```

前端仅允许看到本地 `ONLINE` 且 TikTok 版本已审核通过、已设置 `online_version` 并处于 `Listed` 的内容；`READY` 不是用户可播放状态，单纯拥有 `byteplus_vid` 也不能保证可播放。若专辑中的任一短剧外壳元素或剧集审核失败，按平台规则该版本的剧集可能整体不可播放，Worker 必须把平台状态同步到本地并显示可操作的运营错误。

---

## 12. 本地调试、构建和发布

### 12.1 先完成标准 Web 本地开发

启动：

```bash
pnpm dev:api
pnpm dev:mini
```

浏览器中先验证：

```text
页面布局
专辑/剧集接口
错误状态
运营后台 CRUD
数据库进度保存
```

浏览器不能验证 TikTok 专属能力：静默登录、真实广告、支付、客户端生命周期等。

### 12.2 Mini 开发调试

TikTok 文档要求项目根目录具备：

```text
package.json
dev 或 start 启动脚本
minis.config.json
```

准备后执行：

```bash
cd apps/mini-web
minis dev
```

调试顺序：

```text
1. 确认两个广告 Placement 已创建且 Active
2. 启动 minis dev
3. 在调试页开启 IAA mock
4. 用 TikTok 测试环境扫码连接
5. 验证登录
6. 验证激励广告：完整看完 / 中途关闭 / 拉取失败
7. 验证插屏：正常关闭 / 拉取失败 / 客户端不支持
```

### 12.3 构建代码资产

```bash
cd apps/mini-web
pnpm build
minis build
```

最终将 CLI 输出的 ZIP 上传到：

```text
TikTok Developer Portal
-> QuicK ReeLS App
-> Code version
-> Upload code asset
```

代码资产要求：

```text
ZIP 格式
不超过 200 MB
无 0 字节文件
包含完整前端编译产物
不包含 node_modules、.env、密钥、数据库导出、视频全集
必须实现 TikTok Login API
动态脚本和网络请求来源受限
```

### 12.4 Portal 预览与生产发布

```text
上传 ZIP
-> 代码扫描
-> 添加测试用户
-> Preview 生成二维码
-> 用测试 TikTok 账号扫码
-> 验证完整用户流程
-> Submit for review
-> 审批后 Release 到 Production 或 Gray release
```

首次发布只能生产发布。已有生产版本后，才可使用灰度发布。

---

## 13. 生产部署

### 13.1 最小生产环境

```text
1 台 Linux 云服务器（API + Worker + Nginx）
1 个托管 PostgreSQL，或服务器内 PostgreSQL（初期）
1 个已绑定服务器 IP 的域名
有效 HTTPS 证书
BytePlus 账号与 VOD 空间（已在 TikTok Developer Portal 绑定到 QuicK ReeLS App）
用于原片临时上传的私有对象存储或受限 HTTPS 文件源
```

生产建议优先使用托管 PostgreSQL，数据库不直接暴露公网端口。

### 13.2 Docker Compose 服务

```text
nginx
api
worker
postgres（若不使用托管数据库）
```

这里的 Nginx 主要服务 API 和运营后台，不负责托管上传到 TikTok Portal 的 Mini 前端 ZIP。Mini H5 的生产页面由 TikTok App 内 WebView 加载；它运行时再通过 `VITE_API_BASE_URL` 指向 `api.example.com`。如果需要浏览器独立访问运营后台，可单独部署 `admin-web` 的静态产物，但不要把它和 Mini H5 混进同一个 TikTok 代码资产。

部署过程：

```text
购买域名和服务器
-> DNS 将 api.example.com 指向服务器 IP
-> 配置 HTTPS 证书
-> 设置生产环境变量
-> docker compose up -d
-> 执行 Prisma migrate deploy
-> 访问 /health
-> Portal 添加 https://api.example.com 为 Trusted domain
-> Portal 的 Industry solutions 中启用 Media asset management 并绑定 BytePlus 账号/空间
-> 完成 URL ownership verification（如页面要求）
```

### 13.3 Nginx 基本职责

```text
HTTPS 终止
将 /api 请求反向代理到 Fastify
限制请求体大小
添加安全响应头
访问日志和错误日志
不暴露数据库端口
```

### 13.4 上线前检查

```text
[ ] https://api.example.com/health 返回正常
[ ] 数据库不暴露公网
[ ] 所有密钥只在服务器环境变量中
[ ] API CORS 只允许明确来源
[ ] Trusted domains 已配置 api 域名
[ ] 隐私政策和条款 URL 可访问
[ ] BytePlus 账号/空间已在本 App 的 Media asset management 中显示 Connected
[ ] TikTok Short Drama 异步视频上传任务可成功完成，且 Worker 可得到 byteplus_vid
[ ] 测试专辑审核通过、online version 已设置且已 Listed
[ ] TikTok 内 VePlayer 可用 album_id、episode_id、vid 播放测试剧集
[ ] 奖励广告与插屏广告 Placement 均 Active
[ ] 日志系统不泄漏 token 或密钥
```

---

## 14. 安全、风控与合规

### 14.1 必须实现

1. 全部生产接口使用 HTTPS。
2. 用户端与管理端使用不同 token、不同路由权限。
3. 管理员密码使用 Argon2 或 bcrypt 哈希，不保存明文。
4. 后端对用户身份、内容状态、解锁逻辑进行校验，不能相信前端传来的 `isUnlocked`。
5. 激励广告只允许 `isEnded === true` 后调用解锁接口。
6. 每个管理操作写入 `AuditLog`。
7. API 对登录、解锁、上传创建等接口限流。
8. 上传前限制文件格式、大小、来源 URL；异步任务错误信息脱敏。
9. 只返回用户播放所需字段，不返回平台密钥或内部 UploadJob 信息。
10. 确保短剧版权、地区、分级、语言与提交材料和实际内容一致。

### 14.2 不要做

```text
不要把 BytePlus AK/SK 写入 React 代码
不要把 TikTok Client Secret 写入 Vite 的 VITE_ 变量
不要将视频 MP4 集合压进 TikTok 代码 ZIP
不要让用户端 API 返回 BytePlus 裸播放 URL、TikTok client access token 或永久播放凭证
不要用原生 <video>、第三方播放器或自建视频播放链路替代 TikTok Minis VePlayer
不要把临时 sourceUrl 当成用户端视频 CDN；上传成功后应按生命周期失效或回收
不要用广告失败作为阻断观看的理由
不要在进入短剧、首次打开或播放中高频触发插屏
不要让管理员 API 使用普通用户 token
不要记录或打印完整 OAuth code、access token、密钥
```

---

## 15. 测试计划

### 15.1 单元测试

| 模块 | 必测场景 |
| --- | --- |
| 解锁服务 | 免费、已解锁、首次解锁、剧集下线、重复请求 |
| 进度服务 | 正常更新、负数、超时长、重复更新 |
| 广告频控 | 小于间隔、达到单会话上限、达到观看集数条件 |
| 鉴权 | 缺少 token、过期 token、普通用户访问管理员接口 |
| 上传 Worker | 成功、网络重试、远端失败、无效 job_id |
| 播放信息服务 | 未登录、未解锁、非 ONLINE、缺少平台 ID、旧版短期 token、禁止返回裸 URL |

### 15.2 集成测试

```text
登录 code -> 建立业务会话
创建专辑 -> 创建剧集 -> 建立上传任务 -> 更新状态
上传视频 -> 保存 byteplus_vid -> 更新 TikTok album/episode 元数据 -> 审核 -> online version -> Listed
激励广告完成后的解锁 -> 获取播放信息
获取播放信息 -> VePlayer 使用 album_id/episode_id/vid 创建实例
保存进度 -> 重进播放页恢复进度
下线专辑 -> 用户端不再返回
```

### 15.3 TikTok 真机测试矩阵

| 场景 | 预期 |
| --- | --- |
| TikTok 版本 >= 44.2.0 | 广告能力检测成功，可调用广告 API |
| TikTok 旧版本 | 显示兼容提示或直接降级，不崩溃 |
| TikTok Pro Android | IAA 不支持时正常继续基础观看流程 |
| 激励广告完整播放 | 仅本集解锁，可开始播放 |
| 激励广告中途关闭 | 不解锁，页面保持可操作 |
| 激励广告加载失败 | 不解锁，出现重试/稍后再试提示 |
| 插屏正常关闭 | 自动继续进入下一集 |
| 插屏加载失败 | 无感继续进入下一集 |
| 弱网或断网 | 明确错误和重试入口，无白屏 |
| 已审核且 Listed 的测试剧集 | `TTMinis.getPlayer('byteplus')` 创建 VePlayer 并正常首帧播放 |
| 草稿、审核中或未 Listed 剧集 | 后端不返回播放信息，VePlayer 不创建 |
| TikTok 旧客户端 | 后端按需要返回短期 `play_auth_token`，播放成功或明确降级提示 |

---

## 16. 开发里程碑

| 阶段 | 目标 | 关键交付物 |
| --- | --- | --- |
| M0 | 环境准备 | Node/pnpm/Docker、仓库、域名计划、数据库 |
| M1 | 用户端静态页面 | 首页、详情、播放页、条款和隐私页面 |
| M2 | 后端与数据 | Fastify、Prisma、专辑/剧集/进度 API |
| M3 | 登录与播放 | TTMinis 初始化、静默登录、VePlayer 官方播放方式 |
| M4 | 媒资闭环 | BytePlus 绑定、Open API 上传任务、Worker、审核、上架状态同步 |
| M5 | 广告变现 | IAA Placement、Rewarded 解锁、Interstitial 频控 |
| M6 | TikTok 调试 | minis dev、IAA mock、扫码真机验证 |
| M7 | 审核发布 | minis build ZIP、Portal 预览、审核、生产发布 |

### 每个里程碑的完成定义

```text
M1：浏览器内的页面和假数据体验完整
M2：数据库迁移成功，接口有自动化测试
M3：TikTok 内能完成登录，并以 VePlayer 播放一部已审核且已 Listed 的测试剧集
M4：一部测试短剧从 sourceUrl 上传到 BytePlus、审核、online version、Listed、ONLINE 全链路成功
M5：完整广告可解锁，插屏失败不会阻塞下一集
M6：真机上验证完整播放、中断、失败和旧版本降级
M7：代码资产通过审核，生产用户可以正常使用
```

---

## 17. 开发执行顺序

按以下顺序执行可减少返工：

1. 创建 `quickreels` 单仓库、Mini 前端、API 和 PostgreSQL。
2. 用假数据完成首页、专辑详情、剧集列表和播放页 UI。
3. 创建 Prisma 表和专辑/剧集 API，替换前端假数据。
4. 建立 HTTPS 测试 API 域名，填入 TikTok Portal Trusted domains。
5. 加载 `TTMinis` SDK，完成静默登录与后端 code 交换。
6. 在 Portal 绑定 BytePlus 账号/空间，按 TikTok Short Drama Open API 上传一条测试视频，保存 `byteplus_vid`。
7. 用 TikTok image/album API 创建测试专辑和剧集，审核通过、设置 online version 并 Listed。
8. 对接 `TTMinis.getPlayer('byteplus')` 和 VePlayer，跑通一部已上线测试内容。
9. 在 Portal 获批 IAA 并创建、激活两个广告 Placement。
10. 接入 Rewarded Ad 解锁和幂等后端记录。
11. 接入 Interstitial Ad 及频控、失败降级。
12. 建立媒资上传 Worker、内容审核和上线状态同步。
13. 执行 `minis dev` 和 IAA Mock，完成真机测试。
14. 执行 `pnpm build`、`minis build`，上传 ZIP 预览。
15. 修复审核问题，提交代码审核并发布。

---

## 18. 上线验收清单

### 用户端

```text
[ ] TikTok 内可打开 QuicK ReeLS
[ ] 静默登录成功，失败可恢复
[ ] 首页只显示线上内容
[ ] 专辑详情和剧集顺序正确
[ ] 免费集可直接播放
[ ] 锁定集只有在完整观看激励广告后才解锁
[ ] 广告中途退出、加载失败不会错误解锁
[ ] 插屏在规定频率内触发，关闭或失败后继续下一集
[ ] 进度可保存和恢复
[ ] 无网络、无内容、播放失败有清晰状态
```

### 内容与后台

```text
[ ] 视频可创建 TikTok Short Drama -> BytePlus 异步上传任务
[ ] Worker 正确同步成功/失败状态
[ ] 成功任务保存 byteplus_vid
[ ] 专辑、剧集可编辑、提交审核、设置 online version、Listed、下线
[ ] 用户端不会访问草稿/审核中/下线内容
[ ] 管理操作有权限和审计日志
```

### Portal 与发布

```text
[ ] Basic Information 已批准
[ ] Privacy Policy 与 Terms URL 可访问
[ ] Service domains、Trusted domains 配置无误
[ ] IAA 能力已启用，两个 Placement 均 Active
[ ] 代码 ZIP < 200 MB，且无 0 字节文件
[ ] 测试用户能扫描 Preview 二维码
[ ] TikTok 内完整广告、插屏、登录与播放均验证通过
[ ] 版本已提交审核并生产发布
```

---

## 19. 官方文档入口

- [Develop Your Mini Drama](https://developers.tiktok.com/docs/zh-Hans/tiktok-minis-develop-your-mini-app)
- [In-App Ads: Rewarded Ads](https://developers.tiktok.com/docs/zh-Hans/tiktok-minis-in-app-ads)
- [In-App Ads: Interstitial Ads](https://developers.tiktok.com/docs/zh-Hans/tiktok-minis-in-app-ads-interstitial-ads)
- [Mini Drama Integration Workflow](https://developers.tiktok.com/docs/en/tiktok-minis-integration-workflow)
- [Media Asset Management](https://developers.tiktok.com/docs/zh-Hans/media-asset-management)
- [Media Asset API Reference](https://developers.tiktok.com/docs/zh-Hans/media-asset-api-reference)
- [TikTok Minis Player（VePlayer）](https://developers.tiktok.com/docs/zh-Hans/minis-player)
- [Release Your Mini Drama](https://developers.tiktok.com/docs/zh-Hans/tiktok-minis-release-your-mini-app)

---

## 20. 开始开发前的最小输入清单

在开始写真实业务代码前，准备好以下非敏感信息：

```text
TikTok Mini App Client Key
Rewarded Ad Placement ID
Interstitial Ad Placement ID
计划使用的 API 域名
BytePlus Account ID、Space Name、区域
测试专辑资料：标题、封面、简介、剧集顺序
一到两条有合法版权的测试视频
目标发布国家/地区
```

私密信息只由部署人员写入服务器环境变量；BytePlus AK/SK 若需要绑定，只在 TikTok Developer Portal 的安全绑定流程中提交，不复制到前端或应用服务器：

```text
TikTok Client Secret
数据库密码
JWT_SECRET
```

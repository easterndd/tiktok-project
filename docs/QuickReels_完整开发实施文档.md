# QuicK ReeLS TikTok Mini Drama 完整开发实施文档

**版本：** v1.5
**本次修订：** 2026-09-11
**适用应用：** QuicK ReeLS  
**TikTok App ID：** `7681547859254429717`
**运行形态：** TikTok Minis / Mini Drama（TikTok App 内 WebView）  
**首期变现范围：** In-App Ads（IAA）中的 Rewarded Ads 与 Interstitial Ads  
**不包含：** IAP、订阅、自建视频分发、评论系统、机器学习推荐算法

> v1.5 目标：在保留 v1.4 产品范围的基础上，把 BytePlus VOD Server SDK 按 OpenAPI 能力拆分为 V2.0 优先、V1.0 回退的正式集成策略，并把 SDK 版本、适配服务、凭证隔离和迁移检查纳入工程门禁。本文仍采用 PRD 推荐的“方案 B 一次做到位”：PRD 中标注为二期的搜索、个人中心和多语言也纳入本次 V1.0 发布；首页推荐使用运营配置、播放统计和规则排序，不建设机器学习推荐系统。

> 本文是工程实施文档，不是 TikTok 或 BytePlus 的实时 API Reference。本文按当前 TikTok Mini Drama + BytePlus 媒资管理 + TikTok Minis VePlayer 的链路编写；TikTok Minis SDK、TikTok Short Drama Open API 路径、地区能力、字段和审核规则在编码及提交前必须以官方当前页面为准。BytePlus VOD Server SDK 按 OpenAPI 能力选版本：优先使用 V2.0；V2.0 尚未提供的 OpenAPI 继续使用 V1.0。按 2026-09-11 官方文档核验，V2.0 当前仅列出 `StartExecution` 和 `GetExecution`，且只支持 Java、Python、Go；本项目 Node.js 后端使用 V1.0 Node.js SDK 处理其余 VOD 能力，必要时通过独立的 Go/Python/Java 适配服务调用 V2.0。不要将 TikTok Client Secret、BytePlus AccessKey 或 SecretKey 发给任何人，也不要放入前端项目。

> **命名说明：** 项目对外品牌统一为 `QuicK ReeLS`。仓库中的历史文件名、内部包名和存储键暂时保留兼容，不代表用户可见品牌；TikTok Developer Portal 的 Basic Information、合同主体和 App ID 对应名称也应使用 `QuicK ReeLS`。

---

## 0. 先说结论：你的理解哪里正确，哪里需要修正

你的整体理解是正确的：前端是上传到 TikTok 的 H5 代码资产，后端和数据库部署在公网服务器，前端通过服务器 API 域名获取业务数据。需要修正的是视频播放这一段：**前端不能直接调用 BytePlus API，也不能把 BytePlus 返回的裸 MP4/HLS 地址放进 `<video>` 播放。** 默认路线是接入 TikTok 官方指定的 Mini Drama 播放器，由平台按审核、上架和账号绑定状态控制播放；只有在官方文档或直客明确允许时，才可评估替代播放器。

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
| 播放 | TikTok Minis 官方指定播放器（当前示例为 VePlayer） | 前端取得官方当前要求的播放信息，通过播放器适配器播放 |

所以，“视频源是否来自 BytePlus”的答案是：**是，视频媒资最终由已绑定的 BytePlus VOD 空间托管；但用户端不是直接拿 BytePlus 播放 URL，而是使用 TikTok Mini Drama 官方播放器。** 上传方式可以是 BytePlus 控制台/API 直传，也可以是 TikTok Open API 从公开 `sourceUrl` 异步转存，首期建议只选一种并在后台统一封装。

### 0.3 一次完整播放请求

```text
1. 用户点击免费或已解锁剧集
2. Mini 前端 -> GET /episodes/:episodeId/play（请求 QuicK ReeLS API）
3. QuicK ReeLS API 校验：内容 ONLINE、地区、平台 ID、访问策略；需要身份的场景再校验用户登录
4. 后端按当前官方播放器契约返回必要的播放标识；旧版兼容字段仅在官方确认需要时返回
5. 前端通过播放器适配器获取 TikTok 官方指定播放器
6. 官方播放器使用平台标识连接 BytePlus 播放能力
7. TikTok 平台再次按审核、上架、账号绑定状态执行播放控制
8. 播放进度仍由前端同步回 QuicK ReeLS API 保存
```

如果用户点击的是锁定剧集，前端应先按 3.2 和 8.2 的激励广告流程处理：完整观看 15 秒广告、后端幂等解锁成功后，再调用 `/episodes/:episodeId/play` 自动起播。不要先创建播放器再尝试绕过锁定状态。

`album_id`/`episode_id` 是 TikTok Short Drama 的平台标识，`vid` 是 BytePlus 视频标识；它们与数据库里的本地 `Album.id`/`Episode.id` 不同，必须建立映射。字段名、返回结构和是否需要播放凭证以当前官方 Player Reference 为准；后端可以保存并返回封面和时长，但不应把 `byteplus_url`、AK/SK 或内部上传任务信息返回给用户端。

### 0.4 对当前几个问题的直接回答

| 你的问题 | 结论 |
| --- | --- |
| 完成 Web 项目后上传到 TikTok 吗？ | 是。只上传构建后的 Mini H5 ZIP；后端、数据库、视频文件不放进 ZIP。 |
| 前端填写服务器域名吗？ | 是，以构建环境变量写入 API Base URL，并在 Portal 配置 Trusted domain；用户不需要手填。 |
| 前端请求通过服务器域名到后端吗？ | 是。专辑、封面、简介、集数、解锁状态和播放元信息都先请求 QuicK ReeLS API。 |
| 视频源直接通过 BytePlus 获取吗？ | 视频实际托管在 BytePlus，但前端不直接拿 BytePlus URL；由 VePlayer 按 TikTok 平台标识播放。 |
| 上传短剧后封面/简介/集数怎么来？ | 运营后台提交资料；后端通过 TikTok Short Drama API 写入专辑/剧集，自己的数据库保存业务副本，再提供给前端。 |
| 播放是怎么实现的？ | 后端返回当前官方播放器所需的安全播放信息，前端通过播放器适配器调用官方能力；`album_id`、`episode_id`、`vid` 和临时凭证仅作为待官方复核的示例字段。 |
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
  -> QuicK ReeLS API 返回封面/简介/集数/访问状态
  -> 用户点击免费/已解锁剧集，或锁定剧集广告解锁完成
  -> QuicK ReeLS API 校验访问策略和平台状态
  -> 返回当前官方播放器所需的安全播放信息
  -> 播放器适配器按官方 SDK/API Reference 创建播放器
  -> VePlayer 按 TikTok 播放控制从 BytePlus 获取视频流
  -> 前端把播放进度同步回 QuicK ReeLS API，数据库保存进度
```

**边界必须保持不变：** Mini 前端只请求 QuicK ReeLS API 和 TikTok Minis SDK；不直接调用 BytePlus 管理 API，不接触 BytePlus AK/SK，不播放裸 MP4/HLS；QuicK ReeLS API 也不代理整段视频流，只负责业务鉴权、元数据和必要的临时播放凭证。

### 0.6 需求来源、证据等级和适用边界

本次升级结合了三类材料，开发时必须按证据等级理解：

| 信息类别 | 可以直接作为实施依据的内容 | 处理方式 |
| --- | --- | --- |
| PRD 明确需求 | 匿名用户可浏览公开内容、需要身份的功能再登录、必须接入 TikTok Login API、使用官方指定播放器、完成 Portal 审核发布 | 纳入产品验收和接口契约 |
| 附件明确记录的事实 | TikTok Minis 运行于 TikTok App WebView；发布需要企业认证、行业资质、Basic Information、代码资产和审核；IAA、媒资、Business Center、资产登记和投放开白属于不同链路 | 纳入平台门禁和发布检查 |
| 附件中的内部判断或待确认项 | 播放器资格、无资格时是否允许自研播放器、登录是否对所有播放强制、美国主体和 USDS TPRM 适用性、具体 API 字段和路径 | 必须回到官方页面或直客确认，不得直接写成硬规则 |

附件中的私有 Lark/飞书链接只能作为资料线索。除非已经由项目成员在官方 Portal、官方 API Reference 或直客渠道复核，否则不把其中的标题、截图、字段和结论视为已验证的公开官方规范。

### 0.7 v1.4 升级结论

当前实施文档对 PRD 的用户功能覆盖基本完整，但 v1.3 仍有四类上线风险没有被正式阻断：

1. 把官方 VePlayer 写成无条件可用，没有先确认当前 App 的播放器资格。
2. “静默登录”容易被误解为所有页面和所有播放都必须登录，与 PRD 的匿名浏览要求不一致。
3. IAA 合同、Placement、Business Center、资产登记、ADV ID、投放开白和美国地区准入没有形成一组可停止发布的 P0 门禁。
4. `AdEvent`、收益报表、Middle Funnel Event Postback、Smart+ 广告 API 和短剧商品库 API 没有明确 V1 与后续阶段的边界。

因此，v1.4 将“功能完成”和“平台/商业上线资格”分开管理。功能可以先用假数据和 Mock 开发，但在平台资格和播放器路线未确认前，不得承诺真实生产播放、广告变现或美国上线日期。

---

## 1. 最终架构

TikTok Mini Drama 是标准 H5 Web 应用，不是传统小程序。前端代码被构建、校验并上传为 TikTok Portal 的 ZIP 代码资产；后端和数据库仍需要部署在自己的公网 HTTPS 环境。

```text
┌──────────────────────────────────────────────────────────────┐
│ TikTok App                                                    │
│  └─ WebView                                                    │
│      └─ QuicK ReeLS Mini H5（TikTok Portal 的 ZIP 代码资产）   │
│          ├─ React 页面                                         │
│          ├─ window.TTMinis：登录、广告、官方播放器能力探测       │
│          ├─ 播放器适配器：按当前 Player Reference 创建播放器     │
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
│  ├─ BytePlus VOD V1.0：V2.0 尚未覆盖的 VOD OpenAPI            │
│  └─ 日志、限流、权限与健康检查                                  │
└───────────────┬──────────────────────────────┬───────────────┘
                │                              │
                ▼                              ▼
      PostgreSQL 数据库                   TikTok / BytePlus 媒资能力
      用户/剧集/进度/记录                 审核、上架控制 / 视频托管与传输
                                                ▲
                                                │ V2.0（仅受支持的 OpenAPI）
                                      BytePlus VOD V2 Worker（Go/Python/Java）
```

### 1.1 三类资产必须分开

| 资产 | 存放位置 | 作用 | 绝不能包含 |
| --- | --- | --- | --- |
| Mini 前端代码资产 | TikTok Portal 的 Code version ZIP | 运行页面、调用 TTMinis、请求后端 | AK/SK、Client Secret、数据库密码、视频文件 |
| 后端服务 | 公网 HTTPS 服务器 | 业务逻辑、业务会话、数据库访问、调用 TikTok Short Drama Open API | 前端私有构建依赖无需部署给用户 |
| BytePlus VOD V2 适配服务 | 与 API/Worker 同一私有网络 | 调用当前 V2.0 已支持的 OpenAPI；首期仅为需要 `StartExecution`/`GetExecution` 的流程启用 | 不向 Mini 暴露 AK/SK，不承担 V1.0 回退接口 |
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

### 2.1 BytePlus VOD Server SDK 版本策略

本项目采用“按 OpenAPI 逐个选版本”的策略，而不是给整个 BytePlus VOD 项目只指定一个 SDK 大版本。BytePlus 官方 Server SDK 总览明确说明，V2.0 是新一代 SDK；在 OpenAPI 尚未全部迁移期间，可以并行使用两个版本。官方当前 V2.0 页面列出的 VOD API 为：

```text
V2.0：StartExecution、GetExecution
```

V2.0 当前只提供 Java、Python、Go SDK，不提供 Node.js SDK。因此本项目的 Node.js 主后端不能直接把 V2.0 当作 npm 依赖安装；需要调用 V2.0 API 时，使用独立的 V2 适配服务，推荐 Go，或选择 Python/Java。V1.0 的 Node.js SDK 继续承担 V2.0 尚未覆盖的 VOD OpenAPI。

| 项目能力/BytePlus OpenAPI | 采用版本 | 实现位置 | 说明 |
| --- | --- | --- | --- |
| `StartExecution` | V2.0 | `byteplus-vod-v2-worker`（Go/Python/Java） | V2.0 当前已支持；不得用 V1.0 替代 |
| `GetExecution` | V2.0 | `byteplus-vod-v2-worker`（Go/Python/Java） | 与 `StartExecution` 配套轮询 |
| `UploadMediaByUrl` | V1.0 | Node.js API/Worker | 当前 V2.0 支持清单未包含 |
| `QueryUploadTaskInfo` | V1.0 | Node.js API/Worker | 当前 V2.0 支持清单未包含 |
| `ApplyUploadInfo`、`CommitUploadInfo`、`UploadMedia` | V1.0 | Node.js API/Worker | 当前 V2.0 支持清单未包含；用于服务端上传流程 |
| `GetPlayInfo`、`GetPlayAuthToken` | V1.0 | Node.js API | 当前 V2.0 支持清单未包含；播放 Token 只在官方播放器链路确实需要时生成 |
| TikTok Short Drama 的上传、专辑、审核、上架 API | TikTok 官方 Open API | Node.js API/Worker | 这不是 BytePlus VOD Server SDK，不纳入 V1/V2 归类 |

版本选择必须满足以下约束：

1. 对当前 V2.0 支持的 OpenAPI，生产实现优先且固定使用 V2.0。
2. 对 V2.0 尚未提供的 OpenAPI，使用 V1.0；不得为了“统一版本”强行改写成不存在的 V2 调用。
3. 同一个业务调用点只绑定一个版本；不得在一次请求中对同一个 OpenAPI 随意混用 V1.0 和 V2.0。
4. V1.0 与 V2.0 可以并行部署，但必须分别封装在 `BytePlusVodV1Service` 和 `BytePlusVodV2Service` 后面，业务层不直接依赖官方 SDK 类型。
5. 每次新增 BytePlus OpenAPI 前，先查官方 V2.0 supported APIs 清单并记录核验日期；如果后来迁移到 V2.0，先做兼容测试，再删除对应 V1.0 调用。
6. V2.0 适配服务只接收内部任务和最小参数，AK/SK 只注入该服务；Mini 前端永远不能接触任一版本的 BytePlus 凭证。

当前首发范围不需要 BytePlus 工作流执行时，不必为了引入 V2.0 而强行启动 V2 Worker；但一旦使用 `StartExecution` 或 `GetExecution`，必须按上述 V2.0 路径实现，不能回退到 Node.js V1.0。

### 2.2 第一版不建议使用

```text
Kubernetes
Redis 集群
Kafka/RabbitMQ 集群
复杂 DDD 分层
除 BytePlus V2.0 OpenAPI 明确需要外的其他微服务
自建视频 CDN、裸 MP4/HLS 或原生 `<video>` 播放链路（Mini Drama 不允许）
```

首期先用一个 Node.js API、一个 Node.js Worker 和一个 PostgreSQL 跑通「上传视频 -> 上架 -> 看剧 -> 看广告解锁」闭环；只有实际使用 `StartExecution`/`GetExecution` 时，才增加轻量 BytePlus V2 Worker。流量增长后再拆分其他服务。

---

## 3. 功能范围与产品规则

### 3.1 用户端 V1.0

1. 尝试静默 TikTok 登录和业务会话恢复；公开浏览不因静默登录失败而阻塞。
2. 首页推荐位体系：继续观看、轮播图、题材分类、热门/新作、底部信息流。
3. 剧集详情页：简介、题材标签、集数、播放/热度数据、点赞、收藏、分享和继续观看。
4. 通过已确认有资格的官方 Mini Drama 播放方式播放已上线剧集。
5. 观看记录与断点续播：首页、详情页、个人中心三处入口保持一致。
6. 锁定剧集通过完整观看激励广告解锁。
7. 在章节过渡点展示插屏广告，并在失败时无感降级。
8. 搜索剧名和题材关键词，搜不到时提供推荐兜底。
9. 个人中心：观看记录、收藏夹、语言切换、基础设置。
10. 多语言界面和剧集语言/版本切换，首期投放地区固定为 Australia、Brazil、Canada、Indonesia、Japan、Mexico、New Zealand、South Korea、Thailand、United States of America；公开端仅提供这些地区对应的语言，后台固定中文。
11. 网络、广告和播放失败的降级提示，以及播放质量和卡顿监控。

### 3.1.1 首页推荐位规则

首页固定返回以下五类板块，顺序和开关由运营后台配置：

| 板块 | 默认规则 | 用户行为 |
| --- | --- | --- |
| 继续观看 | 当前用户最近未完成的剧集，按最近观看时间排序 | 点击直接从断点播放 |
| 轮播图 | 运营手动配置主推剧、新剧或活动，可设置有效期 | 点击进入专辑详情或指定剧集 |
| 题材分类 | 运营维护题材标签，横向展示；点击进入该题材列表 | 按题材筛选线上专辑 |
| 热门/新作 | 热门按有效播放量排序，新作按上线时间排序 | 点击进入详情 |
| 底部信息流 | 按游标分页持续加载线上专辑，直到没有下一页 | 下拉加载，结束时显示明确提示 |

首页必须满足：

```text
首屏优先返回可渲染内容，目标为 1 秒内看到内容
封面使用竖版 3:4，图片失败使用本地 fallback-cover.webp
所有板块支持 enabled、sortOrder、title 和规则配置
信息流中的已看过专辑显示“已看过”或进度信息
网络异常时优先使用最近一次成功缓存；缓存过期时显示明确的离线状态
线上专辑至少能从一个推荐板块或底部信息流到达
```

首期不建设个性化推荐模型；热门、最新、题材和运营置顶足以满足 PRD 的曝光需求。

### 3.1.1.1 自有内容后台（CMS）配置边界

QuicK ReeLS 自建运营后台是线上内容和展示规则的唯一配置入口。以下参数必须可在后台编辑并立即通过 API 生效，不能写死在 Mini 前端：

| 配置域 | 可调整内容 | 对应接口 |
| --- | --- | --- |
| 剧集元数据 | 标题、简介、封面、地区、语言、上下线状态 | `/admin/albums`、`/admin/albums/:albumId` |
| 集数列表 | 集号、标题、排序、封面、时长、状态 | `/admin/episodes`、`/admin/episodes/:episodeId` |
| 访问策略 | `freeEpisodeCount`、`rewardedAdEnabled`、`rewardedPlacementId` | `/admin/albums/:albumId` |
| 首页推荐 | 区块 enabled、标题、排序、有效期、推荐项 | `/admin/home-blocks` |
| 页面组件 | 顶栏、底部导航、首页介绍、信息流、详情简介、历史、收藏开关 | `/admin/ui-components`、`/ui-components` |

小程序启动后读取 `/ui-components`，首页读取 `/home` 返回的组件配置；关闭模块只改变配置数据，不需要重新构建或上传前端。剧集播放和广告解锁由服务端再次读取专辑访问策略校验，防止仅依赖前端开关造成绕过。

### 3.1.2 详情页和互动规则

详情页必须展示封面、剧名、简介、题材标签、总集数、播放/热度数据、继续观看入口和选集列表。选集列表展示：

```text
免费集：可直接播放
锁定集：锁标 + “看广告解锁”提示；点击集本身直接拉起激励广告
已解锁集：可直接播放
已看未完成：显示观看进度条和百分比
```

点赞、收藏和分享均为独立行为。点赞/收藏需要持久化用户状态；分享需要记录分享事件，并生成包含封面、剧名和专辑深链参数的卡片或链接，打开后直接进入对应专辑。

### 3.1.3 搜索、个人中心和多语言

```text
搜索：支持剧名和题材标签模糊匹配，使用防抖请求；无结果时返回推荐内容
个人中心：观看记录按最近观看排序，收藏夹进入详情页，设置入口固定可达
语言：默认跟随系统语言，也允许用户手动切换；公开端只显示去重后的语言：`en`、`pt`、`fr`、`id`、`ja`、`es`、`ko`、`th`，不提供中文选项；投放国家仅作为内容地区元数据，运营后台固定中文
剧集语言：首期采用多版本方案，数据模型预留字幕轨方案的 language/variant 字段
推荐过滤：只向用户返回其当前语言或明确可接受语言的内容；地区和语言白名单由服务端校验
```

### 3.2 广告规则

| 广告类型 | 业务目的 | 推荐触发点 | 禁止/不建议触发点 |
| --- | --- | --- | --- |
| Rewarded Ads | 解锁一集或获得明确奖励 | 用户点击锁定剧集后直接弹出 15 秒广告 | 页面自动弹出、未完整看完即解锁 |
| Interstitial Ads | 章节或页面过渡变现 | 第 N 集播完后，用户确认进入下一集前 | 首次打开 App、首次打开短剧、播放过程中、高频连续弹出 |

业务频控建议：

```text
插屏：每看完 2 集最多 1 次
插屏：两次展示间隔至少 8 分钟
插屏：单次会话最多 3 次
广告加载/展示失败：继续用户原来的观看流程
激励：同一集解锁后永久标记为已解锁
锁集广告完成后：自动解锁目标剧集并自动开始播放
免费/锁定规则：运营后台可按剧集修改，无需重新发布 Mini 代码
```

### 3.3 TikTok 平台前置条件

研发可以在平台资格未全部完成时使用假数据、Mock 和本地环境推进，但真实生产发布必须满足以下条件：

1. 企业认证和 Mini Drama 行业资质审核完成。
2. Basic Information 已填写并获批：名称、图标、描述、隐私政策、服务条款、服务域名等。
3. Drama IAA 合同已签署，Organization 的 IAA 能力已申请、审批并启用。
4. App 的 Monetization 页面中已创建并启用：
   - 一个 `Rewarded ad` Placement。
   - 一个 `Interstitial ad` Placement。
5. 保存两个 `Placement ID`，并确认其所属 App、地区和状态均可用于测试/生产。
6. Business Center 已建立或确认；TikTok Minis 资产登记、ADV ID 提供和投放开白已完成（如果本项目包含投放）。
7. 已配置并验证所有 Trusted domains、Service domains、Webhook 和 URL ownership。
8. Payout、税务、发票和收款资料已按商业上线要求准备；这些是变现结算门禁，不是前端 API 接入完成条件。

IAA 要求 TikTok App 版本不低于 `44.2.0`；必须先调用 `TTMinis.canIUse()` 做能力检测。TikTok Pro Android 当前不支持短剧 IAA，需要降级处理。

### 3.3.1 播放器资格决策门禁

播放器路线是本项目的 P0 阻塞项，必须在接入真实剧集前由项目负责人通过官方 Portal、当前 Player Reference 或 TikTok 直客确认：

```text
P0-A：当前 App 已获得 Mini Drama 官方播放器/VePlayer 使用资格？
  ├─ 是
  │   -> 按官方当前 SDK 和 Player Reference 接入 VePlayer
  │   -> 以实机播放一部已审核且 Listed 的测试剧集作为 M3 完成条件
  └─ 否或无法确认
      -> 暂停“官方 VePlayer 可用”的生产承诺
      -> 只有官方文档或直客书面确认允许时，才评估自研播放器路线
```

附件中“没有播放器资格时需要自研播放器”的内容属于内部判断，不能直接当作官方硬规则。自研路线在进入开发前必须单独评估：

```text
审核合规性
播放授权和媒资接口
DRM/播放地址获取方式
TikTok WebView 兼容性
连续播放和进度恢复
IAA 解锁与播放器状态衔接
地区、版权、内容审核和下架联动
```

在资格未确认前，允许完成页面、接口、数据模型、播放器适配器和 Mock；不允许把 `TTMinis.getPlayer('byteplus')` 的示例代码或“VePlayer 已可用”写入生产完成定义。

### 3.3.2 登录与匿名访问策略

平台要求代码资产实现 TikTok Login API，但产品不要求所有页面在首屏强制登录。按 PRD 执行以下分层：

| 场景 | 是否需要业务登录 | 处理方式 |
| --- | --- | --- |
| 首页公开内容、专辑详情、公开剧集目录 | 否 | 允许匿名访问；接口认证为可选 |
| 点赞、收藏、观看记录、继续观看 | 是 | 触发登录并在成功后重试原操作 |
| 分享归因和个性化内容 | 建议是 | 未登录时可生成基础深链，归因能力按登录状态降级 |
| Rewarded 广告解锁 | 是 | 广告完播后先建立/恢复业务会话，再调用解锁接口 |
| 播放 | 视官方播放器和产品规则确认 | 免费公开集可先按匿名方案开发；若官方要求登录，则只在播放动作拦截并给出登录引导 |

静默登录失败时不得白屏或阻塞公开内容。前端必须有 `ANONYMOUS`、`AUTHENTICATING`、`AUTHENTICATED` 和 `AUTH_FAILED` 等状态；后端接口也必须明确“匿名可用”或“必须认证”。登录成功后，匿名期间产生的本地进度或分享上下文按产品规则合并，不得静默覆盖服务端数据。

### 3.3.3 地区、主体和美国上线门禁

目标国家/地区必须在开发前写入发布配置，并由直客或 Portal 确认。美国不能作为默认上线地区：

```text
美国上线需要 TikTok 额外批准；
普通 App 审核通过不等于美国生产准入；
新加坡主体、香港主体或其他主体是否满足目标地区要求，需逐项确认；
USDS TPRM 是否适用、所需材料和周期，需由直客/官方入口确认；
目标地区、内容版权、分级、语言和广告能力必须保持一致。
```

确认完成前可以进行本地开发、非生产测试和 Portal Preview；不得承诺美国生产发布日期，也不得把美国写成默认发布地区。地区阻断应在后台内容筛选、广告能力判断和发布验收中分别体现。

### 3.4 PRD 覆盖矩阵

| PRD 功能 | v1.4 覆盖位置 | 交付状态 |
| --- | --- | --- |
| 首页推荐位体系 | 3.1.1、7.2 `HomeBlock`、8.2 `/home`、9.9 | V1.0 |
| 剧集详情页 | 3.1.2、7.2 互动模型、8.2 互动接口 | V1.0 |
| 播放器 | 9.6、9.7、9.8、10.7 播放监控 | V1.0 |
| 广告解锁 | 3.2、8.2、9.4、10.3 | V1.0 |
| 观看记录与续播 | 7.2 `WatchProgress`、8.2、9.7 | V1.0 |
| 搜索 | 3.1.3、7.2 `SearchEvent`、8.2 `/search` | V1.0 |
| 个人中心 | 3.1.3、8.2 `/me/history` 和 `/me/favorites`、9.8 | V1.0 |
| 多语言切换 | 3.1.3、7.2 翻译模型、8.2 `/me/preferences` | V1.0 |
| 收益回流 | 7.2 `AdRevenue`、8.3、10.8 | V1.0 研发能力；平台精确结算依赖官方报表 |

平台资格、IAA 合同、Placement 状态、Business Center、资产登记、ADV ID、投放开白、目标地区批准和主体/USDS TPRM 不属于 PRD 的用户功能项，不能用“功能覆盖 V1.0”替代，必须按 3.3、3.3.1 和 3.3.3 的 P0 发布门禁单独验收。

### 3.4.1 官方资料核验矩阵

以下矩阵是开发和发布前的必填台账。`未确认` 不得被解释为 `已支持`：

| 能力 | 附件中的资料 | 当前实施假设 | 是否已由公开官方文档确认 | 需要确认的入口/负责人 | 阻塞级别 |
| --- | --- | --- | --- | --- | --- |
| Mini Drama 播放器资格 | 官方播放器可能定向邀请；无资格时是否可替代待确认 | 通过播放器适配器接入官方能力 | 待确认 | TikTok Portal / Player Reference / 直客 | P0 |
| 播放器参数、事件和版本 | VePlayer、`album_id`、`episode_id`、`vid`、旧版 token | 仅作为适配器内部 DTO | 部分确认，字段需复核 | 当前 SDK/API Reference | P0 |
| TikTok Login / authorize | 需实现 Login API | 前端拿 code，后端换取身份 | 流程需按当前 Minis 文档复核 | Minis SDK / Server APIs | P0 |
| Rewarded Ads | IAA 合同、版本和 Placement 前置 | 完播后业务解锁，失败降级 | 资格和字段需复核 | Monetization / IAA 文档 | P0 |
| Interstitial Ads | 作为章节过渡变现 | 频控后展示，失败继续 | 资格和字段需复核 | Monetization / IAA 文档 | P1 |
| IAA 合同与 App 版本 | 附件记录版本不低于 `44.2.0` | 以 Portal 和官方文档实时要求为准 | 待提交前复核 | IAA 能力页 / 直客 | P0 |
| 媒资库与 BytePlus 绑定 | Media Asset Management、账号和 Space | 后端异步上传并保存平台 ID | 绑定条件需复核 | Portal / Media Asset 文档 | P0 |
| Business Center / 资产登记 | BC、资产登记、ADV ID、投放开白 | 作为投放链路前置，不阻塞本地开发 | 待确认 | TikTok for Business / 直客 | P0（含投放时） |
| 美国地区准入 | 美国需额外批准 | 不默认承诺美国生产 | 待确认 | 地区准入页 / 直客 | P0（美国发布时） |
| Middle Funnel Event Postback | 附件计划测通后再开发 | V1 预留事件，不作为默认阻塞 | 待确认 | TikTok for Business / 直客 | P1/P2 |

### 3.5 本版交付节奏

本实施文档选择 PRD 的“方案 B 一次做到位”，因此“二期”只表示 PRD 中的后续优先级，不表示从本次发布中删掉。V1.0 必须同时具备：

```text
首页五类推荐位 + 详情页互动 + 官方播放器 + 激励广告解锁
观看记录与断点续播 + 搜索 + 个人中心 + 多语言
```

为控制一次性交付风险，首批多语言采用 2-3 个目标语种和“多版本内容”方案；字幕轨方案只在数据模型中预留，不作为本次上线阻塞项。搜索、个人中心和多语言不允许只做空壳页面，必须完成 API、异常状态、权限和真机验收。

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
│   │   │   │   ├── home-feed/                # 五类首页板块、运营配置和缓存
│   │   │   │   ├── albums/
│   │   │   │   ├── episodes/
│   │   │   │   ├── watch-progress/
│   │   │   │   ├── interactions/             # 点赞、收藏、分享
│   │   │   │   ├── search/
│   │   │   │   ├── profile/
│   │   │   │   └── i18n/
│   │   │   ├── pages/
│   │   │   │   ├── HomePage.tsx
│   │   │   │   ├── AlbumPage.tsx
│   │   │   │   ├── WatchPage.tsx
│   │   │   │   ├── SearchPage.tsx
│   │   │   │   ├── ProfilePage.tsx
│   │   │   │   ├── PrivacyPage.tsx
│   │   │   │   └── TermsPage.tsx
│   │   │   ├── lib/
│   │   │   │   ├── api-client.ts
│   │   │   │   ├── ttminis.ts
│   │   │   │   ├── cache.ts
│   │   │   │   ├── deep-link.ts
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
│   │   │   │   ├── home/
│   │   │   │   ├── albums/
│   │   │   │   ├── episodes/
│   │   │   │   ├── progress/
│   │   │   │   ├── interactions/
│   │   │   │   ├── search/
│   │   │   │   ├── profile/
│   │   │   │   ├── i18n/
│   │   │   │   ├── ads/
│   │   │   │   ├── analytics/
│   │   │   │   ├── admin/
│   │   │   │   └── media-assets/
│   │   │   ├── services/
│   │   │   │   ├── tiktok-oauth.service.ts
│   │   │   │   ├── tiktok-short-drama.service.ts
│   │   │   │   ├── recommendation.service.ts
│   │   │   │   ├── revenue.service.ts
│   │   │   │   ├── analytics.service.ts
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
│   ├── byteplus-vod-v2-worker/             # 仅调用 BytePlus V2.0 已支持的 OpenAPI
│   │   ├── cmd/
│   │   ├── internal/
│   │   ├── go.mod                          # 或使用 Python/Java 实现
│   │   └── README.md
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
│       │   ├── home.ts
│       │   ├── interaction.ts
│       │   ├── search.ts
│       │   ├── locale.ts
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
pnpm add @byteplus/vcloud-sdk-nodejs
pnpm add -D typescript tsx prisma @types/node
pnpm prisma init
```

`@byteplus/vcloud-sdk-nodejs` 是 BytePlus VOD Server SDK V1.0，用于当前 V2.0 尚未覆盖的 Node.js VOD OpenAPI。不要在 Node.js 项目中寻找不存在的 V2.0 npm 包。

如果本次业务确实使用 BytePlus VOD `StartExecution` 或 `GetExecution`，另建 V2 Worker。以 Go 为例：

```bash
mkdir apps/byteplus-vod-v2-worker
cd apps/byteplus-vod-v2-worker
go mod init quickreels/byteplus-vod-v2-worker
go get github.com/byteplus-sdk/byteplus-go-sdk-v2
```

V2 Worker 只实现当前官方 V2.0 支持的 OpenAPI，并通过内部 HTTP、任务表或消息队列与 Node.js API 通信；不把 Go SDK 引入 `apps/api`，也不在 V2 Worker 中复制 V1.0 的接口实现。

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

# BytePlus VOD Server SDK V1.0：用于 V2.0 尚未覆盖的 VOD OpenAPI
# 仅在 Node.js API/Worker 直接调用 BytePlus VOD 时配置
# 以下为项目自定义变量；服务启动时读取后显式注入 SDK。
# 如改用 SDK 官方环境变量自动读取，应使用 BYTEPLUS_ACCESSKEY / BYTEPLUS_SECRETKEY。
# BYTEPLUS_ACCESS_KEY=never-expose-this-value
# BYTEPLUS_SECRET_KEY=never-expose-this-value
# BYTEPLUS_VOD_ENDPOINT=https://vod.byteplusapi.com

# BytePlus VOD Server SDK V2.0 由独立 V2 Worker 调用；
# Node.js API 只需要内网 Worker 地址，不保存 V2.0 AK/SK。
# BYTEPLUS_V2_WORKER_URL=http://byteplus-vod-v2-worker:8080
```

### 6.2.1 BytePlus V2 Worker `.env.example`（仅启用 `StartExecution`/`GetExecution` 时）

```env
NODE_ENV=production
PORT=8080
HOST=0.0.0.0

BYTEPLUS_REGION=ap-southeast-1
BYTEPLUS_V2_ACCESS_KEY=never-expose-this-value
BYTEPLUS_V2_SECRET_KEY=never-expose-this-value
BYTEPLUS_V2_ENDPOINT=https://vod.byteplusapi.com
```

### 6.3 必须遵守的规则

```text
.env 永远不提交 Git
生产密钥使用服务器环境变量或密钥管理服务
BytePlus AK/SK 只放在实际调用 BytePlus Server SDK/OpenAPI 的后端服务中；不放入 Mini 前端
V1.0 凭证只注入需要 V1.0 的 Node.js API/Worker，V2.0 凭证只注入需要 V2.0 的 Go/Python/Java Worker
不要为了 TikTok Short Drama Open API 在应用服务器中复制 BytePlus 凭证；若该链路使用 TikTok 的应用授权，则按 TikTok 官方授权流程配置
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
User 1 ── * Favorite * ── 1 Album
User 1 ── * Like * ── 1 Album
User 1 ── * SearchEvent
Album 1 ── * Episode
Album 1 ── * AlbumTranslation
Album * ── * Genre
Album 1 ── * HomeBlockItem
Episode 1 ── * UploadJob
Episode 1 ── * EpisodeTranslation
Episode 1 ── * PlaybackQualityEvent
AdRevenue * ── 1 Episode
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

enum HomeBlockType {
  CONTINUE_WATCHING
  CAROUSEL
  GENRE
  HOT
  NEW_RELEASES
  FEED
}

model User {
  id              String             @id @default(cuid())
  tiktokOpenId    String             @unique
  preferredLocale String             @default("en")
  acceptedLocales Json?
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt
  watchProgresses WatchProgress[]
  episodeUnlocks  EpisodeUnlock[]
  adEvents        AdEvent[]
  favorites       Favorite[]
  likes           Like[]
  shareEvents     ShareEvent[]
  searchEvents    SearchEvent[]
  qualityEvents   PlaybackQualityEvent[]
}

model Album {
  id             String              @id @default(cuid())
  tiktokAlbumId  String?             @unique
  tiktokVersion  Int?
  onlineVersion  Int?
  reviewStatus   String?
  publishStatus  String?
  title          String
  description    String              @db.Text
  coverUrl       String
  language       String              @default("en")
  regions        Json?
  playCount      Int                 @default(0)
  likeCount      Int                 @default(0)
  favoriteCount  Int                 @default(0)
  shareCount     Int                 @default(0)
  status         AlbumStatus         @default(DRAFT)
  episodes       Episode[]
  translations   AlbumTranslation[]
  genres         AlbumGenre[]
  homeItems      HomeBlockItem[]
  favorites      Favorite[]
  likes          Like[]
  shareEvents    ShareEvent[]
  adRevenues     AdRevenue[]
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  @@index([status, updatedAt])
  @@index([status, playCount])
  @@index([status, createdAt])
}

model Episode {
  id                 String                   @id @default(cuid())
  albumId            String
  tiktokEpisodeId    String?                  @unique
  byteplusVid        String?                  @unique
  tiktokCoverPicId   String?
  byteplusCoverUrl   String?
  episodeNo          Int
  title              String
  description        String?                  @db.Text
  coverUrl           String?
  durationMs         Int?
  isFree             Boolean                  @default(false)
  sortOrder          Int
  status             EpisodeStatus            @default(DRAFT)
  album              Album                    @relation(fields: [albumId], references: [id], onDelete: Cascade)
  translations       EpisodeTranslation[]
  uploadJobs         UploadJob[]
  watchProgresses    WatchProgress[]
  unlocks            EpisodeUnlock[]
  homeTargetItems     HomeBlockItem[]           @relation("HomeTargetEpisode")
  qualityEvents      PlaybackQualityEvent[]
  adRevenues         AdRevenue[]
  createdAt          DateTime                 @default(now())
  updatedAt          DateTime                 @updatedAt

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

model AlbumTranslation {
  id          String   @id @default(cuid())
  albumId     String
  locale      String
  title       String
  description String   @db.Text
  coverUrl    String?
  album       Album    @relation(fields: [albumId], references: [id], onDelete: Cascade)

  @@unique([albumId, locale])
  @@index([locale, albumId])
}

model EpisodeTranslation {
  id          String   @id @default(cuid())
  episodeId   String
  locale      String
  title       String
  description String?  @db.Text
  coverUrl    String?
  subtitleRef String?
  episode     Episode  @relation(fields: [episodeId], references: [id], onDelete: Cascade)

  @@unique([episodeId, locale])
  @@index([locale, episodeId])
}

model Genre {
  id           String       @id @default(cuid())
  slug         String       @unique
  name         String
  translations Json?
  albums       AlbumGenre[]
  createdAt    DateTime     @default(now())
}

model AlbumGenre {
  albumId String
  genreId String
  album   Album @relation(fields: [albumId], references: [id], onDelete: Cascade)
  genre   Genre @relation(fields: [genreId], references: [id], onDelete: Cascade)

  @@id([albumId, genreId])
  @@index([genreId, albumId])
}

model HomeBlock {
  id         String          @id @default(cuid())
  type       HomeBlockType
  title      String
  enabled    Boolean         @default(true)
  sortOrder  Int
  config     Json?
  startsAt   DateTime?
  endsAt     DateTime?
  items      HomeBlockItem[]
  updatedAt  DateTime        @updatedAt

  @@unique([type])
  @@index([enabled, sortOrder])
}

model HomeBlockItem {
  id              String     @id @default(cuid())
  blockId         String
  albumId         String?
  targetEpisodeId String?
  imageUrl        String?
  linkPath        String?
  sortOrder       Int
  startsAt        DateTime?
  endsAt          DateTime?
  block           HomeBlock @relation(fields: [blockId], references: [id], onDelete: Cascade)
  album           Album?    @relation(fields: [albumId], references: [id], onDelete: SetNull)
  targetEpisode   Episode?  @relation("HomeTargetEpisode", fields: [targetEpisodeId], references: [id], onDelete: SetNull)

  @@index([blockId, sortOrder])
  @@index([albumId])
  @@index([targetEpisodeId])
}

model Favorite {
  id        String   @id @default(cuid())
  userId    String
  albumId   String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  album     Album    @relation(fields: [albumId], references: [id], onDelete: Cascade)

  @@unique([userId, albumId])
  @@index([userId, createdAt])
}

model Like {
  id        String   @id @default(cuid())
  userId    String
  albumId   String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  album     Album    @relation(fields: [albumId], references: [id], onDelete: Cascade)

  @@unique([userId, albumId])
  @@index([albumId, createdAt])
}

model ShareEvent {
  id        String   @id @default(cuid())
  userId    String?
  albumId   String
  channel   String?
  deepLink  String?
  createdAt DateTime @default(now())
  user      User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  album     Album    @relation(fields: [albumId], references: [id], onDelete: Cascade)

  @@index([albumId, createdAt])
  @@index([userId, createdAt])
}

model SearchEvent {
  id          String   @id @default(cuid())
  userId      String?
  query       String
  locale      String
  resultCount Int
  createdAt   DateTime @default(now())
  user        User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([query, createdAt])
  @@index([locale, createdAt])
}

model PlaybackQualityEvent {
  id            String   @id @default(cuid())
  userId        String?
  episodeId     String
  sessionId     String?
  eventType     String
  startupMs     Int?
  currentTimeMs Int?
  bufferMs      Int?
  networkType   String?
  definition    String?
  clientVersion String?
  errorCode     String?
  createdAt     DateTime @default(now())
  user          User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  episode       Episode  @relation(fields: [episodeId], references: [id], onDelete: Cascade)

  @@index([episodeId, createdAt])
  @@index([eventType, createdAt])
}

model AdRevenue {
  id              String   @id @default(cuid())
  reportDate      DateTime
  adType          AdType
  placementId     String
  albumId         String?
  episodeId       String?
  reportKey       String   @unique
  impressions     Int      @default(0)
  completedViews  Int      @default(0)
  revenueMicros   BigInt   @default(0)
  currency        String   @default("USD")
  source          String
  ingestedAt      DateTime @default(now())
  album           Album?   @relation(fields: [albumId], references: [id], onDelete: SetNull)
  episode         Episode? @relation(fields: [episodeId], references: [id], onDelete: SetNull)

  @@index([reportDate, albumId, episodeId])
  @@index([placementId, reportDate])
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
5. 首页只读取 `enabled = true` 且处于有效期内的 `HomeBlock`；手动配置的项目也必须经过线上状态过滤。
6. 点赞、收藏采用 `(userId, albumId)` 唯一约束，取消操作只删除关系并同步计数。
7. `AlbumTranslation` 和 `EpisodeTranslation` 按 `(contentId, locale)` 唯一；缺少目标语种时按默认语种回退，并记录回退状态。
8. `SearchEvent` 记录规范化后的查询词、语种和结果数量；对超长、敏感和高频查询做限流与脱敏。
9. `PlaybackQualityEvent` 只保存排障所需的聚合指标，不保存视频内容、完整用户轨迹或访问令牌。
10. `AdEvent` 是分析和风控记录，不作为“广告真实结算”的唯一依据；`AdRevenue` 只接收 TikTok 平台报表或官方可验证的收益数据。
11. `AdRevenue.reportKey` 使用平台报表行 ID；若报表没有稳定行 ID，则由 `reportDate + placementId + adType + albumId + episodeId + source + currency` 生成确定性哈希，保证重复导入不会重复入账。

---

## 8. API 设计

### 8.1 通用约定

```text
Base URL：https://api.example.com/api/v1
格式：JSON
认证：需要身份的接口使用 Authorization: Bearer <business-session-token>；公开浏览接口允许无 token
时间：ISO 8601，例如 2026-09-08T10:00:00.000Z
ID：字符串（cuid/平台 ID），前端不可假定为数字
```

接口认证分三类：

```text
否：完全公开，不读取用户身份
可选：无 token 时返回公开内容；有 token 时额外返回进度、解锁、收藏、点赞等用户态
是：必须登录，失败返回 401，并由前端触发登录后重试用户原动作
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
| `GET` | `/home` | 可选 | 首页五类推荐板块，支持语言和缓存版本 |
| `GET` | `/albums` | 可选 | 线上专辑列表，支持分页 |
| `GET` | `/genres` | 可选 | 题材分类列表 |
| `GET` | `/genres/:slug/albums` | 可选 | 按题材筛选线上专辑 |
| `GET` | `/search` | 可选 | 剧名/题材模糊搜索，无结果返回推荐兜底 |
| `GET` | `/albums/:albumId` | 可选 | 专辑详情 |
| `GET` | `/albums/:albumId/episodes` | 可选 | 剧集目录及用户解锁状态 |
| `PUT` | `/albums/:albumId/like` | 是 | 点赞或取消点赞 |
| `PUT` | `/albums/:albumId/favorite` | 是 | 收藏或取消收藏 |
| `POST` | `/albums/:albumId/share` | 可选 | 生成深链并记录分享事件 |
| `GET` | `/episodes/:episodeId/play` | 条件 | 校验内容、地区、解锁和官方播放器要求；需要身份时再强制登录 |
| `PUT` | `/me/watch-progress` | 是 | 保存观看进度 |
| `GET` | `/me/watch-progress` | 是 | 获取最近观看记录 |
| `GET` | `/me/history` | 是 | 个人中心观看记录，按最近观看排序 |
| `GET` | `/me/favorites` | 是 | 个人中心收藏夹 |
| `GET` | `/me/preferences` | 是 | 获取语言和基础设置 |
| `PUT` | `/me/preferences` | 是 | 更新语言和基础设置 |
| `POST` | `/episodes/:episodeId/reward-unlock` | 是 | 在前端确认完整看完广告后，幂等解锁剧集 |
| `POST` | `/ad-events` | 是 | 记录广告请求、展示、关闭、失败事件 |
| `POST` | `/playback-quality-events` | 是 | 上报首帧、卡顿、清晰度、错误等质量事件 |

#### `GET /home`

响应示例：

```json
{
  "locale": "es",
  "cacheVersion": "home_2026-09-10T10:00:00Z",
  "blocks": [
    {
      "type": "CONTINUE_WATCHING",
      "title": "Continue watching",
      "items": []
    },
    {
      "type": "CAROUSEL",
      "title": "Featured",
      "items": [
        {
          "albumId": "alb_001",
          "title": "The Last Summer",
          "coverUrl": "https://...",
          "deepLink": "/albums/alb_001"
        }
      ]
    }
  ],
  "feed": {
    "items": [],
    "nextCursor": "cursor_or_null"
  }
}
```

实现要求：

```text
首页接口一次返回板块配置和首屏数据，避免前端串行请求造成白屏
继续观看只返回未完成记录；无记录时隐藏或返回空状态
feed 使用 cursor 分页，不允许用 page + offset 扫描大库
服务端按 locale 选择翻译，缺失时回退默认语种
响应带 cacheVersion；前端按 locale 缓存最近一次成功结果
```

#### `GET /search`

```text
GET /search?q=drama&locale=en&cursor=<optional>&limit=20
```

搜索范围为专辑标题、翻译标题、题材 slug 和题材翻译。输入使用 250-400ms 防抖；结果为空时返回 `fallbackItems`，并写入 `SearchEvent`。

#### 互动接口

```text
PUT /albums/:albumId/like       { "active": true }
PUT /albums/:albumId/favorite   { "active": true }
POST /albums/:albumId/share     { "channel": "copy_link" }
```

点赞和收藏接口必须幂等，返回最新状态和计数。分享接口返回：

```json
{
  "deepLink": "/albums/alb_001",
  "title": "The Last Summer",
  "coverUrl": "https://...",
  "shareCount": 12
}
```

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

- 免费或已解锁时返回官方播放器需要的安全播放信息；`albumId`、`episodeId`、`vid` 是当前示例字段，提交前以官方 Player Reference 为准。
- 如果官方播放器或产品策略要求播放前必须登录，则未登录时返回 `401 UNAUTHORIZED`，前端在用户点击播放后触发登录；不能在首页首屏白屏等待登录。
- TikTok 旧版客户端需要短期播放凭证时，由后端服务端调用对应的官方播放凭证接口后再返回；具体版本线、字段名和参数以当前官方文档为准，只在确认即将播放时获取，不做长期缓存。
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

`albumId`、`episodeId`、`vid` 是播放专用的第三方平台标识示例，不是本地数据库主键。前端把它们交给播放器适配器；`playAuthToken` 只作为旧版客户端兼容示例字段，不能当作登录 token 或业务解锁凭证。

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
  "clientEventId": "uuid-generated-on-client",
  "isEnded": true
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

前端交互必须遵循以下顺序：

```text
用户点击锁定集
-> 立即创建并展示 Rewarded Ad，不再要求用户额外点击“解锁”按钮
-> isEnded === true
-> POST /episodes/:episodeId/reward-unlock
-> 刷新该集 access 状态
-> 自动调用 GET /episodes/:episodeId/play
-> VePlayer 自动开始播放
```

用户中途关闭、广告加载失败或解锁请求失败时，目标集仍保持锁定，并展示可重试提示；不得把失败状态误记为已解锁。

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
| `GET` | `/admin/home-blocks` | 查看首页板块开关、顺序和内容配置 |
| `PATCH` | `/admin/home-blocks/:blockId` | 修改首页板块配置 |
| `POST` | `/admin/home-blocks/:blockId/items` | 添加轮播/置顶内容 |
| `PATCH` | `/admin/home-blocks/:blockId/items/:itemId` | 修改推荐项和有效期 |
| `GET` | `/admin/genres` | 管理题材及多语言名称 |
| `PATCH` | `/admin/episodes/:episodeId/access` | 修改免费/激励广告解锁规则 |
| `POST` | `/admin/translations` | 管理专辑和剧集多语言版本 |
| `GET` | `/admin/analytics/overview` | 查看播放、互动、搜索和留存指标 |
| `GET` | `/admin/analytics/revenue` | 查看广告收益、展示量和每集收益归因 |
| `POST` | `/admin/analytics/revenue/import` | 导入 TikTok 官方收益报表 |
| `GET` | `/admin/analytics/playback-quality` | 查看首帧、卡顿、错误和清晰度指标 |

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

> 上述脚本地址、`init` 方法、参数名和全局对象名均为实施示例，不是稳定生产契约。编码前必须从当前 TikTok Minis SDK/API Reference、Portal 配置和 `minis dev` 运行结果确认 SDK 加载方式、版本、初始化时机及失败行为。实际 Vite 环境变量是否可在内联脚本中直接替换，也需在本地构建验证；若不支持，在 `main.tsx` 中读取 `import.meta.env.VITE_TIKTOK_CLIENT_KEY` 并在 React 启动前调用实际 SDK 的初始化方法。无论哪种写法，都必须在调用登录、广告或播放器 API 前完成初始化。

### 9.2 TypeScript 类型声明

`apps/mini-web/src/types/ttminis.d.ts`：

```ts
// 仅用于说明适配层边界。提交前请按当前 SDK/API Reference 生成或修订类型，
// 不要把此处的字段、事件名和方法签名当作平台永久契约。
declare global {
    interface Window {
    TTMinis?: {
      init(options: { clientKey: string }): void;
      login(): Promise<{ code: string }>;
      canIUse(apiName: string): boolean;
      // getPlayer 及其 channel 参数仅为当前示例，需以实际 SDK 能力为准。
      getPlayer?: (...args: unknown[]) => Promise<VePlayerConstructor>;
      createRewardedVideoAd(options: { adUnitId: string }): RewardedVideoAd;
      createInterstitialAd(options: { adUnitId: string }): InterstitialAd;
    };
  }
}

interface VePlayerConstructor {
  // 下面的构造参数是适配器示例，不代表所有 SDK 版本都支持。
  new (options: {
    id?: string;
    root?: HTMLElement;
    vid?: string;
    albumId?: string;
    episodeId?: string;
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

这只是首期适配器类型草稿。`getPlayer` 是否存在、播放器构造函数如何获得、`albumId`/`episodeId`/`vid` 是否必填、播放凭证是否需要、事件名称和事件数据结构，都必须在实现前逐项对照当前 SDK/API Reference 并在 TikTok 真机验证。若官方 SDK 没有公开某个方法，类型声明不能通过 `as any` 强行补出能力；应把能力标记为不可用或进入平台确认状态。

### 9.3 TikTok 登录和匿名会话

`apps/mini-web/src/features/auth/login.ts`：

```ts
import { apiClient } from '../../lib/api-client';

export async function tryLoginWithTikTok(): Promise<boolean> {
  const minis = window.TTMinis;

  if (!minis) {
    return false;
  }

  try {
    const { code } = await minis.login();
    const response = await apiClient.post('/auth/tiktok/login', { code });

    sessionStorage.setItem('quickreels_access_token', response.accessToken);
    return true;
  } catch {
    // 公开首页和详情仍可使用；需要身份的动作再提供显式重试。
    return false;
  }
}
```

启动时调用 `tryLoginWithTikTok()` 只用于恢复已有登录态，不得把失败当成页面初始化失败。前端必须区分：

```text
ANONYMOUS：可以浏览公开首页、详情和公开目录
AUTHENTICATING：正在尝试 TikTok Login
AUTHENTICATED：已有业务会话
AUTH_FAILED：静默登录失败，等待用户在需要身份的动作上重试
```

前端只把 `code` 交给后端。后端使用 `TIKTOK_CLIENT_SECRET` 调 OAuth API；该 Secret 永远不能进入前端。点赞、收藏、历史、个性化继续观看、广告解锁和官方播放器要求登录的场景，应在动作发生时触发显式登录。

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

### 9.6 官方播放器适配实现

Mini Drama 默认必须使用 TikTok Minis 官方指定播放器。当前文档以 VePlayer 作为适配器示例，但当前 App 是否有资格、SDK 是否暴露该能力、构造参数和事件名，必须以提交前的官方 Player Reference、Portal 权限和真机结果为准。不得把当前示例直接视为已获得资格。

`apps/mini-web/src/features/player/create-player.ts`：

```ts
type PlayInfo = {
  // 字段名和必填性以当前 Player Reference 为准。
  albumId?: string;
  episodeId?: string;
  vid?: string;
  playAuthToken?: string | null;
};

export async function createDramaPlayer(
  root: HTMLElement,
  info: PlayInfo,
) {
  const minis = window.TTMinis;
  if (!minis) throw new Error('TikTok Minis SDK is unavailable.');

  // 仅在资格、SDK 能力和参数已由平台核验后执行。这里的调用形式是伪代码。
  if (!minis.getPlayer) {
    throw new Error('The official drama player capability is unavailable.');
  }
  const VePlayer = await minis.getPlayer('byteplus');
  const player = new VePlayer({
    root,
    vid: info.vid,
    albumId: info.albumId,
    episodeId: info.episodeId,
    lang: 'en',
    getVideoByToken: {
      // 是否需要该对象、字段名和 token 来源必须按实际版本确认。
      playAuthToken: info.playAuthToken ?? undefined,
      needPoster: true,
    },
  });

  player.on('timeupdate', (data) => {
    // `timeupdate` 仅为示例；生产代码使用 SDK 暴露的事件常量和数据结构。
    const currentTime = (data as { currentTime?: number } | undefined)?.currentTime;
    if (typeof currentTime === 'number') void currentTime;
  });

  return player;
}
```

以上代码只表达适配器的职责和错误边界，不能直接复制为生产实现。React 页面必须在卸载时销毁实例，并保证一个容器只对应一个播放器实例。切换下一集时，是否存在 `playNext`、其参数格式以及是否允许复用实例，均由当前播放器 SDK 决定；不支持时再销毁旧实例并创建新实例。`VePlayer` 的构造参数、事件常量、字段名、播放凭证和返回对象必须以当前 SDK/Player Reference 为准。

生产代码应通过 `DramaPlayerAdapter` 隔离第三方 SDK：

```text
前端 GET /episodes/:episodeId/play
-> QuicK ReeLS API 校验访问策略和内容状态
-> 返回当前官方播放器需要的安全播放信息
-> DramaPlayerAdapter.create()
-> 官方播放器按 Player Reference 创建实例
```

不要：

```text
不要把 byteplus_url 写进 <video src>
不要在前端调用 BytePlus AK/SK 签名接口
不要把 TikTok access_token 当作播放器 token 返回
不要只用本地 episodeId 而漏传官方要求的专辑/剧集标识
不要在未确认播放器资格前把自研播放器作为默认生产路线
```

适配器至少提供：

```ts
interface DramaPlayerAdapter {
  canUse(): boolean;
  create(root: HTMLElement, info: Record<string, unknown>): Promise<{
    play(): Promise<void> | void;
    destroy(): void;
    on(event: string, callback: (data?: unknown) => void): void;
  }>;
}
```

适配器初始化前应完成一次运行时能力探测，并把结果写入诊断日志（不得记录 token）：

```text
SDK 已加载 -> 初始化成功 -> 官方播放器能力可探测
-> 当前 App/版本/地区具备资格 -> 参数和事件通过真机验证
-> 才允许把 PLAYBACK_READY 作为生产能力
```

如果上述任一项失败，前端应显示“当前环境暂不支持播放”或可重试状态，后端和运营后台也应能看到阻塞原因。不能把一个未验证的构造函数调用包装成成功，也不能在没有官方书面许可的情况下静默切换到原生 `<video>`、第三方播放器或自研播放器。

如果官方确认当前 App 不具备 VePlayer 资格，只有在官方明确允许替代方案后才实现 `AlternativePlayerAdapter`。未获得确认时，状态应为“播放能力待平台确认”，不能用自研播放器悄悄替代，也不能把该路线写入 M3/M8 的必然完成条件。

### 9.7 播放与进度保存策略

```text
开始播放：读取 /episodes/:episodeId/play 的 resumePositionMs；若该接口要求登录，先在播放动作触发登录
每 15 秒：已认证时 PUT /me/watch-progress；匿名状态先写本地临时进度
暂停：已认证时保存进度
切换剧集：保存旧剧集进度，再加载新剧集
页面隐藏/卸载：已认证时尽力保存进度
播放结束：已认证时 positionMs = durationMs，completed = true
登录成功：按合并规则把匿名临时进度与服务端记录合并，不得无提示覆盖较新的服务端进度
```

播放实现必须对接已确认有资格使用的 TikTok Mini Drama 官方指定播放器，并使用当前官方 API 返回的播放信息。`album_id`、`episode_id`、`vid` 仅是当前适配器示例字段，提交前必须按 Player Reference 核对。不要自行以 `<video src="裸 MP4/HLS 地址">` 代替官方流程。

### 9.8 前端状态

建议拆分：

```text
authStore：业务 token、当前用户、匿名/登录中/已登录/失败状态
playerStore：当前专辑、当前剧集、播放状态、最近进度
adStore：当前广告展示中状态，防止用户重复点击
TanStack Query：专辑、剧集、进度等服务端缓存
```

### 9.9 首页、搜索、个人中心和国际化实现

前端页面与行为：

```text
HomePage
  -> 首次渲染读取本地 home cache
  -> 请求 GET /home
  -> 按服务端 sortOrder 渲染五类板块
  -> feed 触底时用 nextCursor 加载下一批
  -> 网络失败时保留缓存并显示可刷新状态

AlbumPage
  -> 展示标题、简介、题材、热度和互动状态
  -> 点击锁集直接调用 rewarded-ad.ts
  -> 详情页继续观看跳转最近未完成剧集的 resumePositionMs

SearchPage
  -> 顶部搜索框，250-400ms 防抖
  -> 搜索结果为空时展示 fallbackItems

ProfilePage
  -> 观看记录、收藏夹、语言切换、基础设置
  -> 点击记录直接进入对应剧集并恢复断点
```

国际化要求：

```text
内置 UI 文案使用 locale 字典，不把可见中文/英文散落在组件逻辑中
默认 locale：读取 TikTok/系统语言，未支持时回退 en
手动切换：PUT /me/preferences 后立即刷新 Query 缓存和页面文案
内容语言：请求 /home、/search、/albums 时携带 locale
剧集多版本：按 episode translation/variant 选择播放器语言；无对应版本时明确回退
分享深链携带 albumId、locale 和可选 episodeId
```

### 9.10 播放器连续播放和体验监控

播放器事件处理：

```text
首帧：记录 startupMs
timeupdate：每 15 秒保存进度
waiting/stalled：记录卡顿开始和持续时间
definitionchange：记录清晰度变化
error：记录错误码和当前剧集
ended：保存 completed=true，计算下一集
```

连续播放规则：

```text
当前集结束
-> 计算下一集
-> 按插屏频控判断是否展示 Interstitial
-> 广告关闭或失败
-> 预取下一集播放元信息
-> 使用 playNext 或销毁重建 VePlayer
-> 自动播放下一集
```

播放器必须提供下一集倒计时和“跳过”操作；倒计时期间用户可取消自动播放。播放凭证接近过期或播放器返回鉴权错误时，重新请求 `/episodes/:episodeId/play` 并无感重建播放器，最多重试一次。

弱网策略：

```text
优先使用 VePlayer 官方自适应码率能力
记录当前 definition、bufferMs、networkType
连续卡顿超过阈值时提示重试，并允许用户手动选择较低清晰度（若 SDK 支持）
首帧或播放错误不能无限转圈，必须进入错误状态
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
公开业务请求
  -> 可不携带业务 JWT
  -> 服务端以 ANONYMOUS 身份读取公开首页、专辑详情、公开目录和公开搜索结果

POST /auth/tiktok/login
  -> 接收前端 TikTok Login API 返回的 code
  -> 后端调用当前官方 OAuth token endpoint
  -> 使用官方返回的稳定用户标识查询/创建 User
  -> 签发短期业务 JWT
  -> 前端携带 JWT 请求需要身份的 QuicK ReeLS API

强制认证路由
  -> 校验业务 JWT
  -> 缺失或失效时返回 401
  -> 前端提供登录/重试入口，不把公开页面变成白屏
```

要求：

- OAuth 请求只在后端执行。
- `TIKTOK_CLIENT_SECRET` 仅从安全环境变量读取。
- `code` 只可用一次，失败时返回通用错误，不记录原始 code。
- 公开接口（例如 `/home`、公开专辑详情、公开目录、公开搜索）不应因为静默登录失败而失败。
- 点赞、收藏、观看记录、个性化继续观看、Rewarded 解锁等需要身份的动作必须走强制认证路由。
- `/episodes/:episodeId/play` 是否强制认证，取决于该剧访问策略、官方播放器资格和最终产品规则；匿名可以浏览公开内容，但不能绕过解锁或平台要求。
- Token 过期由前端重新尝试登录恢复；恢复失败时保留匿名状态，并允许用户显式重试。

建议把路由分为三类：

```text
PUBLIC：允许匿名，返回公开内容
OPTIONAL_AUTH：有 JWT 时返回个性化字段，无 JWT 时返回匿名默认值
REQUIRE_AUTH：没有有效 JWT 直接 401
```

服务端不要把“前端调用了静默登录”当作已认证依据，只信任服务端验证过的业务 JWT。

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

这里有三类可能的服务端授权，不能混用：

```text
用户登录：前端 TTMinis.login() code -> /auth/tiktok/login -> TikTok OAuth -> QuicK ReeLS 用户会话
TikTok 短剧媒资：QuicK ReeLS API -> TikTok Short Drama/Media Asset Open API 授权流程
BytePlus VOD V1.0：Node.js API/Worker -> @byteplus/vcloud-sdk-nodejs 或 V1.0 签名 OpenAPI
BytePlus VOD V2.0：Go/Python/Java V2 Worker -> StartExecution/GetExecution
```

如果当前 API 采用应用级 access token，后端可以缓存到过期前并自动刷新；如果采用其他授权方式，应按官方流程实现。TikTok 媒资授权、BytePlus V1.0 AK/SK、BytePlus V2.0 AK/SK、用户登录 token 和播放器临时凭证都是不同用途的凭证，不能互相替代。调用视频、图片、上传任务、播放和工作流接口时，按对应版本的官方 API Reference 使用相应的 Authorization、client key、签名或 SDK 配置，不能从本示例推导固定请求头。

#### 10.5.1 BytePlus OpenAPI 路由表

BytePlus VOD 调用必须先经过版本路由，再进入具体 SDK。下面是本项目当前的路由基线：

| BytePlus 能力 | API/方法 | 版本 | 调用方 | 备注 |
| --- | --- | --- | --- | --- |
| 工作流执行 | `StartExecution` | V2.0 | V2 Worker | 当前官方 V2.0 支持 |
| 工作流查询 | `GetExecution` | V2.0 | V2 Worker | 与 `StartExecution` 配套轮询 |
| URL 上传 | `UploadMediaByUrl` | V1.0 | Node.js API/Worker | V2.0 尚未提供 |
| 上传任务查询 | `QueryUploadTaskInfo` | V1.0 | Node.js API/Worker | V2.0 尚未提供 |
| 服务端本地文件上传 | `ApplyUploadInfo` + `CommitUploadInfo` 或 V1.0 `UploadMedia` | V1.0 | Node.js API/Worker | 以当前 V1.0 Node SDK 和 API Reference 为准 |
| 播放信息/临时播放 Token | `GetPlayInfo` / `GetPlayAuthToken` | V1.0 | Node.js API | V2.0 尚未提供；只返回最小必要信息 |

其中，`StartExecution`/`GetExecution` 属于 BytePlus VOD V2.0；它们不是 TikTok Short Drama 的专辑审核或上架接口。TikTok Short Drama 的专辑、剧集、审核和 listing 仍由 TikTok 官方 Open API 负责。不要因为两个系统都涉及视频，就把 TikTok API 错接到 BytePlus V2 SDK。

V2 Worker 的最小内部接口可以设计为：

```ts
interface BytePlusVodV2Client {
  startExecution(input: Record<string, unknown>): Promise<{ runId: string }>;
  getExecution(input: { runId: string }): Promise<Record<string, unknown>>;
}
```

该接口是 QuicK ReeLS 的内部 DTO，不是 BytePlus 官方方法签名。V2 Worker 应在自己的语言中使用官方 `vod20250701` SDK 客户端和模型；Node.js 只调用内部适配接口，不直接伪造 V2 SDK 类型。

以下是服务适配器需要覆盖的业务概念，不是对当前官方 API 路径、字段或返回值的承诺（具体区域前缀、字段、授权方式和枚举以 API Reference 为准）：

| 能力 | 后端调用结果 | QuicK ReeLS 应保存 |
| --- | --- | --- |
| 异步上传视频 | 远端任务标识，完成后得到平台媒资标识 | `providerJobId`、平台视频 ID、`durationMs`、封面元数据（仅后端/运营使用） |
| 上传图片 | 平台图片标识或等价资源标识 | `tiktokCoverPicId` 或当前 API 对应字段、可展示的封面地址 |
| 创建/更新专辑版本 | 平台专辑/版本/剧集标识映射 | `tiktokAlbumId`、当前版本、每集 `tiktokEpisodeId` 或等价字段 |
| 查询专辑 | 审核状态、在线版本、上架状态 | `reviewStatus`、`onlineVersion`、`publishStatus` |
| 设置在线版本/上架 | 平台状态更新 | 本地 `ONLINE`/`OFFLINE` 状态和审计日志 |
| 获取播放信息 | 当前播放器所需的标识或短期凭证（若该版本需要） | 仅保存必要的非敏感映射；临时凭证不持久化 |

后端接口可设计为：

```ts
interface TikTokShortDramaService {
  // 以下是内部适配器接口，不等同于官方 API 方法名。
  createVideoUpload(input: {
    sourceUrl: string; // 只有当前官方上传流程要求 URL 时才使用
    title: string;
    providerContext?: Record<string, unknown>;
  }): Promise<{ providerJobId: string; providerVideoId?: string }>;

  getVideoUploadStatus(input: {
    providerJobId?: string;
    providerVideoId?: string;
  }): Promise<{
    status: 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
    providerVideoId?: string;
    providerUrl?: string; // 仅服务端排障使用，不返回用户端
    coverUrl?: string;
    durationMs?: number;
    errorMessage?: string;
  }>;

  uploadCover(input: { imageUrl: string }): Promise<{ providerImageId: string }>;
  createAlbum(input?: Record<string, unknown>): Promise<{ providerAlbumId: string; version?: number }>;
  updateAlbum(input: {
    providerAlbumId: string;
    version?: number;
    album: Record<string, unknown>;
    episodes: Array<Record<string, unknown>>;
  }): Promise<{ version?: number; episodeIdMap?: Record<string, string> }>;
  queryAlbum(input: { providerAlbumId: string; version?: number }): Promise<unknown>;
  submitReview(input: { providerAlbumId: string; version?: number }): Promise<void>;
  setOnlineVersion(input: { providerAlbumId: string; version?: number }): Promise<void>;
  setListing(input: { providerAlbumId: string; listed: boolean }): Promise<void>;
  getPlaybackInfo?(input: { providerEpisodeId: string }): Promise<Record<string, unknown>>;
}
```

`sourceUrl` 只有在当前官方上传流程明确要求服务端可下载 URL 时才使用；若原片只在本地电脑，才放到受保护、限时有效的上传源地址，任务完成后立即失效。若官方提供其他上传方式，应优先采用官方当前推荐方式。具体 API path、签名/Authorization、地区参数、BytePlus account 绑定、字段、审核状态和播放器信息获取方式必须按当前官方 API Reference 实现；不要把本实施文档或附件示例中的字段名当作永久不变的生产契约。

`getPlaybackInfo` 是可选适配器能力：某些官方播放器版本可能只需要平台媒资/专辑/剧集标识，由客户端按平台规则获取播放能力；另一些版本可能需要服务端返回短期播放信息。后端应根据实测版本返回最小必要字段，绝不能为了满足示例接口强行生成或伪造 `playAuthToken`。

### 10.6 上传任务 Worker

首期 Worker 每 30 秒查询一次 `PENDING`/`PROCESSING` 任务：

```text
PENDING：按 10.5.1 的版本路由调用 TikTok Short Drama Open API 或 BytePlus VOD V1.0，保存 providerJobId，置 PROCESSING
PROCESSING：查询 TikTok/BytePlus 远端状态；若任务属于 BytePlus V2 工作流，交给 V2 Worker 调用 GetExecution
SUCCEEDED：更新 Episode.byteplusVid、封面/时长和 Episode.status = READY
FAILED：保存脱敏错误，Episode.status = ERROR
```

重试建议：

```text
网络/5xx：指数退避，最多 5 次
鉴权/参数/内容审核错误：不自动无限重试，转人工处理
每次重试写审计日志
```

### 10.7 首页、搜索、互动和播放质量服务

`RecommendationService` 负责组装首页和列表：

```text
读取 HomeBlock 配置
-> 按 locale 过滤并翻译内容
-> 继续观看从 WatchProgress 读取用户最近未完成记录
-> 轮播和运营位从 HomeBlockItem 读取
-> 热门按 playCount、completedViews、近期播放权重排序
-> 新作按上线时间排序
-> feed 使用 cursor 分页兜底所有线上内容
```

`InteractionService` 负责点赞、收藏和分享：

```text
点赞/收藏在事务中 upsert 或 delete 关系
-> 同步 Album.likeCount / favoriteCount
-> 返回最新 active 状态和计数
分享记录 ShareEvent，增加 shareCount，返回深链
```

`SearchService` 负责搜索与搜索词沉淀：

```text
规范化 query：trim、大小写折叠、长度限制
-> 搜索 Album/AlbumTranslation/Genre
-> 过滤 OFFLINE、REVIEWING、地区和语种不可见内容
-> 无结果时返回热门或新作 fallbackItems
-> 写入 SearchEvent(query, locale, resultCount)
```

`AnalyticsService` 负责播放质量：

```text
接收 startup、buffer、definitionchange、error、ended 等事件
按 episodeId、clientVersion、networkType 聚合排查指标
后台至少展示：平均首帧、卡顿率、错误率、连续播放成功率
```

### 10.8 广告收益回流与每集归因

PRD 要求后台能看到“这一集带来了多少钱”。实现方式分两层：

```text
业务层：AdEvent 记录用户、placement、episode、广告展示/关闭/失败
财务层：AdRevenue 接收 TikTok 官方报表或平台可验证收益数据
```

分期边界：

```text
V1 必做：
  AdEvent、广告完播解锁、插屏频控、本地漏斗和事件审计

运营/财务流程：
  导入 TikTok 官方 IAA 报表，区分平台精确收益和按事件分摊的估算收益

后续阶段：
  Middle Funnel Event Postback、Smart+ 广告 API、短剧商品库 API
```

收益导入流程：

```text
运营或定时任务导入 TikTok IAA 报表
-> 按 reportDate、placementId、adType 聚合
-> 能精确到 episodeId 时直接写入
-> 只能到 placement 级别时，按同日同 placement 的 completed AdEvent 权重分摊到 episode
-> 后台展示“估算”或“平台精确”来源，不能混同
```

后台核心指标：

```text
每集展示次数、完整观看次数、估算/精确收益
每部剧累计收益、ARPU、每千次展示收益
锁集点击 -> 广告展示 -> 完播 -> 解锁 -> 起播 的漏斗
搜索无结果词、收藏后次日/7 日回访率
```

`AdEvent` 只能证明客户端或业务链路记录了广告相关动作，不能作为 TikTok 财务结算的唯一依据。前端传入的 placement、episode 或金额都必须由服务端做格式校验和关联校验；平台精确收益以官方报表或官方可验证回传为准。若当前报表无法精确到剧集，后台必须显式标注“估算”，并保留分摊规则、版本和操作审计。

若本次项目明确纳入 Middle Funnel Event Postback、Smart+ 广告 API 或短剧商品库 API，应在立项时单独确认 API 资格、事件定义、归因窗口、地区限制、合同和验收数据源；未纳入时只保留数据模型和扩展接口，不得把预留接口写成 V1 已完成能力。

---

## 11. TikTok Short Drama + BytePlus 内容发布流程

### 11.1 一部剧从文件到用户可看

以下流程描述的是“内容发布业务链路”，不是已经确认的 API 路径。真正进入生产前，必须先完成播放器资格、媒资 API、地区和商业能力门禁；研发阶段可以用 Mock 或测试内容验证流程，但不能因此宣称生产播放和变现已打通。

```text
1. 运营创建 Album（草稿）
2. 运营创建 Episode（草稿）
3. 创建 UploadJob
4. 后端按当前官方媒资 API 的上传方式提交视频；只有 API 明确要求时才使用临时 sourceUrl
5. Worker 轮询远端任务，确认成功后写入平台视频 ID、视频时长和封面元数据
6. 后端按当前官方图片/专辑 API 上传封面并保存平台资源标识
7. 创建/更新 TikTok Short Drama 专辑版本和剧集元数据
8. 按当前官方 API 提交内容审核
9. 审核通过后设置 online version（如该能力适用于当前版本）
10. 执行 listing/publish；仅平台确认可见且播放器资格通过后才允许播放
11. 同步审核、在线版本和上架状态到本地，Album/Episode = ONLINE
12. 用户端 API 开始返回公开内容和当前官方播放器所需的最小播放信息
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

研发测试可使用 `DRAFT`、Mock 播放信息或平台测试环境；生产发布必须额外满足：

```text
播放器资格已由 Portal/官方资料/直客确认
-> 播放器参数、版本和事件已在目标 TikTok 客户端真机验证
-> IAA 合同、能力审批和 Placement 状态满足本次范围
-> Business Center、资产登记、ADV ID 和投放开白（如涉及投放）已完成
-> 目标国家/地区和主体资格已确认
-> 美国市场额外批准和 USDS TPRM（如适用）已完成
```

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
1. 确认本次测试使用的 App、主体、地区和测试账号已获得相应平台权限
2. 确认播放器资格和当前 Player Reference 版本；未确认时只跑页面、接口和 Mock
3. 确认 IAA 合同/能力审批状态，以及两个广告 Placement 是否已创建且 Active
4. 启动 minis dev
5. 在调试页开启 IAA mock（若当前工具链支持）
6. 用 TikTok 测试环境扫码连接
7. 验证匿名首页/详情浏览、登录成功和静默登录失败后的继续浏览
8. 验证激励广告：完整看完 / 中途关闭 / 拉取失败
9. 验证插屏：正常关闭 / 拉取失败 / 客户端不支持
10. 在资格确认后验证官方播放器首帧、进度、连续播放和销毁重建
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
-> 核对 Basic Information、行业资质和目标地区
-> 核对 IAA 合同、Organization IAA 审批和 Rewarded/Interstitial Placement
-> 核对 Business Center、TikTok Minis 资产登记、ADV ID 和投放开白（如涉及）
-> 核对美国批准和 USDS TPRM（如目标市场适用）
-> Submit for review
-> 审批后 Release 到 Production 或 Gray release
```

首次发布只能生产发布。已有生产版本后，才可使用灰度发布。Preview 或审核通过只代表代码资产/版本获得相应认可，不自动代表播放器资格、IAA 收益、投放资格或美国地区准入已经完成；这些能力必须分别通过对应门禁。

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
byteplus-vod-v2-worker（仅在使用 StartExecution/GetExecution 时）
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
-> 若启用 BytePlus V2.0，单独部署 byteplus-vod-v2-worker，并只注入 V2.0 所需 IAM 凭证
-> 执行 Prisma migrate deploy
-> 访问 /health
-> Portal 添加 https://api.example.com 为 Trusted domain
-> Portal 的 Industry solutions 中启用 Media asset management 并绑定 BytePlus 账号/空间
-> 完成 URL ownership verification（如页面要求）
-> 完成 IAA 合同、Organization IAA 能力审批和两个 Placement 配置（如本次启用广告）
-> 配置 Business Center、TikTok Minis 资产登记、ADV ID 和投放开白（如本次涉及投放）
-> 确认目标国家/地区、主体资格、美国批准和 USDS TPRM（如适用）
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
[ ] Service domains、Webhook、URL ownership verification 已按 Portal 要求完成
[ ] 隐私政策和条款 URL 可访问
[ ] Basic Information、企业认证和 Mini Drama 行业资质已批准
[ ] 当前 App 的官方播放器资格已确认，并保留 Portal/官方/直客证据
[ ] 当前 Player Reference、SDK 版本、构造参数和事件已复核
[ ] BytePlus 账号/空间已在本 App 的 Media asset management 中显示 Connected
[ ] 已保存当前 BytePlus VOD V2.0 supported APIs 清单和核验日期
[ ] `StartExecution`/`GetExecution`（如使用）由 Go/Python/Java V2 Worker 调用，未回退到 Node.js V1.0
[ ] V2.0 未覆盖的 Upload/Query/Playback OpenAPI 已明确登记为 V1.0，并由 Node.js V1.0 SDK/适配器调用
[ ] V1.0 与 V2.0 的 AK/SK 按服务隔离，日志和前端均不暴露
[ ] TikTok Short Drama/Media Asset 测试上传任务可成功完成，且 Worker 可得到当前平台视频标识
[ ] 测试专辑审核通过、在线版本已设置（如适用）且已 Listed/Published
[ ] TikTok 内按当前官方播放器契约完成首帧、进度、连续播放和销毁测试
[ ] IAA 合同已签署，Organization IAA 能力已批准（如启用 IAA）
[ ] Rewarded 与 Interstitial Placement 均 Active（如启用 IAA）
[ ] Business Center 已配置，TikTok Minis 资产登记已完成，ADV ID 已取得（如涉及投放）
[ ] 投放开白已完成，或已明确本次不涉及投放
[ ] 目标国家/地区、主体资格和内容可见范围已确认
[ ] 美国市场批准已完成；USDS TPRM 已确认是否适用并完成（如适用）
[ ] 首页五类板块、初始排序、轮播有效期和题材已配置
[ ] 所有已上线专辑至少能从推荐板块或底部信息流到达
[ ] 首批目标语种的 UI 文案、专辑翻译和剧集版本已导入
[ ] 每集免费/激励广告解锁规则已复核，且无需 Mini 发版即可调整
[ ] `/home`、`/search`、个人中心和语言切换在真实 API 环境可用
[ ] 广告收益报表样例可成功导入，重复导入不会重复入账，并能区分精确/估算收益
[ ] 本次是否纳入 Middle Funnel Event Postback 已书面确认；未纳入时不作为 V1 阻塞项
[ ] Smart+ 广告 API、短剧商品库 API 是否纳入本次范围已确认
[ ] 播放、互动、搜索、留存和播放质量看板有初始基线数据
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
11. 分享深链只允许跳转到已上线专辑或剧集；服务端校验 `albumId`、`episodeId`、locale 和地区，不接受开放重定向参数。
12. 搜索词和播放质量事件按最小必要原则留存；查询日志不得保存完整 token、设备指纹或可反推身份的原始参数。
13. 收益报表导入仅限管理员或受控定时任务，必须校验来源、字段和 `reportKey` 幂等性，并写入审计日志。

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
| 首页推荐 | 五类板块开关/排序、运营位有效期、已看标记、feed 游标到底、无网络缓存 |
| 详情互动 | 点赞/取消、收藏/取消、分享深链、计数幂等、跨天状态恢复 |
| 搜索 | 标题/题材匹配、前缀输入、无结果兜底、热门词记录、限流 |
| 多语言 | 系统语言默认值、手动切换、内容版本回退、推荐不串语种 |
| 解锁服务 | 免费、已解锁、首次解锁、剧集下线、重复请求 |
| 进度服务 | 正常更新、负数、超时长、重复更新 |
| 广告频控 | 小于间隔、达到单会话上限、达到观看集数条件 |
| 鉴权 | 缺少 token、过期 token、普通用户访问管理员接口、公开接口匿名可用、可选认证失败不阻塞浏览、强制认证动作返回可恢复的 401 |
| 上传 Worker | 成功、网络重试、远端失败、无效 job_id |
| 播放信息服务 | 未登录、未解锁、非 ONLINE、缺少平台 ID、旧版短期 token、禁止返回裸 URL |
| 播放质量 | 首帧、卡顿、清晰度变化、错误上报和脱敏 |
| 匿名与身份合并 | 匿名观看进度本地保存、登录后与服务端进度按产品规则合并、不得静默覆盖较新的服务端数据 |
| 地区与发布门禁 | 目标地区内容过滤、主体/地区不满足时阻断生产发布、美国市场批准和 USDS TPRM 未完成时阻断美国上线 |
| 广告资格与降级 | Placement 非 Active、客户端不支持或广告加载失败时不错误解锁；插屏失败不阻塞下一集 |
| 收益归因 | 报表导入幂等、每集精确/估算标识、重复导入不重复计入 |

### 15.2 集成测试

```text
登录 code -> 建立业务会话
匿名打开首页/详情/目录 -> 无登录也能完成公开浏览
静默登录失败 -> 页面保持可浏览；点击需要身份的动作时再触发登录
匿名本地进度 -> 登录成功 -> 与服务端进度合并并记录合并结果
创建专辑 -> 创建剧集 -> 建立上传任务 -> 更新状态
上传视频 -> 保存 byteplus_vid -> 更新 TikTok album/episode 元数据 -> 审核 -> online version -> Listed
激励广告完成后的解锁 -> 获取播放信息
获取播放信息 -> 在播放器资格已确认且参数已按当前 Player Reference 验证后，由当前适配器创建官方播放器实例
保存进度 -> 重进播放页恢复进度
首页 `/home` -> 五类板块和 feed 分页
点击锁集 -> 15 秒广告 -> 自动解锁 -> 自动起播
Placement 非 Active/广告失败 -> 明确降级，不错误解锁；插屏失败 -> 继续业务流程
点赞/收藏/分享 -> 详情状态、计数和深链
搜索无结果 -> 推荐兜底 -> SearchEvent
切换语言 -> 界面、推荐和剧集版本同步切换
目标地区不匹配 -> 内容不返回；美国准入未完成 -> 美国生产发布被阻断
导入广告报表 -> 每集收益看板
Middle Funnel 未纳入本次范围 -> 仅保留扩展接口，不阻塞 V1
下线专辑 -> 用户端不再返回
```

### 15.3 TikTok 真机测试矩阵

| 场景 | 预期 |
| --- | --- |
| 冷启动首页 | 1 秒内出现可渲染内容；接口失败时显示缓存 |
| 首页底部信息流 | 持续加载至 `nextCursor = null`，到底有明确提示 |
| 线上剧曝光 | 任意线上剧至少能从推荐板块或 feed 到达 |
| 点击锁定集 | 自动弹激励广告，无额外解锁按钮；完播后自动播放 |
| 搜索已上线剧 | 输入前几个字能找到剧；不存在的词展示兜底内容 |
| 收藏与个人中心 | 收藏后退出再进入，收藏夹可找到并进入详情 |
| 多语言切换 | UI、推荐、标题和剧集版本不串语种 |
| 播放连续 5 集 | 无报错、可自动下一集、有倒计时且可跳过 |
| TikTok 版本 >= 44.2.0 | 广告能力检测成功，可调用广告 API |
| TikTok 旧版本 | 显示兼容提示或直接降级，不崩溃 |
| TikTok Pro Android | IAA 不支持时正常继续基础观看流程 |
| 激励广告完整播放 | 仅本集解锁，可开始播放 |
| 激励广告中途关闭 | 不解锁，页面保持可操作 |
| 激励广告加载失败 | 不解锁，出现重试/稍后再试提示 |
| Rewarded Placement 未 Active | 不进入生产完成态；测试环境显示配置错误或使用 Mock，不伪造真实收益 |
| 插屏正常关闭 | 自动继续进入下一集 |
| 插屏加载失败 | 无感继续进入下一集 |
| Interstitial Placement 未 Active | 不阻断基础观看；生产发布被商业门禁阻断 |
| 弱网或断网 | 明确错误和重试入口，无白屏 |
| BytePlus V2.0 工作流 | 使用 `StartExecution`/`GetExecution` 时由 V2 Worker 调用；不得由 Node.js V1.0 代替 |
| BytePlus V1.0 回退接口 | `UploadMediaByUrl`、`QueryUploadTaskInfo`、上传和播放接口按路由表使用 V1.0；记录 API、版本和调用服务 |
| BytePlus SDK 迁移 | 每次发布前核对 V2.0 supported APIs 清单；已迁移接口不得继续双写或随机回退 |
| 已审核且 Listed 的测试剧集 | 仅在播放器资格、当前 Player Reference、参数和 SDK 能力均已确认后，由当前适配器创建官方播放器并正常首帧播放；未确认时不得标记为生产通过 |
| 草稿、审核中或未 Listed 剧集 | 后端不返回播放信息，VePlayer 不创建 |
| TikTok 旧客户端 | 按当前官方能力矩阵执行：播放成功或明确降级提示；不得因旧版示例固定生成 `play_auth_token` |
| 目标地区过滤 | 用户所在地区不满足内容配置时不返回不可见内容；地区判定失败按产品规则安全降级 |
| 美国市场准入未完成 | 不允许把美国地区标记为生产可用，并在发布检查中阻断 |
| Middle Funnel 仅预留 | 不调用未确认的 API；事件模型和扩展接口可存在，但不作为 V1 完成条件 |

---

## 16. 开发里程碑

| 阶段 | 目标 | 关键交付物 |
| --- | --- | --- |
| M0/P0 | 平台与商业前置 | 播放器资格确认、当前 Player Reference 版本和证据；IAA 合同/Organization 审批；Rewarded/Interstitial Placement 计划与状态；目标地区、主体、美国批准和 USDS TPRM 结论；投放相关的 Business Center、资产登记、ADV ID、开白状态 |
| M1 | 用户端产品骨架 | 首页五类板块、详情互动、搜索、个人中心、多语言页面 |
| M2 | 后端与数据 | Fastify、Prisma、首页/内容/互动/搜索/语言/进度 API |
| M3 | 登录与播放适配 | 匿名浏览与认证分层、TTMinis 初始化；仅在播放器资格和当前 Player Reference 确认后接入真实官方播放器，否则完成适配器、Mock 和阻断态 |
| M4 | 媒资闭环 | BytePlus 绑定、V1.0 上传/查询任务、按需启用 V2.0 `StartExecution`/`GetExecution` Worker、审核、上架状态同步 |
| M5 | 广告变现 | 仅在 IAA 合同、Organization 审批和 Placement 满足条件后接入真实 Rewarded 解锁与 Interstitial 频控；此前使用 Mock/降级 |
| M6 | 数据与运营 | 首页配置、题材管理、收益导入、搜索/互动/播放质量看板 |
| M7 | TikTok 调试与证据 | minis dev、IAA mock、扫码真机验证、播放器参数/事件/版本证据、地区过滤和失败降级记录 |
| M8 | 平台与商业发布 | minis build ZIP、Portal 预览、审核、生产发布；同时满足播放器资格、IAA、地区/主体、投放和美国准入等适用门禁 |

### 每个里程碑的完成定义

```text
M0/P0：所有适用平台、商业、地区和投放前置项均有负责人、状态、证据和阻断结论；未满足项不得标记为生产就绪
M1：五类首页板块、详情互动、搜索、个人中心和语言切换有完整假数据体验
M2：数据库迁移成功，首页/互动/搜索/语言/进度接口有自动化测试
M3：匿名浏览、认证分层和登录失败恢复可用；在播放器资格确认后，按当前 Player Reference 适配并在目标客户端验证官方播放器；未确认时只能完成 Mock/阻断态
M4：一部测试短剧按当前官方媒资流程完成上传、审核、online version/Listed（如适用）和本地 ONLINE 状态同步；不得把 `sourceUrl` 或固定字段写成无条件流程
M5：在适用资格和 Placement 已 Active 后，Rewarded 完播解锁、Interstitial 频控和失败降级通过验证；资格未完成时仅完成 Mock
M6：运营能配置首页、修改免费/锁定规则、导入收益并查看质量数据
M7：在资格确认后，真机验证完整播放、中断、失败和旧版本降级，并保存测试证据；资格未确认时不宣称真实播放完成
M8：代码资产通过审核，且所有适用的平台、商业、地区和投放门禁通过；生产用户可以在已批准范围内正常使用
```

---

## 17. 开发执行顺序

按以下顺序执行可减少返工：

1. 建立 P0 门禁台账：确认当前 App 是否具备 Mini Drama 官方播放器资格，保存 Portal/官方资料/直客证据、负责人、确认日期和适用客户端范围；同步锁定当前 Player Reference 版本。未确认前只允许做适配器、Mock 和页面流程。
2. 确认本次 IAA 范围、合同状态、Organization IAA 审批状态，以及 Rewarded/Interstitial Placement 的创建、地区和 Active 状态；未满足前不得把真实广告写入生产完成条件。
3. 如涉及投放或增长链路，先确认 Business Center、TikTok Minis 资产登记、ADV ID 和投放开白；未确认前只保留接口和 Mock，不承诺投放能力。
4. 确认主体国家/地区、目标发布国家/地区、内容可见地区和美国市场批准；如涉及美国，完成 USDS TPRM 或取得不适用结论。
5. 创建 `quickreels` 单仓库、Mini 前端、API、运营后台和 PostgreSQL。
6. 确认本次上线的 2-3 个目标语种、内容多版本策略、题材字典、首页板块初始配置和免费/锁定规则。
7. 建立 Prisma 数据模型和 API 契约，先锁定首页、详情、播放、进度、搜索、个人中心、语言和收益事件的字段，并区分匿名、可选认证和强制认证。
8. 用假数据完成完整 V1.0 用户流程：首页五类板块 -> 详情互动 -> 选集 -> 播放 -> 解锁 -> 续播 -> 搜索/个人中心/语言切换；先验证公开浏览不依赖登录。
9. 完成专辑、剧集、题材、首页板块、进度和互动接口，再接入前端真实数据。
10. 实现 `/home` 的首屏聚合、缓存、游标 feed、线上状态/地区过滤和无网络降级。
11. 实现详情页点赞/收藏/分享、搜索无结果兜底、个人中心历史/收藏夹和 locale 切换；验证静默登录失败后的可恢复路径。
12. 建立 HTTPS 测试 API 域名，填入 TikTok Portal Trusted domains；加载 `TTMinis` SDK，完成公开访问、静默登录、后端 code 交换和强制认证动作重试。
13. 在 Portal 绑定 BytePlus 账号/空间，建立 BytePlus OpenAPI 版本路由表：`StartExecution`/`GetExecution` 优先走 V2.0；上传、上传任务查询和播放等 V2.0 尚未覆盖的能力走 Node.js V1.0；再按当前官方媒资流程上传一条测试视频，保存平台返回的最小必要标识。
14. 用当前官方图片/专辑/剧集流程创建测试内容，完成审核、online version/Listed（如适用）并同步平台状态。
15. 仅在第 1 步播放器资格确认后，按当前 Player Reference 接入真实官方播放器，跑通已批准测试内容、进度恢复和连续 5 集播放；否则保留阻断态和 Mock。
16. 仅在第 2 步广告资格满足后接入 Rewarded Ad 解锁、Interstitial 频控和失败降级；Placement 非 Active 时验证不错误解锁和不阻塞基础观看。
17. 建立 Node.js V1.0 媒资上传 Worker；如使用 `StartExecution`/`GetExecution`，再建立独立的 Go/Python/Java V2 Worker，并完成内容审核和上线状态同步；补齐首页配置、翻译维护、收益报表导入和数据看板。
18. 执行单元测试、集成测试、`minis dev` 和 IAA Mock，完成不同版本 TikTok 真机测试，并归档播放器、广告、地区和失败降级证据。
19. 执行 `pnpm build`、`minis build`，上传 ZIP 预览，按验收清单和审核反馈修复。
20. 复核所有适用 P0 门禁后再提交生产发布；未完成的 Middle Funnel、Smart+ API 或短剧商品库 API 只保留扩展接口，不阻塞也不冒充 V1 已完成。

---

## 18. 上线验收清单

### 用户端

```text
[ ] TikTok 内可打开 QuicK ReeLS
[ ] 匿名公开浏览可用，不因静默登录失败白屏或阻塞
[ ] 登录成功后身份功能可用；登录失败可重试，且不阻塞公开内容
[ ] 需要身份的播放/解锁/互动动作按产品规则触发登录并可恢复原动作
[ ] 首页 1 秒内出现内容，包含继续观看、轮播图、题材分类、热门/新作、底部信息流
[ ] 首页五类板块可由后台独立开关和排序
[ ] 首页弱网使用最近缓存，feed 到底显示明确提示
[ ] 任意线上剧至少能从一个推荐板块或底部信息流到达
[ ] 专辑详情包含简介、题材、热度、点赞、收藏、分享和继续观看
[ ] 点赞/收藏状态跨次进入仍正确，分享深链能直达专辑
[ ] 专辑详情和剧集顺序正确
[ ] 免费集可直接播放
[ ] 点击锁定集直接弹 15 秒激励广告，完播后自动解锁并播放
[ ] 广告中途退出、加载失败不会错误解锁
[ ] 插屏在规定频率内触发，关闭或失败后继续下一集
[ ] 进度可保存和恢复
[ ] 播放连续 5 集无报错，自动下一集带倒计时且可跳过
[ ] 首帧、卡顿、清晰度和播放错误可上报
[ ] 搜索标题/题材可用，无结果有推荐兜底
[ ] 个人中心可查看观看记录和收藏夹并直接续播
[ ] 切换语言后界面、推荐、剧集标题/版本同步变化
[ ] 无网络、无内容、播放失败有清晰状态
[ ] 用户地区不满足内容可见规则时，内容不会出现在首页、搜索或详情入口
```

### 内容与后台

```text
[ ] 视频可创建 TikTok Short Drama -> BytePlus 异步上传任务
[ ] Worker 正确同步成功/失败状态
[ ] 成功任务保存 byteplus_vid
[ ] 专辑、剧集可编辑、提交审核、设置 online version、Listed、下线
[ ] 首页板块、轮播内容、题材和有效期可配置
[ ] 每集免费/广告解锁规则可修改且无需 Mini 发版
[ ] 可维护专辑/剧集多语言版本
[ ] 题材、首页配置、翻译和收益导入都有操作权限与审计记录
[ ] 用户端不会访问草稿/审核中/下线内容
[ ] 管理操作有权限和审计日志
[ ] 后台能看到播放、互动、搜索、留存和播放质量指标
[ ] 广告报表可导入，并能看到每集精确或估算收益
```

### Portal 与发布

```text
[ ] Basic Information 已批准
[ ] Privacy Policy 与 Terms URL 可访问
[ ] Service domains、Trusted domains 配置无误
[ ] 播放器资格已确认，并保存当前 Player Reference 版本、适配器实现和目标客户端真机验证证据
[ ] IAA 合同已签署，Organization IAA 能力已审批并启用（如本次启用 IAA）
[ ] Rewarded 与 Interstitial Placement 已创建且 Active，所属 App、地区和测试/生产范围正确（如本次启用 IAA）
[ ] Business Center 已确认（如涉及投放）
[ ] TikTok Minis 资产登记已完成（如涉及投放）
[ ] ADV ID 已生成并完成投放开白（如涉及投放）
[ ] 目标国家/地区、主体资格和首批语种已确认
[ ] 美国地区已取得批准，且 USDS TPRM 已完成或确认不适用（如计划上线美国）
[ ] 代码 ZIP < 200 MB，且无 0 字节文件
[ ] 测试用户能扫描 Preview 二维码
[ ] TikTok 内完整广告、插屏、登录与播放均验证通过
[ ] Middle Funnel Event Postback 是否纳入本次范围已有书面结论；未纳入时不作为 V1 阻塞项
[ ] TikTok IAA 收益报表已能导入，且平台精确收益与按事件分摊的估算收益已区分
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
- [BytePlus VOD Server SDK 总览](https://docs.byteplus.com/en/docs/byteplus-vod/docs-server-sdk-overview)
- [BytePlus VOD Server SDK V2.0](https://docs.byteplus.com/en/docs/byteplus-vod/docs-server-sdk-v2)
- [BytePlus VOD Node.js SDK（V1.0）](https://docs.byteplus.com/en/docs/byteplus-vod/docs-nodejs-sdk?type=preview)
- [BytePlus VOD V2.0 Go SDK](https://github.com/byteplus-sdk/byteplus-go-sdk-v2)
- [BytePlus VOD V2.0 Python SDK](https://github.com/byteplus-sdk/byteplus-python-sdk-v2)
- [BytePlus VOD V2.0 Java SDK](https://github.com/byteplus-sdk/byteplus-java-sdk-v2)

---

## 20. 开始开发前的最小输入清单

在开始写真实业务代码前，准备好以下非敏感信息：

```text
TikTok Mini App Client Key
播放器资格确认结果、证据链接/截图、负责人和确认日期
当前官方 Player Reference 版本或文档快照
IAA 合同状态、Organization IAA 审批状态
Rewarded Ad Placement ID 与状态
Interstitial Ad Placement ID 与状态
Business Center ID（如涉及投放）
TikTok Minis 资产登记状态（如涉及投放）
ADV ID 与投放开白状态（如涉及投放）
计划使用的 API 域名
BytePlus Account ID、Space Name、区域
测试专辑资料：标题、封面、简介、剧集顺序
一到两条有合法版权的测试视频
主体国家/地区
目标发布国家/地区
美国地区批准状态与 USDS TPRM 结论（如计划上线美国）
首批 2-3 个目标语种，以及系统语言到产品 locale 的映射
每部测试剧的默认语言、可用语言版本、字幕/配音说明
题材字典：slug、展示名称、各语种名称和排序
首页初始配置：五类板块开关、顺序、轮播项、有效期和推荐剧
每集初始访问规则：免费集范围、激励广告解锁集范围和插屏频控
TikTok IAA 收益报表样例、字段说明和导入周期
Middle Funnel Event Postback 是否纳入本次范围
Smart+ API、短剧商品库 API 的后续计划或明确不纳入结论
首发验收账号、测试设备、TikTok 客户端版本和弱网测试条件
```

私密信息只由部署人员写入服务器环境变量。BytePlus AK/SK 如需直接调用 Server SDK/OpenAPI，只注入对应的后端服务，不复制到前端：

```text
TikTok Client Secret
数据库密码
JWT_SECRET
BytePlus V1.0 AK/SK（仅 Node.js API/Worker）
BytePlus V2.0 AK/SK（仅 Go/Python/Java V2 Worker）
```

# BreezeReels TikTok Mini Drama PRD

**文档版本：** v1.0  
**产品名称：** BreezeReels  
**平台：** TikTok Minis / Mini Drama  
**TikTok App ID：** `7668887325719529492`  
**当前生产代码版本：** `19`  
**当前生产流量：** `100%`  
**文档状态：** MVP 开发基线

> 本文档用于指导 BreezeReels 的 Web 前端、后端服务、BytePlus 媒资管理和 TikTok Portal 发布工作。TikTok、BytePlus 的字段、地区限制和审核规则以提交时的官方页面和 API Reference 为准。

## 1. 产品概述

BreezeReels 是运行在 TikTok App 内 WebView 中的 Mini Drama 应用。用户可以浏览短剧专辑、查看剧集信息、连续播放剧集并记录观看进度。运营人员通过 BytePlus 完成视频上传、存储、审核和发布，后端负责把已发布的剧集目录提供给前端。

产品由三部分组成：

```text
TikTok App
  -> TikTok Portal 中发布的前端代码资产 ZIP
  -> BreezeReels H5 页面
  -> HTTPS 后端 API
  -> 数据库 + BytePlus 媒资服务
```

## 2. 产品目标

### 2.1 MVP 目标

1. 用户可以在 TikTok 内打开 BreezeReels。
2. 用户可以浏览已上线的短剧专辑。
3. 用户可以查看专辑详情和剧集列表。
4. 用户可以使用 TikTok 登录能力识别用户。
5. 用户可以播放已发布剧集，并自动记录观看进度。
6. 运营人员可以上传视频、创建专辑、维护剧集顺序并提交审核。
7. 通过 TikTok Mini Drama 的预览、审核和生产发布流程。

### 2.2 非目标

MVP 暂不包含以下能力：

- 自建视频分发系统或绕过 TikTok 官方播放器。
- 在前端保存 BytePlus 或 TikTok 私密密钥。
- 复杂推荐算法、社交评论、直播、创作者投稿。
- 未经审核的自动公开发布。
- 面向 TikTok 之外平台的独立 App。

## 3. 用户角色

| 角色 | 说明 | 主要目标 |
| --- | --- | --- |
| TikTok 用户 | 在 TikTok 内使用 Mini Drama 的普通用户 | 找剧、看剧、继续观看 |
| 内容运营人员 | 管理短剧内容和发布状态 | 上传、编辑、审核、上线 |
| 系统管理员 | 管理服务器、密钥和运行环境 | 保证服务安全、稳定和可监控 |
| 审核人员 | TikTok/平台审核方 | 检查应用、内容和合规性 |

## 4. 使用流程

### 4.1 用户观看流程

```text
打开 Mini Drama
  -> 初始化 TikTok Minis 环境
  -> TikTok Login
  -> 加载专辑列表
  -> 进入专辑详情
  -> 选择剧集
  -> 使用官方指定播放器播放
  -> 定期保存进度
  -> 下次打开时继续观看
```

### 4.2 运营发布流程

```text
上传视频到 BytePlus
  -> 查询异步上传任务状态
  -> 保存 BytePlus 视频 ID
  -> 创建专辑
  -> 创建/更新剧集信息
  -> 提交内容审核
  -> 审核通过后设置在线版本
  -> 上线
  -> 前端显示已发布内容
```

### 4.3 前端代码发布流程

```text
开发 H5
  -> npm run build
  -> minis build 校验并打包
  -> 生成 ZIP 代码资产
  -> Portal 上传 Code version
  -> 添加测试用户并扫码预览
  -> 提交版本审核
  -> 生产发布或灰度发布
```

## 5. 功能需求

### 5.1 首页/专辑列表

**功能描述：** 展示当前可访问的短剧专辑。

**需求：**

- 展示专辑封面、标题、简介、集数和更新状态。
- 默认只返回已上线且符合地区限制的专辑。
- 支持下拉刷新或重新加载。
- 无数据时显示空状态。
- 网络错误时显示可重试状态。
- 图片加载失败时使用默认占位图。

### 5.2 专辑详情

**功能描述：** 展示专辑信息和剧集目录。

**需求：**

- 展示封面、标题、简介、类型、语言、更新状态。
- 按运营配置的顺序展示剧集。
- 显示剧集编号、标题、时长和锁定/可观看状态。
- 显示用户上次观看的剧集和进度。
- 点击剧集进入播放页。

### 5.3 剧集播放

**功能描述：** 使用 TikTok Mini Drama 官方指定播放器播放 BytePlus 已发布资产。

**需求：**

- 播放请求必须使用 `album_id` 和 `episode_id` 等官方标识。
- 不在前端暴露永久 MP4 URL、BytePlus AK/SK 或 TikTok Client Secret。
- 支持播放、暂停、继续、切换上一集/下一集。
- 播放失败时显示重试和错误提示。
- 播放进度按时间间隔或暂停/退出事件保存。
- 当前剧集播放结束后，自动进入下一集（如存在）。
- 播放器区域使用固定比例，避免加载时页面跳动。

### 5.4 TikTok 登录

**需求：**

- 按 TikTok Minis 官方要求接入 TikTok Login API。
- 首次进入时获取登录态；登录失败时允许重试。
- 后端验证登录凭证并生成应用会话。
- 前端只保存短期会话信息，不保存 Client Secret。
- 用户未登录时仍可展示允许公开浏览的内容；需要用户身份的功能再要求登录。

### 5.5 观看记录

**需求：**

- 保存用户最近观看的专辑、剧集、播放秒数和更新时间。
- 同一用户同一剧集只保留一条最新记录。
- 播放进度异常时进行边界校验，不得超过剧集时长。
- 用户切换设备后可从服务端恢复记录。

### 5.6 运营内容管理

运营后台可以是独立 Web 管理页面，不放入 TikTok Mini 前端代码资产。

**专辑管理：**

- 创建、编辑、下线专辑。
- 设置标题、简介、封面、语言、地区、类型和排序。
- 查看审核状态和线上状态。

**剧集管理：**

- 创建剧集并关联 BytePlus 视频资产。
- 设置剧集编号、标题、简介、封面和排序。
- 调整剧集顺序。
- 标记是否可观看、是否需要付费（付费功能需另行完成 TikTok 变现开通）。

**媒资管理：**

- 选择待上传的视频文件。
- 创建 BytePlus 上传任务。
- 查看上传中、成功、失败状态。
- 失败任务支持重试。
- 保存 BytePlus 返回的资产标识，不保存前端可见的长期密钥。

## 6. 页面要求

### 6.1 Mini 前端页面

| 页面 | 路由示例 | 必要内容 |
| --- | --- | --- |
| 首页 | `/` | 专辑列表、刷新、错误/空状态 |
| 专辑详情 | `/album/:albumId` | 专辑信息、剧集目录、继续观看 |
| 播放页 | `/watch/:albumId/:episodeId` | 官方播放器、剧集切换、进度保存 |
| 登录回调 | `/auth/callback` | 登录结果处理、错误处理 |
| 隐私政策 | `/privacy` | 可公开访问的隐私政策 |
| 服务条款 | `/terms` | 可公开访问的服务条款 |

### 6.2 运营后台页面

| 页面 | 必要内容 |
| --- | --- |
| 登录页 | 管理员登录和会话管理 |
| 专辑列表 | 搜索、状态筛选、新建、编辑、下线 |
| 专辑编辑 | 专辑资料、剧集排序和审核状态 |
| 视频上传 | 文件选择、上传进度、任务状态、失败重试 |
| 发布管理 | 提交审核、查看审核结果、线上/下线操作 |

## 7. 技术架构

### 7.1 组件职责

| 组件 | 职责 | 部署位置 |
| --- | --- | --- |
| Mini H5 前端 | 页面、交互、播放器调用、API 调用 | 构建为 ZIP 后上传 TikTok Portal |
| 后端 API | 登录校验、业务接口、TikTok/BytePlus API 调用 | 公网 HTTPS 服务器 |
| 数据库 | 专辑、剧集、用户、观看记录、任务状态 | 云数据库或受控数据库 |
| BytePlus | 视频上传、存储、处理和媒资发布 | BytePlus 控制台/API |
| 监控日志 | 错误、请求、上传任务和审核状态追踪 | 服务器监控服务 |

### 7.2 推荐域名

```text
Mini 前端/法律页面： https://app.example.com
后端 API：          https://api.example.com
运营后台：          https://admin.example.com
Webhook：           https://api.example.com/webhooks/tiktok
```

Portal 中的域名用途必须区分：

- **Service domains：** 与 Terms of Service、Privacy Policy URL 对应，主要用于基本信息和审核。
- **Trusted domains：** Mini 运行时实际请求的域名，例如 `https://api.example.com`。不能填路径、通配符或 HTTP 地址。
- **Webhook URL：** 接收平台回调的服务端 HTTPS 地址，不等同于前端 Trusted domain。

## 8. 数据模型

### 8.1 Album

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 本地专辑 ID |
| `tiktok_album_id` | string | TikTok/Short Drama 专辑 ID |
| `title` | string | 专辑标题 |
| `description` | string | 专辑简介 |
| `cover_url` | string | 封面地址 |
| `language` | string | 内容语言 |
| `regions` | json | 发布地区 |
| `status` | enum | `draft/review/online/offline` |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |

### 8.2 Episode

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 本地剧集 ID |
| `album_id` | string | 所属专辑 |
| `tiktok_episode_id` | string | TikTok 剧集 ID |
| `byteplus_vid` | string | BytePlus 视频资产 ID |
| `episode_no` | int | 剧集编号 |
| `title` | string | 剧集标题 |
| `duration_ms` | int | 时长 |
| `cover_url` | string | 剧集封面 |
| `status` | enum | `draft/uploading/ready/review/online/error` |
| `sort_order` | int | 播放顺序 |

### 8.3 UploadJob

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 上传任务 ID |
| `episode_id` | string | 目标剧集 |
| `provider_job_id` | string | BytePlus 返回的异步任务 ID |
| `status` | enum | `pending/processing/succeeded/failed` |
| `error_message` | string | 脱敏后的错误信息 |
| `retry_count` | int | 重试次数 |
| `created_at` | datetime | 创建时间 |

### 8.4 WatchProgress

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | string | TikTok 用户映射 ID |
| `album_id` | string | 专辑 ID |
| `episode_id` | string | 剧集 ID |
| `position_ms` | int | 当前播放位置 |
| `duration_ms` | int | 剧集总时长 |
| `updated_at` | datetime | 最近更新时间 |

## 9. 后端接口（MVP）

### 9.1 用户端接口

```text
GET  /api/v1/albums
GET  /api/v1/albums/{albumId}
GET  /api/v1/albums/{albumId}/episodes
GET  /api/v1/episodes/{episodeId}/play
GET  /api/v1/me
GET  /api/v1/me/progress
PUT  /api/v1/progress
```

`/play` 接口只返回官方播放器所需的安全播放信息或官方标识，不返回 BytePlus AK/SK 和后台管理信息。

### 9.2 运营端接口

```text
POST /api/v1/admin/albums
PATCH /api/v1/admin/albums/{albumId}
POST /api/v1/admin/episodes
PATCH /api/v1/admin/episodes/{episodeId}
POST /api/v1/admin/upload-jobs
GET  /api/v1/admin/upload-jobs/{jobId}
POST /api/v1/admin/albums/{albumId}/review-submit
POST /api/v1/admin/albums/{albumId}/online
POST /api/v1/admin/albums/{albumId}/offline
```

### 9.3 第三方服务调用

BytePlus/TikTok 的请求必须由后端发起，具体路径和请求字段以当前 API Reference 为准。已规划的短剧媒资操作包括：

```text
上传视频并获得 job_id
查询视频上传状态
创建专辑
更新专辑和剧集
提交内容审核
设置 online version
查询专辑状态
```

典型视频上传请求包含 `client_key`、视频 URL、标题、`space_name` 和 `byteplus_account_id` 等字段。视频上传通常是异步任务，后端必须轮询或接收回调并持久化最终状态。

## 10. 安全与合规要求

1. 所有生产 API、Webhook 和法律页面使用 HTTPS。
2. TikTok Client Secret、BytePlus AccessKey/SecretKey 只放在后端环境变量或密钥管理服务中。
3. `.env` 不得进入代码资产 ZIP、Git 仓库或前端构建产物。
4. 对登录凭证、用户标识和管理接口进行服务端校验。
5. 运营端接口必须有管理员身份验证和权限控制。
6. 上传接口限制文件类型、大小、扩展名和任务频率。
7. 日志中不得打印完整密钥、授权码或用户敏感信息。
8. 仅使用已在 TikTok Portal 配置的 Trusted domains 发起运行时请求。
9. 动态脚本来源必须受限，不允许通过远程脚本绕过代码审核。
10. 隐私政策应说明登录信息、观看记录和日志的收集、用途、保存期限及删除方式。
11. 版权方、内容地区、分级和行业资质信息必须与实际提交材料一致。

## 11. 代码资产要求

代码资产是 TikTok Portal 的前端发布包：

```text
前端源码 -> npm run build -> minis build -> ZIP -> Code version
```

上传要求：

- 文件格式为 ZIP。
- 总大小不超过 200 MB。
- 包含完整的编译产物和静态资源。
- 不包含 0 字节文件。
- 包含可访问的入口页面和 TikTok Login API 实现。
- 不包含后端密钥、数据库密码、源码依赖目录或视频媒资库。
- 每次功能变更上传新的代码版本；已发布版本不直接修改。

## 12. Portal 配置清单

### 12.1 Basic Information

- App 名称：`BreezeReels`。
- App 图标和描述。
- Terms of Service URL。
- Privacy Policy URL。
- Service domains。
- TikTok Minis SDK 最低版本。
- 目标发布地区和内容资料。

### 12.2 Development Configuration

- 添加后端 API Trusted domain，例如 `https://api.example.com`。
- 添加其他实际请求域名，最多 20 个。
- 配置并验证 Webhook URL（如业务需要）。
- 完成 URL 所有权验证。
- 确认测试用户和预览环境可用。

### 12.3 Code Version

- 上传 `minis build` 生成的 ZIP。
- 使用测试用户生成 Preview 二维码。
- 在 TikTok 内验证登录、列表、详情和播放。
- 提交版本审核。
- 审核通过后手动或自动发布。

## 13. 非功能需求

### 性能

- 首页首屏尽量只加载专辑摘要，不一次加载全部剧集详情。
- 图片使用合适尺寸和压缩格式。
- API 设置合理超时和分页。
- 上传任务使用异步队列，避免 HTTP 请求长时间阻塞。

### 可用性

- API 错误返回统一错误码和用户可理解的提示。
- BytePlus 任务失败支持重试和人工处理。
- 后端具备健康检查接口：`GET /health`。
- 记录上传、审核、发布关键操作日志。

### 兼容性

- 支持 TikTok Mini Drama 要求的英语内容和界面文案。
- 适配 TikTok WebView 常见手机屏幕尺寸。
- 处理网络切换、页面返回、播放器暂停和登录失效。

## 14. MVP 验收标准

### 用户端

- [ ] TikTok 内可以成功打开 BreezeReels。
- [ ] 未登录用户看到合规的登录引导或公开内容。
- [ ] TikTok 登录成功后能获得有效应用会话。
- [ ] 首页能加载线上专辑列表。
- [ ] 专辑详情能显示剧集目录和正确顺序。
- [ ] 点击剧集后能通过官方播放器开始播放。
- [ ] 播放暂停、退出后再次进入可以恢复进度。
- [ ] 网络错误、空数据和播放失败都有明确状态。

### 运营端

- [ ] 视频可创建 BytePlus 上传任务。
- [ ] 可以查询并展示异步上传状态。
- [ ] 上传成功后保存 `byteplus_vid`。
- [ ] 可以创建专辑并关联剧集。
- [ ] 可以提交内容审核并查看状态。
- [ ] 审核通过后可以设置线上版本和发布状态。
- [ ] 下线操作不会删除历史数据。

### TikTok 发布

- [ ] Basic Information 已提交并获批。
- [ ] Service domains 和 Trusted domains 配置正确。
- [ ] 代码 ZIP 通过大小、空文件和安全扫描。
- [ ] 测试用户可以扫描预览二维码。
- [ ] 代码版本审核通过后可以生产发布。

## 15. 开发里程碑

| 阶段 | 交付物 | 完成条件 |
| --- | --- | --- |
| M0 环境准备 | 域名、HTTPS、数据库、服务器 | 后端 `/health` 可访问 |
| M1 前端骨架 | 首页、详情、播放页、法律页面 | 浏览器本地可运行 |
| M2 后端基础 | 登录、专辑、剧集、进度接口 | API 可通过 HTTPS 调用 |
| M3 BytePlus 接入 | 上传任务、状态查询、资产绑定 | 测试视频上传成功 |
| M4 内容闭环 | 专辑/剧集管理、审核和上线 | 一部短剧完成从上传到上线 |
| M5 TikTok 集成 | Login、官方播放器、Minis 构建 | Portal Preview 可正常使用 |
| M6 审核发布 | 代码版本审核和生产发布 | BreezeReels 线上可访问 |

## 16. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| BytePlus API 字段或权限变化 | 上传/发布失败 | 以最新 API Reference 为准并保留配置层 |
| 视频审核不通过 | 无法上线 | 提前确认版权、地区、分级和资质材料 |
| Trusted domain 配置遗漏 | TikTok 内请求失败 | 将前端实际访问的每个域名列入清单 |
| 密钥泄漏 | 账户和媒资被滥用 | 只放后端密钥管理，定期轮换 |
| 代码包超过 200 MB | 无法上传 | 压缩图片、移除无用依赖和开发文件 |
| 播放器使用错误 | 审核失败或无法播放 | 只使用官方指定 Mini Drama 播放方式 |
| 后端不可用 | 首页和播放功能失效 | HTTPS、健康检查、监控、重试和降级 |

## 17. 待确认事项

以下内容在开始正式开发前需要根据当前 Portal 和目标地区确认：

- 目标发布国家/地区及是否需要额外准入审批。
- BytePlus 账号、空间名称、区域和 VOD 权限。
- 当前 Mini Drama 播放器 SDK 的具体版本和参数。
- TikTok Login API 的当前授权流程和所需权限。
- 是否启用 IAP 或 IAA 变现能力。
- 内容版权、分级、语言和审核材料。
- 运营后台的管理员数量和权限等级。
- 预计专辑数量、单集大小、并发播放量和成本预算。

## 18. 交付定义

当以下条件全部满足时，MVP 视为完成：

1. 一部短剧可以从运营后台上传到 BytePlus。
2. 视频上传任务成功并完成资产绑定。
3. 专辑和剧集完成审核并处于线上状态。
4. TikTok Mini Drama 前端通过 `minis build` 打包并上传 Portal。
5. 测试用户在 TikTok 内可以登录、浏览、播放和恢复进度。
6. 代码版本审核通过并成功生产发布。
7. 生产环境没有暴露任何私密密钥，且关键错误可被监控和追踪。


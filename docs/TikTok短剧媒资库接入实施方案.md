# TikTok 短剧媒资库接入实施方案

> 实施状态（2026-09-21）：核心服务端链路、数据库迁移、后台操作入口及 Worker 已实现，并已在本地数据库应用迁移。仍须在目标环境配置真实 TikTok 凭证和公网 HTTPS 封面地址后，使用测试剧目完成一次平台联调与审核验收。

## 已实施内容与使用顺序

已实现下列保护和链路：

- `PlatformSyncJob` 保存不可变剧目快照、请求结果、平台 `log_id`、错误和发起管理员；视频、封面可重试，`album/update` 发生未知结果时标为 `CONFLICT` 并停止自动重放。
- 上传封面后自动登记 `shortdrama/image`，写入 `CoverAsset.providerImageId`；视频进入 BytePlus 后自动登记 `shortdrama/video` 并轮询至 `upload_status = 2`。
- 后台不再允许普通 PATCH 写入 `Album.status`、`tiktokAlbumId`、`publishStatus` 或人工传入 `tiktokEpisodeId`；这些字段仅由同步 Worker 写入。
- 生产公开接口除本地 `ONLINE` 外，必须同时满足审核通过、线上版本和 `platformPublishedVersion`，避免本地误上线。
- 编辑人员可发起素材/版本同步；送审、设置线上版本和上下架仅 Owner 可执行。所有平台操作会进入异步队列。

后台的正确操作顺序：

1. 在“内容创建”上传 JPEG/PNG/WebP 封面和 MP4/MOV/M4V 视频，填写上线年份、剧目类型和 1–3 个标签。
2. 等待 BytePlus 上传和 TikTok 视频登记完成；在“剧集与解锁 → TikTok 媒资库发布链路”点击“同步版本”。
3. 待版本任务成功后依次点击“送审” → 审核通过后“设线上版本” → “上架”。
4. 定期点击“对账”；如视频被平台报告为已删除，系统会将其及剧目切换为不可播放。

部署前必须执行：

```bash
pnpm --filter api db:generate
pnpm --filter api exec prisma migrate deploy --schema prisma/schema.prisma
pnpm --filter api worker
```

并在 API 服务环境配置 `TIKTOK_CLIENT_KEY`、`TIKTOK_CLIENT_SECRET`、`BYTEPLUS_*` 及可被 TikTok 访问的封面 CDN 域名。不要将这些密钥下发到管理后台或小程序端。

## 1. 结论

当前项目已具备运营后台上传专辑封面、分集封面和本地视频的能力，并能将本地视频上传至 BytePlus VOD，保存 `byteplusVid`、视频时长和本地播放所需的信息。

但当前实现尚未完成 TikTok 短剧媒资库接入。BytePlus VOD 中存在视频，不等于该视频已被 TikTok 短剧媒资库接受，也不等于剧目已通过审核或可以在 TikTok 小程序中上线播放。

需要补齐 TikTok OpenAPI 鉴权、图片资源登记、视频登记和轮询、剧目版本同步、审核、设置线上版本和上下架流程。

## 2. 当前能力和缺口

| 环节 | 当前状态 | 说明 |
| --- | --- | --- |
| 专辑封面上传 | 已实现 | 后台支持 JPEG、PNG、WebP 上传、预览、类型与大小校验，并保存本地公开地址。 |
| 分集封面上传 | 已实现 | 分集可使用独立封面或复用专辑封面。 |
| 本地视频上传 | 已实现 | 后台可按集上传 MP4、MOV、M4V、WebM 到 BytePlus VOD，并保存 `byteplusVid`。 |
| BytePlus URL 上传和轮询 | 已实现 | 已有 Worker 处理 URL 上传任务、轮询和重试。 |
| TikTok 客户端鉴权 | 未实现 | 没有使用 `client_key`、`client_secret` 获取并缓存 TikTok `access_token`。 |
| TikTok 图片资源登记 | 未实现 | 未调用 `POST /v2/sg/shortdrama/image`，所以没有 `open_pic_id`。 |
| TikTok 视频登记和轮询 | 未实现 | 未调用 `POST/GET /v2/sg/shortdrama/video`，因此 BytePlus VID 未被 TikTok 短剧媒资库确认。 |
| TikTok 剧目创建和版本更新 | 未实现 | 未调用 `album/create`、`album/update`，没有平台侧剧目和分集 ID 映射。 |
| TikTok 审核和发布 | 未实现 | 现有审核、上线和下线管理接口返回 501 占位错误。 |

## 3. 目标流程

```text
上传封面文件
  -> 项目对象存储或 CDN 公开 HTTPS URL
  -> TikTok 图片资源接口
  -> open_pic_id

上传本地视频
  -> BytePlus VOD
  -> byteplus_vid
  -> TikTok 视频登记接口
  -> TikTok 视频任务 job_id
  -> 轮询成功
  -> TikTok 可用于剧集的合法 VID

专辑封面 ID + 分集封面 ID + 合法 VID
  -> 创建或更新 TikTok 剧目版本
  -> 保存 TikTok 专辑 ID、版本号、分集 ID
  -> 送审
  -> 查询审核结果
  -> 审核通过
  -> 设置线上版本
  -> 上架
  -> 本地标记 ONLINE 并对小程序用户可见
```

## 4. 平台前置条件

开始开发前，必须确认以下外部条件已满足：

1. TikTok 小程序已开通短剧能力。
2. BytePlus 账号和 VOD Space 已绑定到当前 TikTok 小程序。
3. 已获得 TikTok `Client Key` 和 `Client Secret`。
4. 封面资源可通过 TikTok 服务端访问的公网 HTTPS URL 下载，不需要 Cookie、登录或内网访问权限。
5. 已获得 BytePlus Account ID、Space Name、Region、Access Key 和 Secret Key。
6. 生产环境具备持续运行上传和平台同步 Worker 的方式。

不要将 `Client Secret`、BytePlus Access Key 或 BytePlus Secret Key 放入前端、Git 仓库、构建产物或日志。

## 5. 环境变量

在 API 服务端环境中新增以下配置：

```env
# TikTok 短剧媒资库 OpenAPI，只允许存在于 API 服务端
TIKTOK_CLIENT_KEY=your_tiktok_client_key
TIKTOK_CLIENT_SECRET=your_tiktok_client_secret
TIKTOK_SHORT_DRAMA_API_BASE=https://open.tiktokapis.com

# 已有 BytePlus 配置
BYTEPLUS_ACCOUNT_ID=your_bound_byteplus_account_id
BYTEPLUS_SPACE_NAME=your_bound_vod_space_name
BYTEPLUS_REGION=ap-southeast-1
BYTEPLUS_ACCESS_KEY=your_byteplus_access_key
BYTEPLUS_SECRET_KEY=your_byteplus_secret_key

# 封面必须是 TikTok 可访问的公网 HTTPS URL
API_PUBLIC_BASE_URL=https://api.example.com
COVER_ASSET_PUBLIC_BASE_URL=https://cdn.example.com/covers
```

开发环境可以保存封面到本地目录，但用于 TikTok 联调的封面 URL 不能是 `localhost`、私网地址或受鉴权保护的地址。

## 6. 服务端模块设计

新增 `TikTokShortDramaApiService`，集中负责 TikTok 短剧媒资库 OpenAPI 调用。业务路由和 Worker 不应自行拼接平台 URL 或处理 TikTok Token。

### 6.1 鉴权和 Token 缓存

服务需要调用：

```text
POST https://open.tiktokapis.com/v2/oauth/token/
Content-Type: application/x-www-form-urlencoded

client_key=<TIKTOK_CLIENT_KEY>
client_secret=<TIKTOK_CLIENT_SECRET>
grant_type=client_credentials
```

实现要求：

- Token 仅保存在服务端内存或受保护的共享缓存中。
- 在 `expires_in` 到期前预留 5 分钟刷新。
- 所有短剧接口统一添加 `Authorization: Bearer <access_token>`。
- 认证失败时仅记录平台请求 ID、状态码和脱敏错误；绝不记录 Token 或 Secret。
- 多进程部署时避免同时刷新 Token，可通过 Redis 锁或数据库锁协调。

### 6.2 平台请求契约

`TikTokShortDramaApiService` 必须是唯一可以调用 `open.tiktokapis.com` 的模块。每个业务方法都必须由服务统一注入下列公共参数，路由、前端和 Worker 均不得自行传入或拼接：

- `Authorization: Bearer <access_token>`。
- `client_key: TIKTOK_CLIENT_KEY`，包括查询参数、请求体或平台当前接口要求的 Header。
- `byteplus_account_id`、`space_name` 和 `byteplus_region`，均从受保护的服务端配置读取。

TikTok `album_id` 和其他标记为 `int64` 的标识在 JavaScript 中必须全程按字符串处理：数据库字段、平台响应解析、任务载荷、审计日志和 JSON 序列化均不得转为 `number`。请求前按平台当前契约将字符串写入 JSON，避免超过 `Number.MAX_SAFE_INTEGER` 后丢失精度。

每次请求应返回并持久化：业务响应、HTTP 状态、平台 `error.code`、`error.message`、`error.log_id` 或等价请求 ID；Token、Client Secret、BytePlus AK/SK 和完整 Authorization Header 不得写入日志。

### 6.3 TikTok 客户端方法

| 服务方法 | 平台接口 | 结果 |
| --- | --- | --- |
| `createImage({ imageUrl })` | `POST /v2/sg/shortdrama/image` | `open_pic_id` |
| `createVideo({ vid, title })` | `POST /v2/sg/shortdrama/video` | 视频登记 `job_id`；服务统一注入账号、空间、地区和 `client_key`。 |
| `getVideo({ jobId, vid })` | `GET /v2/sg/shortdrama/video` | 上传状态、合法 VID；`job_id` 与 `vid` 至少提供一个，上传后优先轮询 `job_id`。 |
| `createAlbum()` | `POST /v2/sg/shortdrama/album/create/` | TikTok `album_id` |
| `updateAlbumVersion(input)` | `POST /v2/sg/shortdrama/album/update/` | 版本号、分集 ID 映射 |
| `queryAlbum({ albumId, version })` | `GET /v2/sg/shortdrama/album/query/` | 版本、审核、上下架状态 |
| `submitReview({ albumId, version })` | `POST /v2/sg/shortdrama/album/review/submit/` | 审核任务 ID |
| `setOnlineVersion({ albumId, version })` | `POST /v2/sg/shortdrama/album/online_version/` | 线上版本 |
| `setAlbumStatus({ albumId, status })` | `POST /v2/sg/shortdrama/album/status/` | 上架或下架状态，状态为 1 上架、2 下架。 |

字幕、申诉、转码和删除视频可作为第二阶段接入。

## 7. 数据模型调整

项目已有部分平台字段，但仍需要记录同步状态和错误，以支持重试和后台可观测性。

### 7.1 复用现有字段

| 模型 | 字段 | 用途 |
| --- | --- | --- |
| `CoverAsset` | `providerImageId` | 保存 TikTok `open_pic_id`。 |
| `Album` | `tiktokAlbumId` | 保存 TikTok `album_id`。 |
| `Album` | `tiktokVersion` | 保存最后一次成功同步的 TikTok 剧目版本。 |
| `Album` | `onlineVersion` | 保存 TikTok 已设定的线上版本。 |
| `Album` | `reviewStatus`、`publishStatus` | 保存 TikTok 返回的审核和上下架状态。 |
| `Episode` | `tiktokEpisodeId` | 保存 TikTok 分集 ID。 |
| `Episode` | `tiktokCoverPicId` | 保存该分集实际使用的 TikTok 图片 ID。 |
| `Episode` | `byteplusVid` | 保存上传至 BytePlus VOD 的 VID。 |

### 7.2 建议新增字段

建议通过 Prisma migration 为 `CoverAsset`、`Episode`、`Album` 或统一的平台同步任务表增加以下信息：

```text
platformSyncStatus       PENDING | PROCESSING | SUCCEEDED | FAILED
platformSyncError        string nullable
platformSyncedAt         datetime nullable
tiktokVideoJobId         string nullable
tiktokVideoStatus        PENDING | PROCESSING | SUCCEEDED | FAILED
lastPlatformQueryAt      datetime nullable
platformPublishedVersion int nullable
platformPublishedAt      datetime nullable
```

`platformPublishedVersion` 只能在 TikTok `online_version` 和上架接口均成功后写入；它是公众可见性的硬门槛，不能由普通后台更新接口修改。

### 7.3 PlatformSyncJob 和版本快照

应新增 `PlatformSyncJob`，而不是让后台 HTTP 请求直接重试平台调用。建议字段如下：

```text
id                     string
kind                   COVER | VIDEO | ALBUM_VERSION | REVIEW | SET_ONLINE_VERSION | PUBLISH | UNPUBLISH | RECONCILE
targetType             COVER_ASSET | EPISODE | ALBUM
targetId               string
dedupeKey              string unique
snapshotHash           string nullable
snapshotJson           JSON nullable
status                 PENDING | PROCESSING | SUCCEEDED | FAILED | CANCELLED
attemptCount           int
nextAttemptAt          datetime nullable
providerJobId          string nullable
providerRequestId      string nullable
providerResponse       JSON nullable
errorCode              string nullable
errorMessage           string nullable
createdByAdminUserId   string nullable
startedAt              datetime nullable
completedAt            datetime nullable
```

约束如下：

- `dedupeKey` 由任务类型、目标 ID、平台关联 ID 和不可变快照哈希组成。例如剧目版本同步可使用 `ALBUM_VERSION:<albumId>:<snapshotHash>`。
- 先在数据库事务中创建或复用任务，再由 Worker 调用平台。重复点击、进程重启和网络超时都只能复用同一个未完成任务。
- `ALBUM_VERSION` 任务的 `snapshotJson` 保存完整 `album_info` 和完整 `episode_info_list`，并记录创建任务时的本地数据版本。Worker 重试必须重放同一快照，不能读取后来被编辑的新数据。
- 对 `album/update` 不使用一般 HTTP 自动重试。发生未知结果的超时先执行 `album/query` 对账；只有确认该快照尚未创建版本时才允许人工或受控重试。
- 成功时在一个数据库事务中写入 `Album.tiktokVersion`、版本快照、所有 `Episode.tiktokEpisodeId` 映射及任务结果。

## 8. 封面同步实现

### 8.1 处理规则

现有封面上传接口在文件保存并生成 `CoverAsset.publicUrl` 后，不应把本地 READY 状态当作 TikTok 就绪状态。

新增异步封面同步任务：

```text
CoverAsset.status = READY
  -> 检查 publicUrl 为公网 HTTPS
  -> 调用 TikTok createImage({ imageUrl: publicUrl })
  -> 返回 open_pic_id
  -> 写入 CoverAsset.providerImageId
  -> 写入平台同步成功状态
```

### 8.2 幂等性

- 若 `providerImageId` 已存在，除非运营人员明确要求重新上传，不重复调用 TikTok 图片接口。
- 同一文件内容目前已按 SHA-256 去重，可直接复用已有 `providerImageId`。
- 图片 URL 或内容变化后，创建新的 `CoverAsset` 或显式清空旧的 `providerImageId`，再重新同步。

### 8.3 专辑和分集封面选取

- 专辑必须使用 `Album.coverAsset.providerImageId` 组成 TikTok `cover_list`。
- 有独立封面的分集使用 `Episode.coverAsset.providerImageId`。
- 未设置独立封面的分集复用专辑封面 ID，并把实际使用的 ID 写入 `Episode.tiktokCoverPicId`。

## 9. 视频同步实现

### 9.1 本地文件上传后的处理

保留现有流程：

```text
浏览器选择视频
  -> API 接收 multipart 文件
  -> BytePlus UploadMedia
  -> 保存 Episode.byteplusVid
```

在获取 `byteplusVid` 后追加 TikTok 视频登记：

```text
Episode.byteplusVid 已存在
  -> TikTok createVideo({
       vid: byteplusVid,
       title: episode.title,
     })
  -> 保存 tiktokVideoJobId
  -> Worker 轮询 TikTok getVideo({ jobId })
  -> upload_status = 2 时标记 TikTok 视频同步成功
  -> 仅此时视频才可参与剧目版本同步
```

文档允许传入已有的 BytePlus `vid`，因此无需把本地文件上传两次。但是 TikTok 视频登记和成功轮询不可跳过。

登记前必须通过 BytePlus 媒体查询确认该 VID 属于当前已绑定的 `BYTEPLUS_ACCOUNT_ID`、`BYTEPLUS_SPACE_NAME` 和 `BYTEPLUS_REGION`。平台请求应传入当前区域；不匹配、已删除或未发布的媒体不得进入 TikTok 登记队列。

### 9.2 URL 视频上传后的处理

若运营人员提供公网视频 URL，可选择以下两种策略：

1. 继续通过 BytePlus `UploadMediaByUrl` 导入，得到 `byteplusVid` 后再登记 TikTok。
2. 直接调用 TikTok `shortdrama/video` 并传 URL，由 TikTok 接口异步导入。

建议统一采用第一种策略，确保所有视频都属于已绑定的 BytePlus 空间，并让后台的媒体管理、播放授权和重试机制保持一致。

### 9.3 格式预检

BytePlus 能接收不代表 TikTok 短剧媒资库一定能接收。后台的文件选择、服务端校验和异步任务都应以 TikTok 文档为准：

- 默认只接收经验证的 MP4 作为本地上传格式；MOV、M4V 等应先转封装或在 TikTok 沙箱验证后放行。
- 当前后台允许的 WebM 不在文档列出的上传格式中，应停止默认放行。
- 文档虽列出 HLS/m3u8，但同时明确不支持 fMP4 分片的 HLS/m3u8；该能力必须经过平台联调后才可开放，默认拒绝分片 HLS。
- URL 导入必须验证目标地址为公网 HTTP/HTTPS、可匿名下载、重定向链可访问，并在任务中记录源 URL 的到期时间。

### 9.4 状态拆分

不要用单个 `Episode.status = READY` 同时表达 BytePlus 上传成功和 TikTok 媒资库确认成功。推荐保持原有面向业务的 `Episode.status`，并新增两个独立状态字段：

```text
byteplusUploadStatus = PENDING | UPLOADING | READY | FAILED
tiktokVideoStatus    = NOT_STARTED | PROCESSING | READY | FAILED
```

如确实需要使用统一状态机，至少区分：

```text
DRAFT
BYTEPLUS_UPLOADING
BYTEPLUS_READY
TIKTOK_SYNCING
TIKTOK_READY
ALBUM_VERSION_SYNCED
REVIEWING
ONLINE
ERROR
```

`Episode.status = ONLINE` 只能由发布 Worker 写入，且必须满足 `tiktokVideoStatus = READY`、所属 `Album.platformPublishedVersion` 非空、该值等于 `Album.onlineVersion`。普通创建、编辑、绑定媒资和重试接口不得接收或写入 `ONLINE`。

## 10. 剧目版本同步

### 10.1 后台需要补充的剧目元数据

TikTok `album/update` 所需信息不止当前后台的标题、简介和封面。内容创建表单应增加：

- 原始语言。
- 上线年份。
- 剧目类型：AIGC、漫剧、真人配音、真人本地化。
- 1 至 3 个 TikTok 短剧标签。
- 目标地区或发布策略。
- 发行状态。

### 10.2 首次同步

```text
确认专辑封面已获得 providerImageId
确认每集视频已完成 TikTok 视频同步
确认每集封面已获得 providerImageId 或可复用专辑封面 ID
  -> 调用 album/create
  -> 保存 Album.tiktokAlbumId
  -> 调用 album/update，operation_type = 1
  -> 保存 Album.tiktokVersion
  -> 根据 episode_id_map 保存 Episode.tiktokEpisodeId
```

`album/update` 的核心数据形状：

```json
{
  "album_id": "TikTok album ID",
  "operation_type": 1,
  "version": 1,
  "album_info": {
    "language": "en",
    "title": "Drama title",
    "seq_num": 3,
    "cover_list": ["open_pic_id"],
    "year": 2026,
    "album_status": 3,
    "desp": "Drama description",
    "drama_type": 2,
    "tag_list": [1],
    "publish_status": 1
  },
  "episode_info_list": [
    {
      "title": "Episode 1",
      "seq": 1,
      "cover_list": ["open_pic_id"],
      "byteplus_vid": "verified_byteplus_vid"
    }
  ]
}
```

实际字段、枚举值和必填条件以当前 TikTok 平台文档及测试环境返回为准。

### 10.3 后续编辑

- 修改剧目信息或分集时，先使用 `album/query` 读取 TikTok 当前版本与完整分集清单。
- 以平台最新版本为基准合并本地编辑，构造完整 `album_info` 和完整 `episode_info_list` 快照；不得把局部 PATCH 直接转发为 `album/update`。
- 更新已有分集时必须传 `Episode.tiktokEpisodeId`；新增分集才不传平台分集 ID，由 TikTok 返回新的映射。
- 发送 `album/update` 时传入查询得到的当前 `version` 作为并发保护；发生版本冲突时标记同步任务为 `CONFLICT`，重新查询后要求运营人员确认合并，不自动覆盖平台变更。
- 保存返回的新版本号，不能覆盖或丢失历史版本的关联关系。每次成功版本同步应保留不可变平台快照，供审核、回滚和排障使用。
- 使用 `operation_type = 2` 仅处理文档定义的剧目编辑状态切换；内容更新使用 `operation_type = 1`，并遵守完整快照与幂等任务规则。

## 11. 审核和发布

TikTok 平台发布流程必须由平台状态驱动：

```text
同步 TikTok 草稿版本
  -> 提交审核
  -> 查询剧目审核状态
  -> 审核通过
  -> 设置 online_version
  -> 调用上架
  -> 写入 platformPublishedVersion
  -> 本地 Album.status = ONLINE
```

### 11.1 实施要求

- 替换现有 `review-submit`、`online`、`offline` 的 501 占位实现。
- 审核拒绝时保存 `review_fail_reasons`，在后台按剧目和分集展示。
- 只有审核通过的 TikTok 版本允许调用 `online_version`。
- 只有 TikTok 上架成功后才在同一数据库事务中写入 `onlineVersion`、`platformPublishedVersion`、`platformPublishedAt` 和本地 `Album.status = ONLINE`。
- 下架应先调用 TikTok 下架接口，平台成功后再更新本地状态。
- 小程序公开列表、剧目详情、分集列表、播放凭证、互动、进度和广告接口必须统一要求：本地 `ONLINE`、`platformPublishedVersion` 存在且等于 `onlineVersion`、平台 `reviewStatus` 为通过、平台 `publishStatus` 为上架。
- 删除或禁止普通 `PATCH /admin/albums/:id`、媒资绑定接口直接写入 `Album.status = ONLINE`、`Episode.status = ONLINE`、`tiktokAlbumId`、`tiktokEpisodeId`、`onlineVersion`、`reviewStatus` 和 `publishStatus` 的能力。这些字段只能由平台同步服务写入。

### 11.2 平台状态对账和漂移修复

除操作后的即时查询外，Worker 应定时对已同步剧目执行对账：

1. 使用 `album/query` 拉取当前版本、线上版本、审核状态、上下架状态和 `review_fail_reasons`。
2. 将审核拒绝原因分别关联到剧目或 `episode_id`，供后台查看与发起申诉。
3. 处理文档返回的 `exception_reason`，例如 BytePlus 视频已被删除；受影响剧集立即标为不可播放，并阻止后续版本同步和上架。
4. 检查平台 `online_version`、本地 `onlineVersion` 和 `platformPublishedVersion` 是否一致；不一致时停用本地公开可见性并创建人工处理任务。
5. 删除视频前先调用平台批量删除能力并检查 `related_album_versions`。被当前线上版本引用的视频不得删除；每批最多 20 个且提交前去重。

## 12. 后台界面改造

建议在现有内容创建页和剧集管理页增加以下运营信息与操作：

| 区域 | 需要新增的内容 |
| --- | --- |
| 内容创建 | 原始语言、年份、剧目类型、TikTok 标签、地区和发布策略。 |
| 封面状态 | 本地保存、TikTok 图片同步中、已获得图片 ID、失败原因、重新同步。 |
| 视频状态 | BytePlus 上传中、BytePlus VID、TikTok 登记中、TikTok 确认成功、失败原因、重试。 |
| 剧目同步 | 同步草稿版本、当前 TikTok 版本、上次同步时间、分集 ID 映射。 |
| 审核发布 | 送审、刷新审核状态、查看驳回原因、设为线上版本、上架、下架。 |
| 任务中心 | 可筛选的同步任务、平台请求 ID、重试次数、下一次执行时间和失败原因。 |

长时间平台调用应通过 Worker 异步完成，后台只负责发起任务和轮询状态，不应等待单个视频或整部剧同步完成。

### 12.1 权限和审计

不要继续用单一的 `content.write` 覆盖全部高风险操作。服务端应新增并强制校验以下权限：

| 权限 | 可执行操作 | 建议角色 |
| --- | --- | --- |
| `content.write` | 创建和编辑本地草稿、上传封面和视频。 | OWNER、EDITOR |
| `content.sync` | 发起封面、视频和剧目版本同步，查看并重试失败任务。 | OWNER、EDITOR |
| `content.review` | 送审、撤回送审、申诉和查看审核原因。 | OWNER、指定审核运营 |
| `content.publish` | 设置线上版本、上架、下架和确认平台漂移处理。 | OWNER、指定发布运营 |

每次同步、送审、申诉、设置线上版本、上架和下架都应保存操作者、任务 ID、版本快照哈希、平台 `log_id`、请求结果和状态变更前后的值。

### 12.2 播放器接入边界

媒资库文档只规定媒资、剧目、审核和发布流程，不定义 TikTok Minis 短剧播放器的最终播放参数。当前项目向 BytePlus 请求 `playAuthToken` 的链路必须另行对照《TikTok Short Drama Player Integration Guide》验证：

- 已上架短剧是否应使用 TikTok 专用播放器，而不是通用 BytePlus 播放授权。
- 播放器实际需要的剧目 ID、分集 ID、VID、播放 URL 或 SDK 调用参数。
- 平台版本、审核状态和授权状态变化后播放器的错误与降级策略。

在播放器文档和 TikTok 测试环境验证之前，不得以“已有 BytePlus VID”作为 TikTok 小程序生产播放可用的判断。

## 13. 推荐实施顺序

### 第一阶段：封堵上线绕过和连接验证

1. 删除普通后台更新接口对 `ONLINE`、线上版本、审核状态和 TikTok ID 映射字段的写权限。
2. 为所有公开和播放接口增加 `platformPublishedVersion = onlineVersion`、审核通过和平台已上架的查询条件。
3. 增加 TikTok 服务端环境变量和配置校验。
4. 实现 Token 获取、缓存和自动刷新，以及统一的 `client_key` 注入。
5. 实现 TikTok API 通用错误处理、超时、请求 ID 日志与脱敏日志。
6. 使用一张公网 HTTPS 封面验证 `shortdrama/image`，确认能得到 `open_pic_id`。

### 第二阶段：媒资同步

1. 创建 `PlatformSyncJob`、快照哈希、去重键和受控重试机制。
2. 为封面资源添加同步状态并实现 `providerImageId` 写入。
3. 在 BytePlus 上传成功且完成账号、空间、区域和格式预检后创建 TikTok 视频登记任务。
4. 实现视频状态轮询、指数退避和失败重试。
5. 在后台展示 BytePlus 状态与 TikTok 状态，避免运营人员误以为 BytePlus 成功等于可发布。

### 第三阶段：剧目版本

1. 扩展后台表单，收集 TikTok 所需剧目元数据。
2. 实现首次 `album/create` 和基于不可变完整快照的 `album/update`。
3. 保存 TikTok 专辑 ID、版本号、分集 ID 映射。
4. 实现后续修改时的版本查询、全量合并、并发保护和冲突处理。

### 第四阶段：审核上线

1. 接入送审、查询审核结果和驳回原因。
2. 接入设置线上版本。
3. 接入上架和下架。
4. 将小程序内容可见性严格绑定至平台审核通过且已上架的版本。
5. 增加周期对账、平台漂移自动下线和人工处理队列。

### 第五阶段：扩展能力

1. 字幕上传和多语言字幕管理。
2. 审核申诉与撤回送审。
3. BytePlus 转码任务和多码率播放质量控制。
4. 批量删除未被线上剧目版本引用的视频。

## 14. 验收标准

### 14.1 封面

- 后台上传一张合规封面后，获得可公开下载的 HTTPS URL。
- TikTok 图片接口返回 `open_pic_id`。
- `CoverAsset.providerImageId` 被正确持久化。
- 专辑和分集同步版本使用的是 `open_pic_id`，不是本地图片 URL。
- 重复提交同一封面不会重复创建无意义的平台图片资源。

### 14.2 视频

- 后台上传一个视频后，BytePlus 成功返回 `byteplusVid`。
- 在 TikTok 登记前，已校验 VID 的 BytePlus 账号、空间、区域与服务端绑定配置一致，且媒体格式符合已验证的 TikTok 接收范围。
- TikTok 视频登记接口返回任务 ID。
- Worker 可以轮询到成功状态和有效 VID。
- 失败任务显示明确原因并支持受控重试。
- TikTok 未确认的视频不能加入剧目版本同步。

### 14.3 剧目和发布

- 首次同步后，数据库保存 `tiktokAlbumId`、`tiktokVersion` 和每集 `tiktokEpisodeId`。
- 剧目版本同步以完整不可变快照创建任务；重复点击和重试不会创建额外版本。
- 修改一集后会创建 TikTok 新版本，不会覆盖历史版本；同步时包含完整分集清单且已处理版本冲突。
- 审核通过前不能设置线上版本或上架。
- TikTok 上架成功后，本地剧目才变为 `ONLINE`，同时写入 `platformPublishedVersion`；普通后台编辑接口无法直接写入这些发布字段。
- TikTok 下架失败时，本地状态不应先变为 `OFFLINE`。
- 小程序仅展示本地 ONLINE、平台审核通过、平台已上架且 `platformPublishedVersion = onlineVersion` 的内容。
- 周期对账发现平台线上版本、审核状态、上下架状态或视频可用性与本地不一致时，会停止公开播放并建立可追踪的修复任务。

### 14.4 平台契约和权限

- 所有 TikTok 短剧请求均由服务端统一注入 `client_key` 和授权 Token；前端请求中没有 TikTok Secret 或平台 Token。
- TikTok int64 标识在数据库、业务模型和任务载荷中均以字符串保存，测试覆盖超过 JavaScript 安全整数范围的 ID。
- `content.write` 无法送审、上架或下架；高风险操作需要 `content.review` 或 `content.publish` 并写入审计日志。
- 播放器链路已经按独立的短剧播放器文档与 TikTok 测试环境验证，不能仅凭 BytePlus VID 判定生产可播放。

## 15. 相关现有代码

- 后台内容创建和本地文件选择：`apps/admin-web/src/main.tsx`
- 后台封面上传、创建短剧、本地视频上传：`apps/api/src/modules/admin/routes.ts`
- BytePlus VOD 服务：`apps/api/src/services/byteplus-vod.service.ts`
- URL 上传和轮询 Worker：`apps/api/src/jobs/tiktok-short-drama.worker.ts`
- 平台服务接口占位：`apps/api/src/services/tiktok-short-drama.service.ts`
- 数据模型：`apps/api/prisma/schema.prisma`
- TikTok 接入依据：`docs/TikTok小程序短剧媒资库接入文档.docx`

## 16. 风险和注意事项

- TikTok 接口要求图片和视频来源可从公网访问；本地地址和受鉴权资源会导致平台拉取失败。
- `album_id` 是 int64。TypeScript 与 JSON 处理平台响应时应保留字符串形式或确保不会丢失精度。
- TikTok 的剧目更新会创建新版本，不能把它当作原地更新。
- 视频登记是异步的，只有查询返回成功后的 VID 才可用于分集。
- 线上版本正在引用的视频不能随意删除。
- 使用 TikTok 转码能力时，不能删除平台自动创建的回调订阅。
- 所有平台 API 应具备请求超时、幂等键、退避重试、错误分类和审计日志；但 `album/update` 超时不能盲目重试，必须先查询平台状态和任务快照。
- 文档阅读已通过 LibreOffice 渲染验证；后续更新官方 DOCX 时，应重新渲染并核对接口表格和状态定义。

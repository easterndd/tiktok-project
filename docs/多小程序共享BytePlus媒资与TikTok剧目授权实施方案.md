# 多小程序共享 BytePlus 媒资与 TikTok 剧目授权实施方案

## 1. 文档目的

本文用于指导 QuicK ReeLS、taletv 以及后续其他 TikTok Mini App 复用同一套 BytePlus VOD 媒资，并通过 TikTok 官方短剧媒资授权机制复用同一个 TikTok 剧目、版本、分集和审核结果。

本文针对当前仓库的实际结构编写：

- 一个 API 进程同时服务多个小程序。
- QuicK ReeLS 使用 `/api/v1`。
- taletv 使用 `/api/taletv/v1`。
- 两个小程序目前使用不同的 PostgreSQL schema 或数据库。
- 两个小程序可以使用同一个 BytePlus Account ID、VOD Space、Region 和 AK/SK。
- 当前 `Album`、`Episode`、`PlatformSyncJob` 以及 TikTok 平台 ID 主要保存在各自小程序的数据库上下文中。

本文的目标不是为每个小程序复制一套 TikTok 剧目，而是建立以下正式链路：

```text
本地视频
  -> BytePlus 上传一次
  -> 保存共享 BytePlus VID
  -> 一个 TikTok 小程序创建并维护主剧目
  -> 主剧目版本送审
  -> 审核通过并上架
  -> 通过 album/authorize 授权给其他小程序
  -> 其他小程序复用同一个 album_id、episode_id、BytePlus VID 和审核结果
```

## 2. 最终结论

### 2.1 可以实现的部分

在同一个 BytePlus 账号和同一个 VOD Space 前提下，可以实现：

1. 视频只上传一次到 BytePlus。
2. 多个 TikTok 小程序使用同一个 BytePlus VID。
3. 一个主小程序创建 TikTok `album_id`。
4. 主小程序完成版本同步、送审、设置线上版本和上架。
5. 主剧目通过 TikTok 的 `album/authorize` 接口授权给其他目标小程序。
6. 目标小程序不再重复创建同一部剧的 `album_id`。
7. 目标小程序不重复上传 BytePlus。
8. 目标小程序不重复提交同一版本的剧目审核。
9. 后台可以统一查询每个目标小程序的授权状态、平台可见性和本地映射状态。

### 2.2 不建议或不能直接实现的部分

以下做法不应作为正式方案：

```text
QuickReels 创建 album-A 并审核通过
taletv 创建 album-B
把 album-A 的 review_status 直接复制到 album-B
```

TikTok 官方公开 API 没有提供“把一个 `album_id + version` 的审核结果复制到另一个完全不同的 `album_id`”的接口。

因此：

- 如果其他小程序复用同一个 `album_id`，可以复用剧目版本和审核结果。
- 如果其他小程序必须创建新的 `album_id`，就必须按照 TikTok 平台实际规则独立同步版本和送审。
- 不能只在本地数据库中把 `reviewStatus` 写成 `PASSED`，这会造成平台状态与本地状态不一致。

### 2.3 与小程序代码审核的区别

本文解决的是“短剧媒资/剧目”的复用，不等于复用小程序代码版本审核。

仍然需要分别处理：

- QuicK ReeLS Mini App 自身的代码版本审核。
- taletv Mini App 自身的代码版本审核。
- 每个 Mini App 自己的 Client Key、Client Secret、App ID、隐私协议和产品信息。

正确理解是：

```text
剧目媒资审核：可通过同一个 album_id + album/authorize 复用
小程序代码审核：每个 Mini App 仍然独立进行
```

## 3. 官方依据

实施前、联调时和上线前应以 TikTok 官方当前页面为准。平台接口可能变更，代码中不应只依据历史截图或第三方文章。

### 3.1 TikTok 短剧媒资管理

- [Media Asset Management](https://developers.tiktok.com/docs/en/media-asset-management)

重点核对：

- BytePlus VOD 中已有的视频如何登记到 TikTok 短剧媒资库。
- BytePlus VID 与 TikTok 短剧视频登记的关系。
- 媒资、剧目、版本、审核和发布之间的边界。

### 3.2 TikTok 短剧 API 参考

- [API Reference](https://developers.tiktok.com/docs/en/media-asset-api-reference)

重点接口：

```text
POST /v2/sg/shortdrama/video
GET  /v2/sg/shortdrama/video
POST /v2/sg/shortdrama/album/create/
POST /v2/sg/shortdrama/album/update/
GET  /v2/sg/shortdrama/album/query/
POST /v2/sg/shortdrama/album/review/submit/
POST /v2/sg/shortdrama/album/online_version/
POST /v2/sg/shortdrama/album/status/
POST /v2/sg/shortdrama/album/authorize/
```

官方媒资文档当前明确了以下前提：

- BytePlus 中已经存在的视频可以直接提交审核，不需要重复上传。
- 一个 BytePlus 账号可以被多个 TikTok Developer Platform App 使用。
- 同一个剧目只能绑定同一个 BytePlus 账号下的同一个 Space；该剧目所有分集视频也必须属于这个 Space。
- 播放受审核状态、上架状态以及 BytePlus 账号绑定关系共同控制。

因此，本文的“共享 BytePlus 媒资”不是仅依赖本地数据库复制 VID，而是要求所有目标小程序在 TikTok Developer Portal 中绑定同一个 BytePlus Account，并且目标剧目继续使用同一个 Space。

### 3.3 `album/authorize`

正式开发前必须在上面的 API Reference 页面确认以下字段的最新名称和取值：

```text
album_id
operate_type
target_client_key_list
```

当前方案按官方公开接口的设计使用：

```json
{
  "album_id": "主剧目 album_id",
  "operate_type": 1,
  "target_client_key_list": [
    "目标小程序 client_key"
  ]
}
```

官方 API Reference 当前返回的是逐目标结果：

```json
{
  "client_key_result_list": [
    {
      "client_key": "mnabc123",
      "auth_status": 1,
      "error_code": 0,
      "error_message": ""
    }
  ]
}
```

其中：

- `album_id` 是主剧目 ID。
- `operate_type = 1` 表示新增授权，具体枚举以官方文档当前版本为准。
- `target_client_key_list` 是目标小程序 Client Key 列表。
- `auth_status = 1` 表示已授权。
- `auth_status = 2` 表示已移除。
- `error_code` 和 `error_message` 必须按每一个目标 Client Key 单独处理，不能只看 HTTP 200。

如果官方文档后续将接口路径或字段调整为其他版本，必须同步更新 API Client、测试和本文档，不能仅修改前端按钮文字。

## 4. 现状与需要解决的问题

### 4.1 当前 BytePlus 上传与 TikTok 登记链路

当前流程大致如下：

```text
后台上传本地视频
  -> BytePlusVodService.uploadLocalVideo()
  -> Episode.byteplusVid
  -> enqueueVideoSync()
  -> TikTokShortDramaApiService.createVideo()
  -> Episode.tiktokVideoStatus = READY
  -> buildAlbumSnapshot()
  -> album/update
  -> Album.tiktokAlbumId / tiktokVersion
  -> review-submit
```

当前关键字段包括：

```text
Episode.byteplusVid
Episode.tiktokVideoJobId
Episode.tiktokVideoStatus
Episode.tiktokEpisodeId
Album.tiktokAlbumId
Album.tiktokVersion
Album.onlineVersion
Album.reviewStatus
Album.publishStatus
```

### 4.2 当前多小程序隔离方式

当前 `apps/api/src/app.ts` 会为不同小程序注册不同 API Context：

```text
/api/v1       -> mainEnv       -> 主数据库上下文
/api/taletv/v1  -> taletvEnv       -> taletv 数据库上下文
```

`apps/api/src/config/mini-apps.ts` 会为 taletv 替换：

```text
DATABASE_URL
TIKTOK_CLIENT_KEY
TIKTOK_CLIENT_SECRET
MINI_APP_KEY
```

这保证了用户、内容、广告和管理员数据隔离，但也会导致：

```text
QuickReels.Episode.byteplusVid
和
taletv.Episode.byteplusVid
```

成为两个互不认识的字段。

### 4.3 当前逻辑的具体问题

当前 `enqueueVideoSync()` 的前置条件是本地 `Episode.byteplusVid` 存在；如果 taletv 的内容记录没有这个字段，后台会要求先在 taletv 上重新上传或重新绑定。

当前 `enqueueAlbumVersionSync()` 又要求：

- 当前小程序的封面已经获得 `providerImageId`。
- 当前小程序的每集视频已经 `tiktokVideoStatus = READY`。
- 当前小程序拥有自己的 `tiktokAlbumId`。

因此当前系统实际上是：

```text
每个小程序一套本地媒资字段
每个小程序一套 TikTok 剧目 ID
每个小程序一套审核状态
```

目标方案要改成：

```text
BytePlus 媒资共享
TikTok 主剧目共享
小程序授权关系独立记录
本地内容状态仍按小程序隔离
```

## 5. 目标架构

### 5.1 三层模型

将现有单层平台字段拆成三层。

#### 第一层：共享 BytePlus 媒资

这是跨小程序复用的最底层资源：

```text
SharedMediaAsset
```

一条记录对应一个 BytePlus VID。

保存：

- BytePlus VID。
- BytePlus Account ID。
- BytePlus Space Name。
- BytePlus Region。
- 视频时长。
- BytePlus 封面。
- 原始文件指纹。
- 资源状态。
- 首次上传任务。

#### 第二层：共享 TikTok 主剧目

这是跨小程序复用的 TikTok 剧目：

```text
SharedTikTokAlbum
SharedTikTokEpisode
SharedTikTokVersion
```

保存：

- 主 `album_id`。
- 主剧目拥有者小程序。
- 当前版本。
- 线上版本。
- TikTok 审核状态。
- TikTok 上架状态。
- 每集 `episode_id`。
- 每集与共享 BytePlus VID 的关系。

#### 第三层：小程序授权关系

这是每个目标小程序与主剧目的关系：

```text
MiniAppAlbumAuthorization
```

保存：

- 目标 `miniAppKey`。
- 目标 `client_key`。
- 目标 App ID。
- 授权状态。
- TikTok 返回的授权状态。
- 最近一次授权请求 ID。
- 最近一次对账时间。
- 授权撤销时间。

### 5.2 目标关系图

```text
SharedMediaAsset
  └── byteplusVid = V001

SharedTikTokAlbum
  ├── albumId = A001
  ├── version = 3
  ├── reviewStatus = PASSED
  ├── onlineVersion = 3
  └── episodes
       ├── episodeId = E001 -> V001
       ├── episodeId = E002 -> V002
       └── episodeId = E003 -> V003

MiniAppAlbumAuthorization
  ├── quickreels -> AUTHORIZED
  └── taletv       -> AUTHORIZED
```

### 5.3 核心原则

1. `byteplusVid` 是共享资源标识，不属于某个小程序。
2. `album_id` 是被授权共享的主剧目标识，不为每个目标小程序重新生成。
3. `reviewStatus` 只允许由平台真实查询结果更新。
4. 目标小程序只能通过授权关系使用主剧目。
5. 目标小程序不允许直接修改主剧目版本。
6. 如果目标小程序需要不同内容、不同分集或不同审核生命周期，必须创建新的 `album_id`，不能复用审核结果。
7. 所有平台操作必须进入异步任务，不能在后台 HTTP 请求内直接长时间轮询。
8. 所有平台 ID 按字符串保存和传递，不能转成 JavaScript number。

## 6. 推荐部署方案

### 6.1 推荐：增加共享数据库 schema

如果 QuicK ReeLS 和 taletv 使用的是同一个 PostgreSQL 数据库，建议新增：

```text
shared_platform
```

专门保存：

- 共享 BytePlus 媒资。
- 共享 TikTok 主剧目。
- 跨小程序授权关系。
- 跨小程序平台任务。

优点：

- 不依赖某一个小程序的业务 schema。
- 主小程序可以更换。
- 其他小程序可以继续接入。
- 不破坏现有用户、内容和广告隔离。
- 共享数据有明确的所有权边界。

### 6.2 如果两个小程序使用不同 PostgreSQL 数据库

使用一个独立的共享平台数据库：

```env
PLATFORM_SHARED_DATABASE_URL=postgresql://.../quickreels-platform?schema=public
```

API 进程额外创建一个 `sharedPlatformPrisma` 客户端，所有共享媒资和 TikTok 授权任务都通过这个客户端读写。

不要把共享媒资只放在主小程序数据库中。否则主小程序数据库不可用时，taletv 无法获取媒资授权状态。

### 6.3 不建议：只在两个业务 schema 各复制一份字段

以下做法只能作为临时兼容方案，不能作为最终架构：

```text
main.Episode.byteplusVid = V001
taletv.Episode.byteplusVid = V001
```

问题：

- 无法知道两个字段是否仍然代表同一个媒资。
- 无法统一记录 BytePlus 账号和 Space。
- 无法统一处理媒资删除、迁移和冲突。
- 无法保存主剧目与目标小程序的授权状态。
- 容易再次出现重复上传。

## 7. 数据模型设计

下面的模型是推荐逻辑模型。实际 Prisma 命名可以按项目风格调整。

### 7.1 共享媒资表

```prisma
enum SharedMediaStatus {
  PENDING
  UPLOADING
  READY
  FAILED
  DELETED
  CONFLICT
}

model SharedMediaAsset {
  id                 String            @id @default(cuid())
  byteplusVid        String            @unique
  byteplusAccountId  String
  byteplusSpaceName  String
  byteplusRegion     String
  sourceSha256       String?
  sourceFileName     String?
  title              String?
  coverUrl           String?
  durationMs         Int?
  status             SharedMediaStatus @default(PENDING)
  firstUploadedByApp String
  firstUploadJobId   String?
  lastVerifiedAt     DateTime?
  lastError          String?
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt

  episodeBindings    SharedEpisodeMedia[]

  @@unique([sourceSha256, byteplusAccountId, byteplusSpaceName])
  @@index([status, updatedAt])
  @@index([byteplusAccountId, byteplusSpaceName])
}
```

注意：

- `sourceSha256` 只能用于本地文件去重。
- URL 上传不能只根据 URL 去重，因为同一个 URL 可能返回不同内容。
- `byteplusVid` 是最终权威的 BytePlus 资源标识。
- 如果平台允许同一个 VID 在不同 Space 中出现，唯一键必须包含 Account ID、Space 和 Region。

### 7.2 共享剧目表

```prisma
model SharedTikTokAlbum {
  id                 String   @id @default(cuid())
  canonicalKey       String   @unique
  ownerMiniAppKey    String
  tiktokAlbumId      String   @unique
  currentVersion     Int?
  onlineVersion      Int?
  reviewStatus       String?
  publishStatus      String?
  platformPublishedAt DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  episodes           SharedTikTokEpisode[]
  authorizations     MiniAppAlbumAuthorization[]
  bindings           LocalAlbumBinding[]
  operations         SharedPlatformOperation[]

  @@index([ownerMiniAppKey, updatedAt])
}

model SharedTikTokEpisode {
  id                String   @id @default(cuid())
  sharedAlbumId     String
  episodeKey        String
  episodeNo         Int
  tiktokEpisodeId   String
  tiktokCoverPicId  String?
  sharedMediaId     String
  title             String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  album             SharedTikTokAlbum @relation(fields: [sharedAlbumId], references: [id], onDelete: Cascade)
  media             SharedMediaAsset  @relation(fields: [sharedMediaId], references: [id])

  @@unique([sharedAlbumId, episodeKey])
  @@unique([sharedAlbumId, episodeNo])
  @@unique([tiktokEpisodeId])
}
```

### 7.3 小程序授权表

```prisma
enum AlbumAuthorizationStatus {
  PENDING
  AUTHORIZING
  AUTHORIZED
  REVOKING
  REVOKED
  FAILED
  CONFLICT
}

model MiniAppAlbumAuthorization {
  id                String                    @id @default(cuid())
  sharedAlbumId     String
  miniAppKey        String
  targetClientKey   String
  targetAppId       String?
  status            AlbumAuthorizationStatus @default(PENDING)
  providerRequestId String?
  providerResponse  Json?
  errorCode         String?
  errorMessage      String?
  authorizedAt      DateTime?
  revokedAt         DateTime?
  lastReconciledAt  DateTime?
  createdAt         DateTime                  @default(now())
  updatedAt         DateTime                  @updatedAt

  album             SharedTikTokAlbum @relation(fields: [sharedAlbumId], references: [id], onDelete: Cascade)

  @@unique([sharedAlbumId, miniAppKey])
  @@unique([sharedAlbumId, targetClientKey])
  @@index([miniAppKey, status])
}
```

### 7.4 本地业务映射表

共享平台表不能直接给各业务 schema 建跨数据库外键，因此需要保存字符串映射：

```prisma
model LocalAlbumBinding {
  id             String   @id @default(cuid())
  sharedAlbumId  String
  miniAppKey     String
  localAlbumId   String
  localEpisodeMap Json?
  bindingStatus  String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([miniAppKey, localAlbumId])
  @@unique([sharedAlbumId, miniAppKey])
}
```

如果共享平台数据库和业务数据库在同一个 PostgreSQL schema 中，也可以通过关系字段加强约束；如果是不同数据库，只能由服务端事务和对账任务保证一致性。

### 7.5 共享平台任务表

建议不要直接复用各业务 schema 内的 `PlatformSyncJob` 处理跨小程序授权。增加共享任务表：

```prisma
enum SharedPlatformOperationKind {
  AUTHORIZE_ALBUM
  REVOKE_ALBUM
  RECONCILE_ALBUM
  VERIFY_MEDIA
}

model SharedPlatformOperation {
  id                 String                       @id @default(cuid())
  kind               SharedPlatformOperationKind
  status             PlatformSyncJobStatus
  sharedAlbumId      String?
  targetMiniAppKey   String?
  dedupeKey          String                       @unique
  snapshotHash       String?
  snapshotJson       Json?
  providerRequestId  String?
  providerResponse   Json?
  errorCode          String?
  errorMessage       String?
  attemptCount       Int                          @default(0)
  nextAttemptAt      DateTime?
  startedAt          DateTime?
  completedAt        DateTime?
  createdAt          DateTime                     @default(now())
  updatedAt          DateTime                     @updatedAt

  album              SharedTikTokAlbum? @relation(fields: [sharedAlbumId], references: [id], onDelete: Cascade)

  @@index([status, nextAttemptAt])
  @@index([sharedAlbumId, createdAt])
}
```

## 8. 小程序注册配置

当前代码只有 `main` 和 `taletv` 两个上下文，后续应从硬编码切换为服务端小程序注册表。

### 8.1 推荐配置

```env
MINI_APPS_JSON=[{"key":"main","name":"QuicK ReeLS","clientKey":"...","appId":"..."},{"key":"taletv","name":"taletv","clientKey":"...","appId":"..."}]
PLATFORM_SHARED_DATABASE_URL=...
SHARED_PLATFORM_OWNER_APP_KEY=main
```

不要把 `client_secret` 放在 JSON 或日志中。建议继续使用独立环境变量：

```env
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TALETV_TIKTOK_CLIENT_KEY=...
TALETV_TIKTOK_CLIENT_SECRET=...
```

服务端应提供：

```typescript
type MiniAppPlatformContext = {
  miniAppKey: string;
  appId: string;
  clientKey: string;
  clientSecret: string;
};
```

### 8.2 Token 缓存必须按小程序隔离

当前 `TikTokShortDramaApiService` 只缓存一组：

```typescript
private accessToken: string | null = null;
private accessTokenExpiresAt = 0;
```

改造后必须按 `clientKey` 缓存：

```typescript
Map<clientKey, {
  accessToken: string;
  expiresAt: number;
}>
```

原因：

- `album/authorize` 的调用者是主小程序。
- 目标小程序的对账可能使用目标小程序凭证。
- 不同 Client Key 不能共用同一 access token。
- 多进程部署时应使用 Redis 或数据库锁避免重复刷新 Token。

## 9. API Client 改造

### 9.1 保留现有接口

以下方法继续保留，但不能再把小程序上下文隐式固定在构造函数内：

```typescript
createImage(appContext, input)
createVideo(appContext, input)
getVideo(appContext, input)
createAlbum(appContext)
updateAlbumVersion(appContext, input)
queryAlbum(appContext, input)
submitReview(appContext, input)
setOnlineVersion(appContext, input)
setAlbumStatus(appContext, input)
```

推荐将接口改成：

```typescript
type TikTokApiContext = {
  miniAppKey: string;
  clientKey: string;
  clientSecret: string;
};
```

### 9.2 新增授权方法

```typescript
async authorizeAlbum(input: {
  ownerContext: TikTokApiContext;
  albumId: string;
  targetClientKeys: string[];
}) {
  return this.request(
    input.ownerContext,
    '/v2/sg/shortdrama/album/authorize/',
    'POST',
    {
      album_id: input.albumId,
      operate_type: 1,
      target_client_key_list: input.targetClientKeys
    }
  );
}
```

实现要求：

1. 使用主剧目拥有者的 Token 调用授权接口。
2. 目标 Client Key 必须从服务端小程序注册表获取。
3. 不允许管理员从请求体直接传入任意 Client Key。
4. 目标小程序必须已配置并处于启用状态。
5. 请求和响应中保存 `log_id` 或等价平台请求 ID。
6. 保存脱敏后的平台响应，不保存 Token、Secret 或完整 Authorization Header。
7. 统一按字符串处理 `album_id` 和 `episode_id`。

### 9.3 新增授权查询/对账能力

如果官方接口提供授权查询方法，直接封装：

```typescript
queryAlbumAuthorization(ownerContext, {
  albumId,
  targetClientKeys
})
```

如果官方只在授权接口返回状态，则本地必须保存：

- 请求 ID。
- 请求时间。
- 目标 Client Key。
- 返回状态。
- 最近一次对账时间。

不能把“请求成功但数据库未保存”当作失败后直接重复授权。必须进入 `CONFLICT`，然后执行授权对账。

## 10. BytePlus 复用流程

### 10.1 新视频上传

新视频的正式流程改为：

```text
计算本地文件 SHA-256
  -> 查询 SharedMediaAsset(sourceSha256, account, space)
  -> 找到 READY 记录
       -> 直接绑定现有 byteplusVid
  -> 未找到
       -> 上传 BytePlus
       -> 创建 SharedMediaAsset
       -> 保存 byteplusVid
```

必须在服务器端计算 SHA-256，不能信任前端传入的 hash。

### 10.2 URL 上传

URL 上传不应只根据 URL 去重：

```text
URL 相同 != 文件内容相同
```

推荐流程：

1. URL 任务先上传 BytePlus。
2. BytePlus 返回 VID 后写入 `SharedMediaAsset`。
3. 后续复用直接选择共享媒资记录或输入已知 VID。
4. 如果运营人员手工输入 VID，调用 `GetMediaInfos` 验证 VID 存在。
5. 验证其 Account ID、Space、Region 与当前共享配置匹配。

### 10.3 已有 BytePlus VID 绑定

保留现有：

```text
POST /admin/episodes/:episodeId/bind-byteplus
```

但改造为：

```text
POST /admin/episodes/:episodeId/bind-shared-media
{
  "sharedMediaAssetId": "..."
}
```

兼容旧请求时允许传 `byteplusVid`，服务端执行：

1. 在共享媒资表查找。
2. 查不到则调用 BytePlus `GetMediaInfos`。
3. 验证所属账号和 Space。
4. 创建 `SharedMediaAsset`。
5. 将当前小程序的 Episode 绑定到共享媒资。
6. 不执行 BytePlus 上传。

### 10.4 不允许的行为

当共享媒资已经存在并且状态为 `READY` 时：

- 不得因为当前小程序没有本地 `byteplusVid` 就重新上传。
- 不得用新的随机 dedupe key 创建 BytePlus 上传任务。
- 不得自动覆盖共享媒资的 VID。
- 不得在没有平台对账的情况下把共享媒资标记为已删除。

## 11. TikTok 剧目复用流程

### 11.1 主小程序首次发布

主小程序，例如 `main`，执行：

```text
1. 上传或绑定共享 BytePlus 视频
2. 登记 TikTok 视频媒资
3. 同步封面
4. 创建 SharedTikTokAlbum
5. 调用 album/update
6. 保存 album_id、version、episode_id_map
7. 提交审核
8. 查询审核结果
9. 设置线上版本
10. 上架
```

### 11.2 授权到目标小程序

管理员在主剧目详情中选择目标小程序，例如 `taletv`：

```text
1. 校验主剧目已经有 tiktokAlbumId
2. 校验主版本已经审核通过
3. 校验主剧目已设置线上版本
4. 校验 taletv 已配置 client_key
5. 校验 taletv 与共享 BytePlus Account ID 绑定
6. 创建 MiniAppAlbumAuthorization(PENDING)
7. 创建 SharedPlatformOperation(AUTHORIZE_ALBUM)
8. Worker 调用 album/authorize
9. 保存授权结果
10. 使用目标上下文对账
11. 标记 taletv = AUTHORIZED
12. 建立 taletv 本地 Album/Episode 映射
```

### 11.3 目标小程序不再走重复送审

当目标授权状态为 `AUTHORIZED` 时，前端不再显示：

```text
同步版本
送审
设线上版本
```

前端显示：

```text
已复用主剧目
授权状态：已授权
主剧目：album_id
当前版本：version
审核状态：审核通过
线上版本：online_version
操作：对账、撤销授权
```

如果目标小程序需要独立的内容版本，应选择：

```text
创建独立 TikTok 剧目
```

并明确提示：

```text
独立剧目不能直接复用主剧目的审核结果，需要重新同步版本并按平台要求送审。
```

## 12. 本地业务数据同步策略

共享 TikTok 剧目与每个小程序本地 CMS 内容不是同一个实体，需要显式映射。

### 12.1 授权成功后创建本地映射

目标小程序授权成功后：

1. 根据管理员选择或 `canonicalKey` 找到目标小程序本地 Album。
2. 创建 `LocalAlbumBinding`。
3. 将目标本地 Album 的平台投影字段更新为：

```text
tiktokAlbumId = shared.tiktokAlbumId
tiktokVersion = shared.currentVersion
onlineVersion = shared.onlineVersion
reviewStatus = shared.reviewStatus
publishStatus = shared.publishStatus
```

4. 对每个本地 Episode：

```text
byteplusVid = sharedEpisode.media.byteplusVid
tiktokEpisodeId = sharedEpisode.tiktokEpisodeId
tiktokVideoStatus = READY
```

5. 记录数据来源：

```text
platformBindingMode = SHARED_AUTHORIZATION
```

如果不想立即新增枚举字段，至少将其放进共享映射表，不要仅依赖 `tiktokAlbumId` 是否为空判断模式。

### 12.2 共享状态是权威，本地字段是投影

目标小程序的本地字段不能独立修改共享平台状态。

推荐规则：

```text
SharedTikTokAlbum.reviewStatus
  -> 目标授权关系的展示状态
  -> 目标业务 schema 中的缓存字段
```

主剧目对账成功后，发布事件或 Worker 同步所有已授权目标：

```text
主剧目状态变化
  -> 更新共享主剧目
  -> 更新授权关系
  -> 更新每个目标小程序本地缓存
```

### 12.3 内容变化处理

如果主小程序修改标题、简介、封面或分集：

```text
修改主内容
  -> 创建新的 album version
  -> 重新送审主版本
  -> 审核通过
  -> 设置新的 online version
  -> 已授权小程序继续引用同一个 album_id
```

目标小程序不需要重新上传或重新送审，但必须重新对账并刷新本地映射。

如果目标小程序需要不同标题、不同分集顺序或不同内容：

```text
不能继续使用共享 album_id
必须创建独立 album_id
独立同步版本和审核
```

## 13. 后端接口设计

### 13.1 查询共享媒资

```http
GET /admin/shared-media-assets
```

支持参数：

```text
status
byteplusVid
sourceSha256
page
pageSize
```

返回：

```json
{
  "items": [
    {
      "id": "media-1",
      "byteplusVid": "v001",
      "byteplusAccountId": "account-1",
      "byteplusSpaceName": "space-1",
      "durationMs": 420000,
      "status": "READY",
      "boundEpisodeCount": 6
    }
  ]
}
```

### 13.2 绑定共享媒资

```http
POST /admin/episodes/:episodeId/bind-shared-media
```

请求：

```json
{
  "sharedMediaAssetId": "media-1"
}
```

服务端必须校验：

- 当前管理员有 `content.write` 或 `content.sync` 权限。
- 共享媒资状态为 `READY`。
- BytePlus Account ID、Space、Region 与当前配置匹配。
- 当前 Episode 不属于已上架且不可变的版本，或要求先创建内容变更。

### 13.3 查询共享剧目

```http
GET /admin/shared/albums/:sharedAlbumId
```

返回：

- 主剧目 ID。
- 当前版本。
- 审核状态。
- 上线版本。
- 每集映射。
- 所有目标小程序授权状态。

### 13.4 授权剧目到其他小程序

```http
POST /admin/shared/albums/:sharedAlbumId/authorizations
```

请求：

```json
{
  "targetMiniAppKey": "taletv",
  "localAlbumId": "taletv-local-album-id"
}
```

服务端不允许前端直接传：

```text
targetClientKey
targetAppId
albumId
```

这些值必须根据服务端配置和共享主剧目记录解析。

### 13.5 对账

```http
POST /admin/shared/albums/:sharedAlbumId/reconcile
POST /admin/shared/albums/:sharedAlbumId/authorizations/:miniAppKey/reconcile
```

用途：

- 授权接口返回后本地保存失败。
- Worker 重启。
- 平台返回结果未知。
- 目标小程序状态可能被平台侧变更。

### 13.6 撤销授权

```http
POST /admin/shared/albums/:sharedAlbumId/authorizations/:miniAppKey/revoke
```

撤销必须是异步操作，不能直接删除授权记录。保留审计记录和平台响应。

## 14. Worker 改造

### 14.1 新增任务类型

共享平台任务增加：

```text
AUTHORIZE_ALBUM
REVOKE_ALBUM
RECONCILE_ALBUM
VERIFY_MEDIA
```

### 14.2 `AUTHORIZE_ALBUM` 处理流程

伪代码：

```typescript
async function processAuthorizeAlbum(job: SharedPlatformOperation) {
  const album = await sharedDb.sharedTikTokAlbum.findUniqueOrThrow({
    where: { id: job.sharedAlbumId },
    include: { authorizations: true }
  });

  const targetKey = job.targetMiniAppKey;
  const target = miniAppRegistry.require(targetKey);

  const existing = await sharedDb.miniAppAlbumAuthorization.findUnique({
    where: {
      sharedAlbumId_miniAppKey: {
        sharedAlbumId: album.id,
        miniAppKey: targetKey
      }
    }
  });

  if (existing?.status === 'AUTHORIZED') {
    await completeJob(job, { alreadyAuthorized: true });
    return;
  }

  const result = await tiktok.authorizeAlbum({
    ownerContext: miniAppRegistry.require(album.ownerMiniAppKey),
    albumId: album.tiktokAlbumId,
    targetClientKeys: [target.clientKey]
  });

  await transaction(async (tx) => {
    await tx.miniAppAlbumAuthorization.update({
      where: { id: existing!.id },
      data: {
        status: 'AUTHORIZED',
        authorizedAt: now,
        providerRequestId: result.requestId,
        providerResponse: result.raw
      }
    });

    await completeJob(tx, job, {
      providerRequestId: result.requestId,
      providerResponse: result.raw
    });
  });
}
```

实际实现时不要假设返回结构永远与伪代码相同，必须按官方当前响应结构解析并做 schema 校验。

### 14.3 任务幂等键

新增授权任务的 dedupe key：

```text
AUTHORIZE_ALBUM:{sharedAlbumId}:{targetMiniAppKey}:{albumVersion}
```

如果授权是 album 级而不是 version 级，以官方语义为准，可使用：

```text
AUTHORIZE_ALBUM:{sharedAlbumId}:{targetMiniAppKey}
```

重复点击按钮时：

- `PENDING` 或 `PROCESSING`：返回现有任务。
- `SUCCEEDED` 且授权仍有效：直接返回已授权。
- `FAILED`：允许管理员明确重试。
- `CONFLICT`：必须先对账。

### 14.4 不要自动重放未知授权结果

如果 API 请求已经发出，但本地在保存结果时失败：

```text
平台可能已经授权
本地可能没有授权
```

此时任务应标记：

```text
CONFLICT
```

而不是自动再次调用授权接口。先执行对账，确认目标 Client Key 的状态，再决定是否重试。

## 15. 后台页面调整

### 15.1 主剧目页面

在当前“TikTok 媒资库发布链路”下增加一个“授权小程序”区域：

| 字段 | 说明 |
| --- | --- |
| 主剧目 ID | `album_id` |
| 主小程序 | 例如 QuicK ReeLS |
| 当前版本 | TikTok 当前版本 |
| 审核状态 | 平台真实状态 |
| 线上版本 | 平台真实状态 |
| 目标小程序 | taletv、其他已注册小程序 |
| 授权状态 | 待授权、处理中、已授权、失败、冲突 |
| 最近对账 | 最后一次查询时间 |

### 15.2 目标小程序页面

当当前后台选择 `taletv` 时：

如果存在已授权主剧目：

```text
显示：已复用主剧目
显示：主剧目 album_id
显示：授权状态
显示：审核状态
显示：线上版本
提供：对账、刷新本地映射、撤销授权
隐藏：同步版本、送审
```

如果没有授权关系：

```text
提供：选择现有共享剧目并申请授权
提供：创建独立剧目
```

两者必须明确区分，不能让“同步媒资”按钮隐式创建新剧目。

### 15.3 内容表单

新增字段或提示：

```text
媒资来源：
  - 新上传到 BytePlus
  - 选择已有共享媒资

TikTok 发布模式：
  - 复用已有主剧目
  - 创建独立剧目
```

如果选择“复用已有主剧目”，内容变更必须遵循共享剧目的版本策略。

## 16. 现有字段兼容策略

第一阶段不要立即删除现有字段：

```text
Album.tiktokAlbumId
Album.tiktokVersion
Album.onlineVersion
Album.reviewStatus
Album.publishStatus
Episode.byteplusVid
Episode.tiktokEpisodeId
Episode.tiktokVideoStatus
```

改为：

```text
共享平台表 = 权威来源
现有 Album/Episode 字段 = 当前小程序的读取缓存/投影
```

### 16.1 读取优先级

后台和公开接口读取平台状态时：

1. 先读取共享绑定状态。
2. 共享绑定存在时，以共享平台状态为准。
3. 共享数据暂时不可用时，使用本地缓存，但标记为 stale。
4. 不允许使用过期缓存直接执行上架或公开播放。

### 16.2 写入规则

以下字段只能由 Worker 或共享平台同步服务写入：

```text
Album.tiktokAlbumId
Album.tiktokVersion
Album.onlineVersion
Album.reviewStatus
Album.publishStatus
Episode.tiktokEpisodeId
Episode.tiktokVideoStatus
```

普通 PATCH 和内容编辑接口不得接收这些字段。

## 17. 旧数据迁移方案

### 17.1 迁移前备份

生产执行前必须完成：

```bash
pg_dump --format=custom --file=before-shared-platform.dump "$DATABASE_URL"
```

如果主库和 taletv 是不同数据库，分别备份：

```bash
pg_dump --format=custom --file=before-main.dump "$MAIN_DATABASE_URL"
pg_dump --format=custom --file=before-taletv.dump "$TALETV_DATABASE_URL"
```

同时保存：

- 当前环境变量清单的脱敏版本。
- 当前 BytePlus Account ID、Space Name、Region。
- 当前所有 `Album.tiktokAlbumId`。
- 当前所有 `Episode.byteplusVid`。
- 当前所有 `PlatformSyncJob`。

### 17.2 建立共享媒资

对所有已有 Episode 执行：

1. 读取 `byteplusVid`。
2. 按 `byteplusVid` 去重。
3. 调用 BytePlus `GetMediaInfos` 验证资源仍存在。
4. 验证账号、Space 和 Region。
5. 创建 `SharedMediaAsset`。
6. 将本地 Episode 绑定到共享媒资。

如果同一个 VID 在多个业务 schema 出现：

```text
只创建一条 SharedMediaAsset
建立多个本地绑定
```

### 17.3 建立主剧目

对已经存在 TikTok `album_id` 的剧目：

1. 选择一个主小程序作为 `ownerMiniAppKey`。
2. 创建 `SharedTikTokAlbum`。
3. 从主小程序读取 `tiktokVersion`、`onlineVersion`、审核和上架状态。
4. 从主小程序读取每集 `tiktokEpisodeId`。
5. 创建 `SharedTikTokEpisode`。
6. 将共享 Episode 映射到共享 BytePlus VID。
7. 建立主小程序 `LocalAlbumBinding`。

### 17.4 识别冲突

以下情况不能自动合并：

- 两个小程序的 `tiktokAlbumId` 不同，但标题和分集看起来相同。
- 同一个本地 Episode 的 BytePlus VID 不同。
- 同一个 `tiktokAlbumId` 的分集映射不一致。
- 主版本号不同且两个版本都在审核或已上架。
- BytePlus VID 属于不同 Account ID 或 Space。

冲突处理：

```text
SharedMediaAsset = CONFLICT
或
SharedTikTokAlbum = CONFLICT
```

由管理员人工选择主记录，不得自动覆盖平台 ID。

### 17.5 处理已有 taletv 数据

如果 taletv 以前已经独立创建过 TikTok 剧目：

- 保留原有 `album_id` 和审计记录。
- 不自动删除或撤销。
- 由管理员选择：
  - 继续作为独立剧目维护；或
  - 新建共享主剧目授权关系。
- 如果采用共享主剧目，先完成平台授权，再将 taletv 本地内容绑定到共享主剧目。
- 确认播放链路和上线状态后，再决定是否下线旧剧目。

不能在没有平台确认的情况下直接把旧 `album_id` 替换为新 `album_id`。

## 18. 上线实施阶段

### 阶段 A：平台能力验证

先不要改生产数据，使用测试剧目完成以下验证：

1. QuicK ReeLS 和 taletv 都绑定同一个 BytePlus Account ID。
2. BytePlus 使用同一个 Space。
3. QuicK ReeLS 上传视频并得到 VID。
4. QuicK ReeLS 创建 TikTok 剧目。
5. QuicK ReeLS 同步版本并审核通过。
6. 使用 QuicK ReeLS 凭证调用 `album/authorize`。
7. 目标为 taletv Client Key。
8. 使用 taletv 凭证查询或访问该剧目。
9. 验证 taletv 不需要重新上传、不需要创建新 album、不需要重复送审。
10. 验证目标小程序实际播放。
11. 验证撤销授权后目标小程序不可继续使用。

必须保存：

- 请求时间。
- 平台 `log_id`。
- 脱敏请求摘要。
- 脱敏响应。
- 主 `album_id`。
- 目标 `client_key`。
- 目标 Mini App App ID。

### 阶段 B：共享数据模型

完成：

1. 新增共享 schema 或共享数据库。
2. 新增 Prisma schema 和 migration。
3. 生成共享 Prisma Client。
4. 增加共享平台配置加载。
5. 增加小程序注册表。
6. 增加共享平台任务 Worker。
7. 增加 API Client 的上下文参数。

执行：

```bash
pnpm --filter api db:generate
pnpm --filter api build
pnpm --filter api test
```

### 阶段 C：新数据先走共享链路

新创建内容必须按以下规则：

```text
上传文件
  -> 查询共享媒资
  -> 找到则复用
  -> 找不到才上传
```

主小程序：

```text
创建主剧目并送审
```

目标小程序：

```text
选择共享剧目并授权
```

### 阶段 D：迁移旧数据

按单部测试剧目迁移：

1. 备份。
2. 创建共享媒资。
3. 创建共享主剧目。
4. 建立主小程序绑定。
5. 建立目标小程序授权。
6. 目标小程序对账。
7. 播放测试。
8. 再迁移下一部。

不要一次性迁移所有生产剧目。

### 阶段 E：切换后台按钮

确认共享链路稳定后：

- 将“同步媒资”拆成“同步独立媒资”和“复用共享媒资”。
- 将“送审”按钮限制为主剧目模式。
- 增加“授权到小程序”按钮。
- 对已授权目标隐藏重复送审按钮。
- 对独立剧目保留原有链路。

## 19. 错误处理与补偿

### 19.1 BytePlus 已上传但本地保存失败

处理：

1. 不立即再次上传。
2. 根据本地文件 SHA-256、文件名和上传时间查询 BytePlus。
3. 由管理员选择确认已有 VID。
4. 创建或修复 `SharedMediaAsset`。
5. 重新绑定本地 Episode。

### 19.2 TikTok 视频登记未知

处理：

```text
VIDEO 任务 -> CONFLICT
```

执行：

1. 用 VID 查询 TikTok 视频登记状态。
2. 如果已完成，写入共享媒资映射。
3. 如果未完成，重新排队。
4. 如果平台拒绝，保留错误，不上传 BytePlus 新视频。

### 19.3 `album/authorize` 请求未知

处理：

```text
AUTHORIZE_ALBUM -> CONFLICT
```

执行：

1. 查询目标授权状态。
2. 确认目标 Client Key 是否已授权。
3. 已授权则补写本地状态。
4. 未授权且平台确认请求未生效，再允许人工重试。

### 19.4 目标 Client Key 未绑定 BytePlus 账号

返回明确错误：

```text
目标小程序尚未绑定当前共享 BytePlus Account ID，无法授权复用剧目。
```

不要自动切换 BytePlus 账号，不要重新上传到另一个 Space。

### 19.5 主剧目审核被拒

共享目标都不能显示“审核通过”。

处理：

1. 主剧目进入 `REJECTED`。
2. 所有目标授权关系显示“主剧目审核未通过”。
3. 修复主内容。
4. 创建新版本。
5. 主版本重新送审。
6. 审核通过后，目标小程序继续引用同一个 `album_id` 的新线上版本。

### 19.6 主剧目下架

主剧目下架时，所有授权目标都应进入不可播放或待同步状态，直到重新上架。

本地公开接口必须继续执行：

```text
Album.status = ONLINE
且
平台 reviewStatus = PASSED
且
平台 publishStatus = LISTED
且
platformPublishedVersion = onlineVersion
```

不能只依赖本地授权记录显示内容可播放。

## 20. 权限与审计

建议权限：

```text
content.shared-media.read
content.shared-media.bind
content.shared-album.authorize
content.shared-album.reconcile
content.shared-album.revoke
```

角色建议：

- `OWNER`：可以授权、撤销授权、处理冲突。
- `EDITOR`：可以查看共享媒资和绑定共享媒资。
- `ANALYST`：只读。
- `SUPPORT`：可以查看状态和执行对账，但不能授权或撤销。

审计事件：

```text
CREATE_SHARED_MEDIA
BIND_SHARED_MEDIA
CREATE_SHARED_ALBUM
AUTHORIZE_SHARED_ALBUM
RECONCILE_SHARED_ALBUM
REVOKE_SHARED_ALBUM
MIGRATE_PLATFORM_BINDING
RESOLVE_SHARED_PLATFORM_CONFLICT
```

审计内容至少包含：

- 管理员 ID。
- 当前小程序。
- 主剧目 ID。
- 目标小程序。
- 目标 Client Key 的脱敏值。
- 任务 ID。
- 平台 Request ID。
- 结果。

## 21. 测试方案

### 21.1 单元测试

必须覆盖：

1. 同一个 SHA-256 不重复创建 BytePlus 上传。
2. 同一个 BytePlus VID 只产生一条共享媒资。
3. 不同 Space 的同名 VID 不会错误合并。
4. Token 缓存按 Client Key 隔离。
5. `album/authorize` payload 字段正确。
6. Client Key 不允许由前端直接指定。
7. 已授权目标重复点击不产生第二个任务。
8. 授权未知结果进入 `CONFLICT`。
9. 对账成功后可以修复本地状态。
10. 独立剧目仍能走原有同步和审核流程。

### 21.2 API 集成测试

使用 mock provider 验证：

```text
POST /admin/episodes/:id/bind-shared-media
POST /admin/shared/albums/:id/authorizations
POST /admin/shared/albums/:id/reconcile
POST /admin/shared/albums/:id/authorizations/:app/revoke
```

验证：

- 权限。
- 输入校验。
- 幂等。
- 任务状态。
- 审计记录。
- 错误码。

### 21.3 Worker 测试

模拟：

1. 授权成功。
2. 授权失败。
3. 网络超时。
4. 平台已授权但本地保存失败。
5. Worker 重启后任务继续。
6. 任务重复执行。
7. 目标小程序配置不存在。
8. 主剧目被删除。
9. 主版本变化。
10. 目标授权被平台侧撤销。

### 21.4 真实平台验收

验收清单：

- BytePlus 只产生一次上传记录。
- QuickReels 与 taletv 使用相同 BytePlus VID。
- 两个小程序使用相同 `album_id`。
- 两个小程序使用相同对应 `episode_id`。
- taletv 不产生新的 `album/create`。
- taletv 不产生新的 `album/review/submit`。
- taletv 能实际播放。
- 主剧目版本更新后，taletv 对账可以看到新线上版本。
- 撤销授权后，taletv 不再可播放。
- 审计可以追溯所有平台请求。

## 22. 监控与告警

监控指标：

```text
shared_media_upload_total
shared_media_reuse_total
shared_media_bind_failure_total
tiktok_album_authorize_total
tiktok_album_authorize_failure_total
tiktok_album_authorize_conflict_total
tiktok_shared_album_reconcile_total
tiktok_shared_album_reconcile_failure_total
```

告警条件：

- 共享授权任务连续失败。
- `CONFLICT` 超过 10 分钟未处理。
- 平台授权状态与本地状态不一致。
- 共享媒资对应的 BytePlus VID 查询不到。
- 主剧目已上架但目标授权仍为失败。
- 同一文件 SHA-256 在短时间内产生多个 BytePlus VID。

日志禁止出现：

- TikTok access token。
- TikTok Client Secret。
- BytePlus Access Key。
- BytePlus Secret Key。
- 完整 Authorization Header。

## 23. 回滚方案

### 23.1 功能开关

增加服务端开关：

```env
SHARED_TIKTOK_ALBUM_ENABLED=false
SHARED_MEDIA_REUSE_ENABLED=false
```

建议分别控制：

- 共享 BytePlus 媒资复用。
- TikTok 主剧目授权。
- 目标小程序共享播放。

### 23.2 回滚原则

如果共享授权链路出现问题：

1. 关闭新授权入口。
2. 保留已经写入的共享数据。
3. 不删除平台授权。
4. 继续允许主小程序使用原有链路。
5. 目标小程序回退到原有独立剧目，仅针对未切换的数据。
6. 已经使用共享 `album_id` 的目标小程序不能直接把本地字段改回旧状态，必须先完成平台对账。

## 24. 推荐的代码改造顺序

按以下顺序实施，避免一次修改所有模块：

### 第一步：共享平台基础设施

新增：

```text
apps/api/src/services/shared-platform.service.ts
apps/api/src/services/shared-media.service.ts
apps/api/src/services/mini-app-registry.service.ts
apps/api/src/jobs/shared-platform.worker.ts
```

建立：

- 共享 Prisma Client。
- 小程序注册表。
- 共享媒资读写。
- 共享任务状态机。

### 第二步：TikTok API Client 上下文化

改造：

```text
apps/api/src/services/tiktok-short-drama-api.service.ts
```

要求：

- 方法显式接收 `TikTokApiContext`。
- Token 按 Client Key 缓存。
- 新增 `authorizeAlbum()`。
- 增加响应 schema 校验。
- 增加平台 Request ID 保存能力。

### 第三步：BytePlus 共享媒资

改造：

```text
apps/api/src/services/byteplus-vod.service.ts
apps/api/src/modules/admin/routes.ts
```

增加：

- SHA-256 去重。
- 共享媒资查询。
- 已有 VID 绑定。
- Account/Space/Region 校验。

### 第四步：平台映射和授权

改造：

```text
apps/api/src/services/platform-sync.service.ts
apps/api/src/jobs/tiktok-short-drama.worker.ts
apps/api/src/modules/admin/routes.ts
```

增加：

- 主剧目创建。
- 目标小程序授权。
- 授权对账。
- 授权撤销。
- 共享状态向本地业务 schema 投影。

### 第五步：管理后台

改造：

```text
apps/admin-web/src/main.tsx
apps/admin-web/src/styles.css
```

增加：

- 共享媒资选择器。
- 主剧目/独立剧目模式。
- 目标小程序授权表。
- 授权状态和冲突状态。
- 对账和撤销操作。

### 第六步：公开播放校验

改造：

```text
apps/api/src/lib/content-visibility.ts
apps/api/src/modules/albums/routes.ts
apps/api/src/modules/episodes/routes.ts
```

要求：

- 共享授权有效不是唯一播放条件。
- 仍需满足审核通过、线上版本和上架状态。
- 授权被撤销后，本地目标小程序必须不可播放。
- 平台对账失败时不能自动放宽播放条件。

## 25. 交付标准

满足以下条件才算完成：

1. 同一个视频在 BytePlus 只上传一次。
2. QuickReels 和 taletv 可以绑定同一个共享媒资。
3. 主剧目只创建一次。
4. taletv 通过 `album/authorize` 获得授权。
5. taletv 不重复创建剧目。
6. taletv 不重复送审同一剧目版本。
7. 两个小程序都能正常播放。
8. 主剧目新版本审核通过后，目标小程序可以通过对账刷新。
9. 授权失败、未知、撤销都有明确状态。
10. 旧的独立剧目数据不被静默覆盖。
11. 所有操作有审计记录。
12. 真实平台联调完成并保存请求 ID。
13. 单元测试、API 测试、Worker 测试全部通过。
14. 生产上线有备份、开关和回滚步骤。

## 26. 最终推荐的运营操作流程

### 新剧首次发布

```text
1. 在主小程序创建剧目
2. 上传视频到 BytePlus
3. 系统创建 SharedMediaAsset
4. 同步 TikTok 视频媒资
5. 同步主剧目版本
6. 主剧目送审
7. 审核通过
8. 设置线上版本
9. 上架
10. 授权给 taletv 和其他目标小程序
```

### 已有视频新增到其他小程序

```text
1. 选择已有共享媒资
2. 不上传 BytePlus
3. 选择已有共享主剧目
4. 发起 album/authorize
5. 等待授权任务完成
6. 对账
7. 建立本地内容映射
8. 测试播放
```

### 主剧目更新

```text
1. 修改主剧目内容
2. 创建新 TikTok 版本
3. 主版本送审
4. 审核通过
5. 设置线上版本
6. 对所有目标小程序执行对账
7. 验证新版本播放
```

### 目标小程序需要完全不同的内容

```text
1. 选择“创建独立剧目”
2. 可继续复用相同 BytePlus VID
3. 创建新的 album_id
4. 同步独立版本
5. 独立送审
6. 独立上架
```

## 27. 结论

在同一个 BytePlus 账号的前提下，正确的最终方案是：

```text
共享 BytePlus VID
共享 TikTok 主 album_id
通过 album/authorize 授权给目标小程序
共享主剧目审核和线上版本
小程序代码审核继续独立
```

不要把目标小程序做成新的 `album_id` 后，再尝试复制主剧目的 `reviewStatus`。那种方式既不能充分利用 TikTok 官方授权能力，也会让本地状态和平台实际状态产生风险。

本方案的第一步不是直接迁移生产数据，而是使用一部测试剧目验证：

```text
同一 BytePlus Account ID
同一 BytePlus Space
同一主 album_id
album/authorize -> 目标 client_key
目标小程序实际播放
```

验证成功后，再按照本文的共享 schema、共享媒资、授权关系和异步任务方案分阶段上线。

# BytePlus VOD 项目使用手册

本文档面向本项目 `QuicK ReeLS / QuickReels`，说明如何获取 BytePlus 账号密钥、如何配置 VOD 空间，以及后端上传 Worker 应该如何接入 BytePlus/TikTok 短剧媒资链路。

> 安全提醒：截图、聊天、前端代码、TikTok Mini ZIP、Git 仓库都不应该保存真实 `Access Key Secret`、TikTok `Client Secret` 或任何长期密钥。密钥只放在后端运行环境或部署平台的 secret manager 中。

## 1. 本项目里 BytePlus 的角色

项目定位是 TikTok Mini Drama：

- `apps/mini-web` 是 TikTok Mini H5 前端，只拿播放所需的 `vid`、`albumId`、`episodeId` 和可选播放凭证。
- `apps/api` 是 Fastify 后端，负责登录、内容状态、上传任务、播放鉴权和运营后台 API。
- BytePlus VOD 负责托管实际视频媒资、转码、封面、媒资 ID。
- TikTok Short Drama 平台负责短剧专辑/剧集审核、上架与官方播放器能力。

当前代码已经接入了 BytePlus URL 拉取上传的后端路径：

- 环境变量校验：`apps/api/src/config/env.ts`
- 上传服务接口：`apps/api/src/services/tiktok-short-drama.service.ts`
- BytePlus VOD OpenAPI 适配：`apps/api/src/services/byteplus-vod.service.ts`
- 异步上传 Worker：`apps/api/src/jobs/tiktok-short-drama.worker.ts`
- 后台创建上传任务：`POST /api/v1/admin/upload-jobs`
- 前端播放器适配：`apps/mini-web/src/features/player/create-player.ts`

当后端环境变量存在 `BYTEPLUS_ACCESS_KEY` 和 `BYTEPLUS_SECRET_KEY` 时，Worker 会使用真实 `BytePlusVodService`。如果没有配置密钥，则回退到 `UnconfiguredTikTokShortDramaService`，上传任务会按原有重试逻辑失败。

## 1.1 官方 Getting Started 对本项目的落地解释

BytePlus 官方 Getting Started 是一条控制台试跑流程：开通 VOD、创建 Space、上传视频、选择工作流处理、添加播放域名、发布并获取播放地址。对本项目来说，它应该被拆成以下准备项：

| 官方步骤 | 本项目需要做什么 |
| --- | --- |
| Enable BytePlus VOD service | 确认 BytePlus VOD 已开通，并能进入 `vodpaas` 控制台 |
| Create a space | 为 `QuicK ReeLS` 建一个独立 Space，记录 `SpaceName` 和 Region |
| Upload a video | 首期建议使用后端 `UploadMediaByUrl`，运营后台提交公网视频直链 |
| Configure workflow template | 为短剧视频准备默认转码/封面工作流，或先选择“不转码”做验证 |
| Process uploaded video | Worker 轮询任务状态，成功后保存 `Episode.byteplusVid` 和时长 |
| Add domain name | 如果需要 BytePlus 直接生成播放地址，需要准备播放域名和 CNAME；TikTok Mini Drama 官方播放器场景下仍以 TikTok 播放链路为准 |
| Get playback address | 本项目前端不直接使用裸播放 URL，而是通过后端返回 `vid`、TikTok 平台 ID 和可选 `playAuthToken` |

所以，本项目不是简单地把 BytePlus 控制台里的播放 URL 填进 `<video>`。BytePlus 负责媒资托管和处理，TikTok Mini Drama 官方播放器负责用户端播放能力，后端负责把两边的 ID 和审核状态同步起来。

## 2. 要准备的 BytePlus 信息

本项目至少需要以下配置：

```env
BYTEPLUS_ACCOUNT_ID=你的 BytePlus Account ID
BYTEPLUS_SPACE_NAME=你的 VOD SpaceName
BYTEPLUS_REGION=ap-southeast-1
```

如果后端要直接调用 BytePlus VOD OpenAPI 或 Server SDK，还需要：

```env
BYTEPLUS_ACCESS_KEY=只放后端，不进 Git
BYTEPLUS_SECRET_KEY=只放后端，不进 Git
BYTEPLUS_VOD_ENDPOINT=https://vod.byteplusapi.com
```

`BYTEPLUS_ACCESS_KEY` 和 `BYTEPLUS_SECRET_KEY` 已经加入后端环境校验，但仍是可选项；只有配置后 Worker 才会真正调用 BytePlus VOD OpenAPI。

## 3. 如何获取 BytePlus Access Key / Secret Key

推荐做法是创建专用 IAM 用户，不使用主账号长期密钥跑生产服务。

### 3.1 推荐方式：专用 IAM 用户密钥

1. 登录 BytePlus Console：<https://console.byteplus.com/auth/login/>
2. 点击右上角用户名或头像，进入 `IAM`。
3. 进入 `User management` / `User`。
4. 新建一个专用用户，例如 `quickreels-vod-uploader`。
5. 给这个用户授予 VOD 相关权限，至少需要：
   - 读取 VOD 空间
   - 上传媒资或 URL 拉取上传
   - 查询上传任务
   - 查询媒资信息/播放信息
   - 如项目要自动触发转码或发布，还需要对应工作流、媒资管理权限
6. 打开该用户详情页，进入 `Access key` 或 `Key` 标签。
7. 点击 `Create access key`。
8. 立即下载或复制密钥证书。Secret 通常只在创建时最方便保存，之后需要通过控制台查看或轮换。

### 3.2 快速测试方式：主账号密钥

1. 登录 BytePlus Console。
2. 进入 <https://console.byteplus.com/iam/keymanage/>。
3. 点击 `Create access key`。
4. 只用于本地验证或试用，生产环境建议替换成专用 IAM 用户密钥。

### 3.3 查看、禁用、删除密钥

1. 登录 BytePlus Console。
2. 进入 `IAM`。
3. 打开 `Access key management` 或 `Key management`。
4. 在列表中可以：
   - 点击眼睛图标查看/隐藏 Secret Access Key
   - `Disable` 禁用密钥
   - `Enable` 重新启用密钥
   - `Delete` 删除密钥

BytePlus 文档说明同一个用户最多可创建两个 AccessKey。删除前通常需要先禁用。生产轮换建议先创建新密钥、更新服务环境变量、确认服务正常后，再禁用旧密钥。

## 4. 如何找到 Account ID、SpaceName 和 Region

### 4.1 Account ID

在 BytePlus 控制台通常可以从账号/用户信息、Billing/Account、IAM 用户详情或项目绑定页面看到 Account ID。你截图里的 VOD 页面已经是这个区域：

<https://console.byteplus.com/vodpaas/region:vodpaas+ap-southeast-1/overview/>

如果页面里看不到 Account ID，可以用这些入口找：

- 右上角头像/用户名 -> Account / Basic information
- IAM -> User management -> 当前用户或主账号详情
- TikTok Developer Portal 的 BytePlus/VOD 绑定页面

填入：

```env
BYTEPLUS_ACCOUNT_ID=控制台显示的账号 ID
```

### 4.2 VOD SpaceName

打开你给的 VOD 控制台链接后：

1. 确认区域是 `ap-southeast-1`。
2. 进入 VOD 的 `Spaces`、`空间` 或概览页。
3. 找到要给短剧项目使用的 Space。
4. 复制 Space 的名称，不是显示别名时要优先确认 API 使用的 `SpaceName`。

填入：

```env
BYTEPLUS_SPACE_NAME=你的空间名
BYTEPLUS_REGION=ap-southeast-1
```

如果控制台 UI 变化，也可以调用 BytePlus VOD `ListSpace` API 查询当前账号下的空间列表。

## 5. BytePlus VOD 上传方案怎么选

这个项目后台的 `UploadJob` 接口接收的是：

```json
{
  "episodeId": "本地 Episode.id",
  "sourceUrl": "https://example.com/video.mp4",
  "sourceExpiresAt": "2026-09-12T12:00:00.000Z"
}
```

因此当前最贴合项目的首选方案是 `UploadMediaByUrl`：后端把一个公网可访问的视频直链交给 BytePlus，由 BytePlus 异步拉取并上传到 VOD。

### 5.1 URL 拉取上传：推荐给当前项目首期

适用场景：

- 运营后台已经有视频文件的公网临时 URL。
- 视频在 S3/TOS/CDN/对象存储里，可以给 BytePlus 拉取。
- 不想让 API 服务器承担大文件上传流量。

BytePlus 官方要求：

- `SourceUrl` 必须是视频文件直链，例如 `https://example.com/video.mp4`。
- 不能是网页播放页，例如 `https://example.com/watch?v=123`。
- 提交后是异步任务，需要轮询 `QueryUploadTaskInfo` 或配置回调。

本项目对应关系：

| 项目字段 | BytePlus 字段 |
| --- | --- |
| `UploadJob.sourceUrl` | `URLSets[].SourceUrl` |
| `Episode.title` | `URLSets[].Title` |
| `BYTEPLUS_SPACE_NAME` | `SpaceName` |
| `UploadJob.providerJobId` | `JobId` |
| `Episode.byteplusVid` | `Vid` |
| `Episode.durationMs` | `SourceInfo.Duration * 1000` |

Worker 逻辑已经在 `apps/api/src/jobs/tiktok-short-drama.worker.ts` 写好：

1. `PENDING` 任务调用 `createVideoUpload`。
2. 保存返回的 `providerJobId`。
3. 后续轮询 `getVideoUploadStatus`。
4. 成功后保存 `byteplusVid`、封面、时长，Episode 变为 `READY`。

### 5.2 Server SDK 上传：适合服务器本地文件

如果视频文件先落在 API 服务器本地或内网存储，可以接 BytePlus VOD Server SDK。官方 Server SDK 支持 Node.js，并封装了申请上传地址、上传分片、提交上传等流程。

这种方案需要 API 服务读取大文件，带宽、超时、断点续传、重试都要仔细处理。除非你的视频文件已经在后端机器上，否则当前项目不优先推荐。

### 5.3 控制台手工上传：适合试用

可以先在 VOD 控制台手工上传视频，确认空间、转码、封面、播放状态正常。手工拿到 `Vid` 后，可以临时写入数据库的 `Episode.byteplusVid` 做播放器验证，但这不是最终运营流程。

## 6. 后端环境变量配置

复制示例文件：

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

编辑 `apps/api/.env`：

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/quickreels
JWT_SECRET=至少 32 位随机字符串
TIKTOK_CLIENT_KEY=TikTok 开发者平台 Client Key
TIKTOK_CLIENT_SECRET=TikTok 开发者平台 Client Secret
TIKTOK_REDIRECT_URI=你的 OAuth 回调地址

BYTEPLUS_ACCOUNT_ID=你的 BytePlus Account ID
BYTEPLUS_SPACE_NAME=你的 VOD SpaceName
BYTEPLUS_REGION=ap-southeast-1

UPLOAD_WORKER_INTERVAL_MS=30000
UPLOAD_MAX_RETRIES=5
```

若实现 BytePlus 直连 API，再补：

```env
BYTEPLUS_ACCESS_KEY=你的 Access Key ID
BYTEPLUS_SECRET_KEY=你的 Secret Access Key
```

本地启动：

```powershell
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev:api
pnpm dev:worker
```

## 7. 后端 BytePlus 接入点

真实 BytePlus VOD 适配器在：

```text
apps/api/src/services/byteplus-vod.service.ts
```

它目前实现了：

```text
UploadMediaByUrl
QueryUploadTaskInfo
BytePlus OpenAPI HMAC-SHA256 签名
```

服务内部流程：

1. 调用 `UploadMediaByUrl`，传 `SpaceName` 和 `URLSets`。
2. 从响应拿 `JobId`，返回给 `providerJobId`。
3. 调用 `QueryUploadTaskInfo` 查询 `JobId`。
4. `State=initial/processing` 映射为 `PROCESSING`。
5. `State=success` 映射为 `SUCCEEDED`，提取 `Vid`、`SourceInfo.Duration`。
6. `State=failed` 映射为 `FAILED`。

尚未实现的是 `getPlayAuthToken`。目前它仍会抛出未配置错误，因为 TikTok Mini Drama 的播放授权要以当前 TikTok/BytePlus 绑定后的官方播放器文档为准。

## 7.1 现在如何跑通一次上传

1. 在 `apps/api/.env` 填入真实值：

```env
BYTEPLUS_ACCOUNT_ID=你的 BytePlus Account ID
BYTEPLUS_SPACE_NAME=你的 VOD SpaceName
BYTEPLUS_REGION=ap-southeast-1
BYTEPLUS_ACCESS_KEY=你的 Access Key ID
BYTEPLUS_SECRET_KEY=你的 Secret Access Key
BYTEPLUS_VOD_ENDPOINT=https://vod.byteplusapi.com
```

2. 启动 API 和 Worker：

```powershell
pnpm dev:api
pnpm dev:worker
```

3. 在运营后台或通过 API 创建上传任务：

```http
POST /api/v1/admin/upload-jobs
Authorization: Bearer <admin token>
Content-Type: application/json

{
  "episodeId": "本地 Episode.id",
  "sourceUrl": "https://你的公网视频直链/episode-1.mp4",
  "sourceExpiresAt": "2026-09-12T12:00:00.000Z"
}
```

4. Worker 会自动：

- 创建 BytePlus URL 上传任务
- 保存 `UploadJob.providerJobId`
- 轮询上传任务状态
- 成功后保存 `Episode.byteplusVid` 和 `Episode.durationMs`
- 把 `Episode.status` 更新为 `READY`

## 8. 播放链路

前端文件：

```text
apps/mini-web/src/features/player/create-player.ts
```

当前使用：

```ts
const VePlayer = await window.TTMinis.getPlayer('byteplus');
```

后端剧集播放接口会返回：

```json
{
  "vid": "BytePlus Vid",
  "albumId": "TikTok Album ID",
  "episodeId": "TikTok Episode ID",
  "playAuthToken": "可选播放凭证"
}
```

重要边界：

- 前端不要直接使用 BytePlus 原始播放 URL。
- 前端不要保存 BytePlus AK/SK。
- `byteplusVid` 不等于已上线可播放。还需要 TikTok 短剧专辑、剧集、审核、online/listed 状态同步完成。
- 免费集数和广告解锁由后端业务规则控制，不由 VOD 直接决定。

## 9. 上线前检查清单

- BytePlus VOD 已开通。
- 区域确认是 `ap-southeast-1`。
- 已创建项目专用 VOD Space。
- TikTok Developer Portal 中已按平台要求绑定 BytePlus 账号/空间。
- IAM 用户拥有 VOD 上传、查询上传任务、查询媒资、播放信息相关权限。
- 后端环境变量已配置在部署平台 Secret 中。
- `apps/mini-web` 没有任何 BytePlus/TikTok secret。
- `pnpm dev:worker` 能正常启动。
- 创建 `UploadJob` 后，任务能从 `PENDING` 到 `PROCESSING`。
- 上传成功后 `Episode.byteplusVid` 写入数据库。
- TikTok 审核/上架状态同步完成后，Episode/Album 才进入用户可见状态。

## 10. 常见错误排查

### Invalid access key

检查：

- `BYTEPLUS_ACCESS_KEY` 是否填错。
- `BYTEPLUS_SECRET_KEY` 是否填错。
- 密钥是否被禁用或删除。
- 使用的是 Access Key，不是 API Key。

### Access key mismatch / AKMissMatch

检查：

- 密钥所属账号是否就是 VOD Space 所属账号。
- IAM 用户是否有该 Space 权限。
- `BYTEPLUS_ACCOUNT_ID` 是否填成了其他账号。

### Invalid space / Space not exists

检查：

- `BYTEPLUS_SPACE_NAME` 是否是 API 使用的真实 SpaceName。
- 区域是否对应。你当前链接是 `ap-southeast-1`。
- 是否在另一个区域创建了同名或不同名空间。

### URL upload 一直 processing

检查：

- `sourceUrl` 是否公网可访问。
- URL 是否直接指向视频文件。
- URL 是否过期，尤其本项目有 `sourceExpiresAt`。
- 视频文件大小和格式是否在 VOD 支持范围内。

### 前端不能播放

检查：

- `Episode.byteplusVid` 是否存在。
- `album.tiktokAlbumId` 和 `episode.tiktokEpisodeId` 是否存在。
- TikTok Mini Preview 是否支持 `TTMinis.getPlayer('byteplus')`。
- 是否已拿到必要的 `playAuthToken`。
- 剧集是否已经通过 TikTok 审核并处于可播放状态。

## 11. 官方文档入口

- BytePlus Console：<https://console.byteplus.com/>
- VOD Console：<https://console.byteplus.com/vodpaas/>
- IAM API Access Key：<https://console.byteplus.com/iam/keymanage/>
- BytePlus IAM Access Key 文档：<https://docs.byteplus.com/en/docs/IAM/about-access-keys>
- 创建 Access Key：<https://docs.byteplus.com/en/docs/IAM/creating-an-access-key>
- 管理 Access Key：<https://docs.byteplus.com/en/docs/IAM/managing-an-access-key>
- VOD 上传概览：<https://docs.byteplus.com/en/docs/byteplus-vod/docs-media-upload-overview>
- VOD Server SDK 概览：<https://docs.byteplus.com/en/docs/byteplus-vod/docs-server-sdk-overview>
- UploadMediaByUrl：<https://docs.byteplus.com/en/docs/byteplus-vod/reference-uploadmediabyurl>
- QueryUploadTaskInfo：<https://docs.byteplus.com/en/docs/byteplus-vod/reference-queryuploadtaskinfo>
- ApplyUploadInfo：<https://docs.byteplus.com/en/docs/byteplus-vod/reference-applyuploadinfo>
- CommitUploadInfo：<https://docs.byteplus.com/en/docs/byteplus-vod/reference-commituploadinfo>

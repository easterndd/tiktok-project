# QuickReels v0.0.6 接口总览

> 核对日期：2026-11-10。依据当前仓库源码整理，描述的是**已实现的接口**，不是线上服务版本证明。`docs/api-openapi.yaml` 是较早的 0.1.0 草案，不能代替本清单。本文中的“官方”只指 TikTok Minis、TikTok Short Drama OpenAPI、BytePlus VOD；`/api/...` 路由均为本项目自定义接口。

## 1. 阅读方式和通用约定

| 项目 | 说明 |
| --- | --- |
| API 前缀 | 主应用为 `/api/v1`；其他已配置小程序为 `/api/{appKey}/v1`。下表只写前缀之后的相对路径；**不要**将 `appKey` 当作请求体参数。`/live`、`/ready`、`/health` 是根路径。封面资源仅在 `/api/v1/assets/covers/:fileName` 注册。 |
| 业务数据库 | 每个小程序上下文使用自己的数据库；共享 IP、媒资和剧目授权等使用共享数据库。相同路径在不同前缀下针对不同小程序数据。 |
| 鉴权标记 | `公开`：无用户令牌要求；`可选用户`：允许匿名，有有效用户令牌时补充个性化数据；`用户`：本小程序的 Bearer 用户 JWT；`管理`：本小程序的 Bearer 管理员 JWT；`权限(x)`：管理员 JWT 加指定权限。跨小程序操作还需目标包的管理员令牌。 |
| 管理员角色 | `OWNER` 拥有全部权限；`EDITOR` 有内容读写/同步、广告读写、分析及设置读写；`ANALYST` 有内容/广告/分析/审计/设置读取；`SUPPORT` 有内容/广告/分析读取。部分发布、审核、账号管理操作需要 `OWNER`。 |
| 请求格式 | 常规写接口用 JSON；`/admin/cover-assets`、`/admin/upload-jobs/local` 用 `multipart/form-data`。时间戳一般为 ISO 8601；`locale` 使用项目支持的语言枚举。 |
| 错误格式 | 通常为 `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`。常见 HTTP 状态：400 参数不合法、401 会话无效、403 无权限或剧集未解锁、404 不存在/不可见、409 状态冲突、410 功能停用、429 限流、503 依赖不可用。部分明确的 204、202、304 在下文标出。 |
| 前端请求封装 | [小程序 `api-client.ts`](../apps/mini-web/src/lib/api-client.ts) 用 `VITE_API_BASE_URL` 选择前缀，自动带用户令牌，20 秒超时，401 尝试恢复会话一次；[后台 `admin-api.ts`](../apps/admin-web/src/admin-api.ts) 带管理员令牌，可附 `X-Multi-App-Tokens`，GET 遇到带 `Retry-After` 的 429 最多重试一次。 |
| 参数位置 | `:id` 表示 URL 路径参数；`?x` 表示查询参数；其他关键字段在 JSON body。下表只列业务关键字段；长度、枚举、默认值以源码的 Zod schema 为准。 |

典型调用链：小程序 `TTMinis.login()` → `POST /auth/tiktok/session` → 本服务调用 TikTok OAuth；打开剧集 `GET /episodes/:episodeId/play` → 本服务可向 BytePlus 获取播放令牌 → 小程序创建官方 VePlayer；广告由小程序调用官方广告 SDK 展示，再通过本服务的会话与事件路由记录展示、关闭和解锁。后台的内容同步接口通常**入队任务**，由 worker 调用 TikTok/BytePlus OpenAPI，不意味着本次 HTTP 返回时平台已完成审核或发布。

## 2. 小程序前端实际使用的 TikTok 官方 SDK

入口类型与能力声明见 [`ttminis.d.ts`](../apps/mini-web/src/types/ttminis.d.ts)，调用代码分布在 [`features/auth`](../apps/mini-web/src/features/auth)、[`features/ads`](../apps/mini-web/src/features/ads)、[`features/player`](../apps/mini-web/src/features/player)。这些是**设备内 JavaScript API**，不是可用 `curl` 请求的本项目 HTTP 接口。

| 官方方法/事件 | 本项目用途与关键参数 | 结果、注意事项 |
| --- | --- | --- |
| `TTMinis.init({clientKey})` | 启动时初始化 Minis SDK。 | `clientKey` 来自前端构建配置；同一页面避免重复初始化。 |
| `TTMinis.login({success,fail,complete})` | 获取一次性授权 `code`，再交给本服务 `/auth/tiktok/session`。 | 前端同时兼容 Promise 和回调形式；`code` 不直接当本项目 JWT。 |
| `TTMinis.canIUse(apiName)` | 检查广告、生命周期等宿主能力。 | 不支持时前端走不可用处理；能力检查不能保证后续广告一定有填充。 |
| `TTMinis.getSystemInfoSync()` | 识别 iOS/Android、宿主和设备信息，用于广告分支、诊断。 | 代码兼容某些环境提供的 `TTMinis.game.getSystemInfoSync()` 回退；后者不是本文要推广的 Mini Drama 接入规范。 |
| `TTMinis.getLaunchOptionsSync()` / `getEnterOptionsSync()` | 读取启动/再次进入时的 query、scene、来源，供投放归因及入口会话。 | 能力可选，代码做兼容检查。 |
| `TTMinis.on('minis.show', cb)` / `onShow(cb)` | 监听回到前台，恢复广告与登录相关流程。 | 以当前宿主支持的事件形式注册。 |
| `TTMinis.createRewardedVideoAd({adUnitId})` | 创建激励视频对象，剧集解锁、入口激励、退出挽留使用。 | `adUnitId` 是 Portal 广告位 ID，创建不等于展示或完播。 |
| 激励对象 `show()`、`onClose(cb)`、`offClose(cb)`、`onError(cb)`、`offError(cb)` | 展示广告；`onClose` 的 `isEnded` 决定是否满足完播计数；解绑避免旧回调污染新轮次。 | `show()` Promise 失败、`onError`、关闭未完播分别处理；只有符合会话及展示证据的事件才推进服务端计数。 |
| `TTMinis.createInterstitialAd({adUnitId})` | 创建插屏对象，用于入口和剧集切换插屏。 | 不产生激励解锁权益。 |
| 插屏对象 `show()`、`onClose/offClose`、`onError/offError` | 展示、关闭和失败清理。 | 插屏关闭没有激励视频的 `isEnded`。 |
| 可选对象 `load()`、`onLoad/offLoad`、`destroy()` | 本项目封装尝试预加载、等待就绪、释放失效对象。 | **兼容性能力**：当前 TikTok 广告 SDK 参考页明确列出 `show/close/error`，没有把 `load()` 作为通用必备方法；代码先检查 `typeof ad.load`，无此能力时退回直接 `show()`，不可把预加载成功率当官方承诺。 |
| `TTMinis.getPlayer('byteplus')` | 获取官方 VePlayer 构造器。 | 构造器 Promise 复用，失败后允许重新获取。 |
| `new VePlayer({root,albumId,episodeId,vid,getVideoByToken,lang,...})` | 用 `/episodes/:episodeId/play` 返回的平台 ID、VID 和可选播放令牌创建播放器。 | 绑定实际 DOM 根节点；`playAuthToken` 只用于播放，不应写入公开日志。 |
| VePlayer `on/off`、`playNext()`、`destroy()` | 监听 READY、首帧、播放、暂停、错误、结束等；切集复用播放器；卸载时销毁。 | 本项目还使用 `prepare/setPreloadScene/setPreloadList/prefetchMediaInfo` 等预加载能力；需以宿主版本兼容性为准。 |

官方参考：[TikTok Minis 广告 SDK](https://developers.tiktok.com/docs/en/minis-sdk-in-app-ads)、[Minis 登录](https://developers.tiktok.com/docs/en/tiktok-minis-silent-login)、[VePlayer](https://developers.tiktok.com/docs/en/minis-player)。

### v0.0.6 广告位决策边界

对于匹配 `{appKey}-v006-dual-*` 的 release，服务端校验 App ID 和主广告位后返回允许的广告位清单及 `ANDROID_DUAL_CLIENT` / `IOS_SINGLE_CLIENT` 标记；前端按操作系统执行 Android 双位、iOS 单位。此分支**不读取**后台 `AdPlacementPair.enabled`。旧的 v0.0.6 非 `dual` release 仍可使用后台配对配置。`AppEntryAdPolicy.enabled` 控制入口强弹；退出挽留和剧集插屏另有各自配置，不由入口 `enabled` 一项统管。代码见 [`ad-placement-policy.ts`](../apps/api/src/modules/ads/ad-placement-policy.ts)、[`app-entry-ads/routes.ts`](../apps/api/src/modules/app-entry-ads/routes.ts)。

## 3. 后端实际调用的官方 HTTP/SDK 接口

这些请求由 API 或 worker **服务端发起**。TikTok client secret、BytePlus 密钥不得放到小程序前端。表中的路径是上游平台路径，和第 4、5 节的项目路由不同。

### 3.1 TikTok OAuth 与短剧 OpenAPI

实现：[`auth/routes.ts`](../apps/api/src/modules/auth/routes.ts)、[`tiktok-short-drama-api.service.ts`](../apps/api/src/services/tiktok-short-drama-api.service.ts)、平台同步 worker。服务端在短剧接口中以 client credentials 获取/缓存 Bearer token，并处理平台错误码与 request ID。

| 方法与官方路径 | 谁触发 | 作用、关键参数/结果 |
| --- | --- | --- |
| `POST /v2/oauth/token/` | `/auth/tiktok/session` | 用 `grant_type=authorization_code`、小程序 `code`、client key/secret 换取用户 `open_id` 与 TikTok OAuth token；本服务再签发自己的用户 JWT。 |
| `POST /v2/oauth/token/` | 服务端平台客户端 | 用 `grant_type=client_credentials` 换取短剧 OpenAPI Bearer token，供下列资源与剧目请求。 |
| `POST /v2/sg/shortdrama/image` | 封面同步任务 | 根据 `image_url` 创建 TikTok 图片资源，返回 `open_pic_id`。 |
| `POST /v2/sg/shortdrama/video` | 视频同步任务 | 登记 BytePlus `vid`、空间、账号、区域和标题；可能立即成功或返回异步 `job_id`。 |
| `GET /v2/sg/shortdrama/video` | 视频同步任务轮询 | 用 `job_id` 或 `vid` 查询视频登记状态，核对最终 TikTok 视频资料。 |
| `POST /v2/sg/shortdrama/album/create/` | 剧目版本同步 | 创建 TikTok 剧目，获得 `album_id`。 |
| `POST /v2/sg/shortdrama/album/update/` | 剧目版本同步 | 上传剧目资料与 `episode_info_list`，返回版本和分集 ID 映射。 |
| `GET /v2/sg/shortdrama/album/query/` | 对账、审核/发布前检查 | 按 `album_id`、可选 `version` 查询版本、审核和上线状态。 |
| `POST /v2/sg/shortdrama/album/review/submit/` | 审核任务 | 提交指定版本审核，`priority_score` 为 1 或 2。 |
| `POST /v2/sg/shortdrama/album/online_version/` | 上线版本任务 | 将指定已就绪版本设为线上版本。 |
| `POST /v2/sg/shortdrama/album/status/` | 上线/下线任务 | 以 `status` 切换剧目发布状态。 |
| `POST /v2/sg/shortdrama/album/authorize/` | 共享播放授权任务 | 向目标 client key 授权或撤销剧目；逐目标解析平台结果。 |
| `POST /v2/minis/link/generate/` | 后台投放链接生成 | 以 `minis_path` 生成 TikTok Minis 链接；服务端校验返回域名和 `/minis/` 路径。 |

官方参考：[TikTok 短剧媒资 API](https://developers.tiktok.com/docs/en/media-asset-api-reference)、[Minis 登录](https://developers.tiktok.com/docs/en/tiktok-minis-silent-login)。官方文档还包含本项目未调用的接口，不能据此推断已接入。

### 3.2 BytePlus VOD

实现：[`byteplus-vod.service.ts`](../apps/api/src/services/byteplus-vod.service.ts)、本地上传服务。SDK Action 名是 BytePlus 官方接口名；URL 上传的原始请求使用签名。

| 官方 Action / 操作 | 谁触发 | 作用、关键参数/结果 |
| --- | --- | --- |
| `UploadMediaByUrl` | 后台 `/admin/upload-jobs` 的 URL 上传任务 | 让 BytePlus 抓取 `sourceUrl` 并生成异步任务；使用空间和标签标识归属。 |
| `QueryUploadTaskInfo` | URL 上传任务轮询 | 查询抓取/转码任务，获得进度及最终 VID。 |
| `ApplyUploadInfo` | 本地文件上传任务 | 申请上传节点、地址和授权；随后向分配的上传主机发送文件数据。 |
| 上传主机 `PUT` | 本地文件上传任务 | 按 `ApplyUploadInfo` 返回的地址上传视频字节；小文件直传，大文件依次初始化分片、上传分片、合并分片，均向分配的主机发 `PUT`；**不是**固定的项目 API URL。 |
| `CommitUploadInfo` | 本地文件上传任务 | 确认已上传数据，提交媒体记录并取得 VID；失败时需对账，避免重复提交。 |
| `GetMediaInfos` | 管理员手动绑定、上传对账 | 用 VID 核验媒体存在性、空间、封面、时长和标签。 |
| `GetMediaList` | 后台媒资浏览 | 按空间、分页、状态和标签列出 BytePlus 视频。 |
| `UpdateMediaPublishStatus` | 媒资发布处理 | 将指定 VID 的媒体状态设为 `Published`，为后续播放准备媒资。 |
| `GetPlayInfo` | 媒资可播放性检查 | 查询 VID 的播放信息，确认是否已有非空 `MainPlayUrl`；用于上传/发布流程的就绪校验。 |
| `GetPlayAuthToken` | `/episodes/:episodeId/play` | 生成指定 VID 的短期播放授权 token；生成失败时该接口可能返回 `playAuthToken: null`。 |

官方参考：[BytePlus VOD API 列表](https://docs.byteplus.com/en/docs/byteplus-vod/reference-api-list)、[URL 上传](https://docs.byteplus.com/en/docs/byteplus-vod/reference-uploadmediabyurl)、[上传任务查询](https://docs.byteplus.com/en/docs/byteplus-vod/reference-queryuploadtaskinfo)、[申请上传信息](https://docs.byteplus.com/en/docs/byteplus-vod/reference-applyuploadinfo)、[提交上传](https://docs.byteplus.com/en/docs/byteplus-vod/reference-commituploadinfo)、[发布媒体状态](https://docs.byteplus.com/en/docs/byteplus-vod/reference-updatemediapublishstatus)、[查询播放地址](https://docs.byteplus.com/en/docs/byteplus-vod/reference-getplayinfo)。

## 4. 项目自定义接口：小程序与公共服务

以下所有路径都加第 1 节所述小程序 API 前缀，除注明的根路径/封面固定路径。`GET` 的 `locale` 是可选语言查询参数；内容接口按上线状态、地区和共享授权筛选。`/runtime-errors` 和 `/analytics/events` 属诊断/统计，不作为广告权益凭据。

### 4.1 探针和静态资源

| 方法与路径 | 鉴权 | 用途、主要参数与返回 |
| --- | --- | --- |
| `GET /live` | 公开 | 进程存活与入口限流/响应计数快照，返回 `status/admission/responseMetrics/timestamp`；不探测数据库。 |
| `GET /ready` | 公开 | 数据库 `SELECT 1` 就绪探针；成功 200，数据库不可用返回 503。 |
| `GET /health` | 公开 | 与 `/ready` 同一就绪检查逻辑，供旧探针兼容。 |
| `GET /api/v1/assets/covers/:fileName` | 公开 | 返回上传封面文件流；包含 ETag、长期缓存，条件命中返回 304，文件不存在返回 404。此路径本身已含 `/api/v1`。 |

### 4.2 登录与启动归因

| 方法与路径 | 鉴权 | 用途、主要参数与返回 |
| --- | --- | --- |
| `POST /auth/anonymous/session` | 公开 | `visitorKey/clientSessionId/platform/clientVersion/source/launchContext?` 建立匿名观众与应用会话，返回 `{accessToken,expiresIn,viewer}`；匿名令牌仍绑定本小程序。 |
| `POST /auth/launch-context` | 用户 | 上报 `entryId`、启动 query/scene 等归因信息；支持本地入口广告资格判断，返回 `{saved,entryAdEligibility?}`。 |
| `POST /auth/tiktok/session` | 用户 | 传 `code`（以及客户端会话字段），服务端向 TikTok OAuth 换取 open ID、合并或绑定匿名观众，再返回本项目用户 JWT 和观众信息。 |

### 4.3 首页、发现、剧目、播放

| 方法与路径 | 鉴权 | 用途、主要参数与返回 |
| --- | --- | --- |
| `GET /home` | 可选用户 | `locale?` 获取首页区块和内容流；有效用户令牌会额外加入继续观看区块，匿名请求可用公共首页缓存。 |
| `GET /home/progress` | 用户 | `locale?` 获取“继续观看”区块；只返回当前用户有权看到的内容。 |
| `GET /albums` | 公开 | `locale?` 返回最近更新的上线剧目 `items`（最多 20）及 `nextCursor:null`。 |
| `GET /albums/:albumId` | 可选用户 | `locale?` 获取剧目详情、计数与当前用户点赞/收藏状态。 |
| `GET /albums/:albumId/episodes` | 可选用户 | `locale?` 获取上线分集及 `PLAYABLE/REWARDED_AD_REQUIRED` 状态。 |
| `GET /genres` | 公开 | `locale?` 返回类型名、slug 和对应剧目数。 |
| `GET /genres/:slug/albums` | 公开 | `locale?`、`limit?`（最多 50）按类型列出上线剧目。 |
| `GET /search` | 可选用户 | `q?`、`locale?`、`limit?` 搜索标题、简介、分类和翻译；返回 `items/fallbackItems/query/nextCursor`，有关键词时记录搜索事件。 |
| `GET /campaign-entry/resolve` | 公开 | `album_id/episode_id` 校验投放深链是否指向已上线、免费、授权的分集；返回 `PLAYABLE` 和本地 ID 或 `INVALID`。 |
| `GET /episodes/:episodeId/play` | 可选用户 | `locale?` 校验免费/已解锁及地区权限，返回 `playbackMode`、平台 `albumId/episodeId`、`vid`、可选 `playAuthToken`、封面、时长、`resumePositionMs`；未登录的锁集返回 401，已登录未解锁返回 403 `EPISODE_LOCKED`。 |

### 4.4 剧集解锁、入口强弹、退出挽留与插屏

| 方法与路径 | 鉴权 | 用途、主要参数与返回 |
| --- | --- | --- |
| `POST /episodes/:episodeId/reward-session` | 用户 | `purpose?/releaseId?/platform?` 创建或恢复激励解锁/挽留会话，返回广告位清单、所需次数、已完成次数或 `PLAYABLE`；按剧目访问配置决定是否启用。 |
| `POST /episodes/:episodeId/reward-session/:sessionId/complete` | 用户 | `clientEventId/isEnded:true` 在广告 `SHOWN` 证据确认后推进次数；返回 `shouldContinue/completedCount/requiredCount` 或 `PLAYABLE`。同一事件幂等；证据不符返回 409。 |
| `POST /episodes/:episodeId/reward-unlock` | 用户 | 旧版兼容完成接口，需 `placementId/clientEventId/isEnded:true`，可带 `sessionId`；内部仍走激励会话与证据校验。新前端优先用上面两个接口。 |
| `GET /exit-retention/config` | 用户 | `releaseId/platform` 读取退出挽留是否启用、广告位、加载模式、策略标记和所需展示数；独立于入口强弹开关。 |
| `GET /episode-interstitial/config` | 用户 | `releaseId/platform` 读取剧集插屏位、初始延迟、间隔、冷却、切集规则、每会话上限；独立于入口强弹开关。 |
| `POST /app-entry-ad-sessions` | 用户 | `launchId/releaseId/adId?/platform?` 根据版本策略、归因及用户/IP 豁免决定是否入口强弹；返回 `required:false` 或会话、广告位、模式、次数、不可用处理策略。`releaseId+launchId` 用于恢复同一会话。 |
| `POST /app-entry-ad-sessions/:sessionId/shown` | 用户 | `clientEventId/adIndex/placementId?` 在 `countMode=SHOWN` 时确认第 N 次展示并返回是否继续；v0.0.6 需匹配已记录的 `SHOWN` 事件与广告位。 |
| `POST /app-entry-ad-sessions/:sessionId/complete` | 用户 | `clientEventId/isEnded` 在 `countMode=COMPLETED` 时确认激励完播或插屏关闭；核验关联 `SHOWN`，返回 `APP_PLAYABLE/ENTRY_AD_REQUIRED`、计数与重试标记。 |
| `POST /ad-events` | 条件用户 | `clientEventId/adType/scope/eventType/placementId/adIndex` 及会话 ID，记录广告 `SHOWN` 作为后续计数证据。`REQUESTED` 直接确认；`FAILED` 默认不持久化；`CLOSED_INCOMPLETE` 为诊断；真正的 `SHOWN` 必须持有本小程序用户令牌并匹配会话。返回 `{accepted:true}` 等。 |
| `POST /analytics/events` | 用户；仅五个指定包 | 批量 `events`（1–25 条）：`app_open/ad_config/ad_load/ad_show/ad_close`；可带 `platform/releaseId/placementRole/operationId/adPhase/errorOrigin/errorCode` 等。返回 202 `{accepted,received}`，按 `eventId` 去重。只在 DramaFlicks、HeartReel、ZenClip、SweetReel、LuxeReel 注册。 |

### 4.5 用户、互动、播放质量、配置与故障上报

| 方法与路径 | 鉴权 | 用途、主要参数与返回 |
| --- | --- | --- |
| `GET /me` | 用户 | 获取当前观众公开资料、语言和创建时间。 |
| `GET /me/preferences` | 用户 | 读取/初始化 `locale/autoplay/reducedData` 偏好。 |
| `PUT /me/preferences` | 用户 | 更新 `locale?/autoplay?/reducedData?`，返回新偏好。 |
| `GET /me/history` | 用户 | `locale?` 返回最近 30 条观看历史与续播位置。 |
| `GET /me/favorites` | 用户 | `locale?` 返回最近 30 个可见收藏剧目，`nextCursor:null`。 |
| `GET /me/watch-progress` | 用户 | 返回最多 30 条当前用户的可见分集进度。 |
| `PUT /me/watch-progress` | 用户 | `episodeId/positionMs/durationMs?/completed` 保存续播进度；位置不能超过时长，成功 204。 |
| `PUT /albums/:albumId/like` | 用户 | `{active:boolean}` 添加/取消点赞，返回当前互动状态及计数。 |
| `PUT /albums/:albumId/favorite` | 用户 | `{active:boolean}` 添加/取消收藏，返回当前互动状态及计数。 |
| `POST /albums/:albumId/share` | 可选用户 | `channel?` 记录分享，返回 `deepLink/title/coverUrl/shareCount`。 |
| `POST /playback-quality-events` | 用户 | `episodeId/sessionId/eventType` 上报播放器构建、READY、首帧、错误、结束、启动耗时等；`WAITING` 和 `DEFINITION_CHANGE` 高频事件会确认但丢弃，`ENDED` 更新播放会话及完播事件。 |
| `GET /ui-components` | 公开 | 返回发布版页面组件开关与 `version`；ETag 命中 304，未发布时回退基础配置。 |
| `POST /runtime-errors` | 公开 | `kind/releaseId/phase/message/path?/statusCode?` 上报启动、API、脚本、广告、播放异常；返回 202，服务端脱敏并 30 秒同签名去重，广告诊断默认丢弃。 |

## 5. 项目自定义接口：管理后台

以下路径同样加小程序 API 前缀。`管理` 指 `requireAdmin`：它并非“任意管理员都能调用”，实际权限由路径和 HTTP 方法映射；带 `权限(x)` 的路由还额外检查显式权限。`/admin/auth/login` 除外。所有写操作可能产生审计日志，具体事务和状态约束见源码 [`admin/routes.ts`](../apps/api/src/modules/admin/routes.ts)。

### 5.1 登录、账号、用户、共享 IP

| 方法与路径 | 鉴权 | 用途、主要参数与返回 |
| --- | --- | --- |
| `POST /admin/auth/login` | 公开 | `email/password` 登录当前小程序后台，返回 `accessToken/expiresIn/admin`；每 15 分钟最多 10 次。 |
| `GET /admin/me` | 管理 | 读取当前管理员资料和角色。 |
| `PUT /admin/me/password` | 管理 | `currentPassword/newPassword` 修改本人密码并递增 token 版本，旧令牌失效；所有有效管理员角色可用。 |
| `GET /admin/admin-users` | 管理，实际需 `admin.manage` | 列出本小程序管理员、角色、状态与最近登录。 |
| `POST /admin/admin-users` | 管理，实际需 `admin.manage` | `email/password/role/status` 创建管理员，密码至少 12 字符。 |
| `PATCH /admin/admin-users/:adminUserId` | 管理，实际需 `admin.manage` | 修改邮箱、密码、角色或状态；不能禁用自己，变更敏感信息使旧 token 失效。 |
| `GET /admin/audit-logs` | 管理，实际需 `audit.read` | `cursor?/limit?` 分页查审计日志，返回 `items/nextCursor`。 |
| `GET /admin/viewers` | 权限(`admin.manage`) | `search?/ipAddress?/limit?` 查当前包观众、最近会话、IP 与启动归因。 |
| `PATCH /admin/viewers/:userId/app-entry-ad` | 权限(`admin.manage`) | `{appEntryAdExempt}` 设置单个观众的入口广告豁免。 |
| `PATCH /admin/viewers/app-entry-ad/batch` | 权限(`admin.manage`) | `userIds/appEntryAdExempt` 批量修改当前包观众豁免，返回更新数。 |
| `GET /admin/shared/viewers` | 权限(`admin.manage`) | `miniAppKey/search?/ipAddress?/limit?` 查同组织目标包观众；需目标包管理员令牌。 |
| `GET /admin/shared/viewers/:userId/launches` | 权限(`admin.manage`) | `miniAppKey/limit?/offset?` 查目标观众的启动归因历史；需目标包令牌。 |
| `PATCH /admin/shared/viewers/app-entry-ad/batch` | 权限(`admin.manage`) | `miniAppKey/userIds/appEntryAdExempt` 批量修改同组织目标包豁免；需目标包令牌。 |
| `GET /admin/shared/ips` | 权限(`admin.manage`) | `search?/miniAppKey?/limit?` 汇总共享数据库中的 IP 与访问人数。 |
| `GET /admin/shared/ips/:ipAddress/visits` | 权限(`admin.manage`) | `limit?/offset?/miniAppKey?` 查指定 IP 访问记录。 |
| `GET /admin/shared/entry-ad-ip-exemptions` | 权限(`admin.manage`) | 列出入口广告 IP 豁免。 |
| `PUT /admin/shared/entry-ad-ip-exemptions` | 权限(`admin.manage`) | `ipAddress/note?` 新增或更新 IP 豁免。 |
| `POST /admin/shared/entry-ad-ip-exemptions/batch` | 权限(`admin.manage`) | `ipAddresses/exempt/note?` 批量设置或取消 IP 豁免。 |
| `DELETE /admin/shared/entry-ad-ip-exemptions/:ipAddress` | 权限(`admin.manage`) | 删除指定 IP 豁免；成功 204。 |

### 5.2 广告策略、代码版本、投放入口

| 方法与路径 | 鉴权 | 用途、主要参数与返回 |
| --- | --- | --- |
| `GET /admin/app-entry-ad-policy` | 管理，实际需 `ads.read` | `releaseId?` 读取指定版本入口强弹及相关广告策略。 |
| `GET /admin/app-entry-ad-policies` | 管理，实际需 `ads.read` | 列出所有策略、Portal 版本状态和默认广告位。 |
| `PUT /admin/app-entry-ad-policy` | 管理，实际需 `ads.write` | `releaseId/enabled/mode/placementId/requiredCount/countMode/onUnavailable`，以及退出挽留和剧集插屏各自开关、次数、间隔等；更新策略版本并清缓存。`enabled` 只控制入口强弹。 |
| `PATCH /admin/app-entry-ad-releases/:releaseId` | 管理，实际需 `ads.write` | `portalVersion/portalStatus` 登记某代码 release 在 Portal 的版本与 `UNKNOWN/PREVIEW/IN_REVIEW/READY/RELEASED` 状态。 |
| `GET /admin/ad-placement-pairs` | 权限(`ads.read`) | `releaseId?` 查看数据库中的主/备广告位配对。 |
| `PUT /admin/ad-placement-pairs` | 权限(`ads.write`) | `releaseId/adType/primaryPlacementId/backupPlacementId/enabled/iosLoadMode/androidLoadMode/iosExperimentPercent` 保存旧式 v0.0.6 配对；**不适用于** `v006-dual` 新包，后者由前端清单与服务端固定校验决定。 |
| `DELETE /admin/ad-placement-pairs/:id` | 权限(`ads.write`) | 删除旧式数据库配对并清策略缓存；不改变 `v006-dual` 前端配对。 |
| `GET /admin/mini-entry-links` | 权限(`ads.read`) | 读取 PREVIEW/PRODUCTION TikTok Minis 基础入口链接和最近观察到的前端构建 release。 |
| `PUT /admin/mini-entry-links/:environment` | 权限(`ads.write`) | `baseUrl/source` 保存经核验的 `https://www.tiktok.com/minis/...` 入口链接；环境为 `PREVIEW` 或 `PRODUCTION`。 |
| `GET /admin/campaign-entry/base` | 管理 | 读取投放链接的基础 Minis URL 与核验时间。 |
| `PUT /admin/campaign-entry/base` | 权限(`content.write`) | `{url,verified:true}` 保存投放基础 URL；仅启用该功能的包可用。 |
| `GET /admin/campaign-entry/albums` | 管理 | `q?` 列出可投放、已同步 TikTok 且授权有效的上线剧目。 |
| `GET /admin/campaign-entry/episodes` | 管理 | `albumId` 列出可投放的上线免费分集。 |
| `POST /admin/campaign-entry/generate-link` | 权限(`content.write`) | `episodeId` 校验免费、上线及授权后调用 TikTok Minis Link API；返回 `url/minisPath/requestId`。 |

### 5.3 剧目、分集、封面、翻译与内容配置

| 方法与路径 | 鉴权 | 用途、主要参数与返回 |
| --- | --- | --- |
| `GET /admin/albums` | 管理 | 列出当前包剧目及同步/审核状态。 |
| `GET /admin/albums/:albumId` | 管理 | 获取单剧详情及分集。 |
| `POST /admin/albums` | 管理，实际需 `content.write` | `title/description/language/releaseYear/dramaType/tagList/regions/accessConfig`，以及 `coverUrl` 或 `coverAssetId`，创建剧目草稿。 |
| `PATCH /admin/albums/:albumId` | 管理，实际需 `content.write` | 局部修改剧目、封面、访问配置；共享资料文本变更需要主包权限。 |
| `DELETE /admin/albums/:albumId` | 权限(`content.write`) | 删除未同步 TikTok 的草稿或满足限制的共享副本；已同步主剧目不可直接删，成功 204。 |
| `GET /admin/episodes` | 管理 | 列出各分集的本地/BytePlus/TikTok 状态。 |
| `POST /admin/episodes` | 管理，实际需 `content.write` | `albumId/episodeNo/title/...` 新建分集。 |
| `PATCH /admin/episodes/:episodeId` | 管理，实际需 `content.write` | 修改分集标题、封面、时长、免费状态等可编辑字段。 |
| `PATCH /admin/episodes/:episodeId/access` | 管理，实际需 `content.write` | `{isFree}` 单独设置分集免费/付费访问状态。 |
| `POST /admin/dramas` | 权限(`content.write`) | 一次性提交剧目主资料与 `episodes`（1–500 集），适用于后台新建整部短剧。 |
| `POST /admin/albums/:albumId/episodes/batch` | 权限(`content.write`) | `{episodes:[...]}` 向已有剧目批量追加分集，检查集号冲突。 |
| `POST /admin/cover-assets` | 管理，实际需 `content.write` | `multipart` 上传 JPG/PNG/WEBP 封面，验证格式和大小，返回封面资源、公开 URL 及同步状态。 |
| `GET /admin/albums/:albumId/display-metadata` | 管理 | 获取剧目展示资料、翻译和版本，返回 `canEdit`。 |
| `PATCH /admin/albums/:albumId/display-metadata` | 权限(`content.write`) | 提交展示资料及 `expectedVersion`；共享剧目需主包权限并以版本避免并发覆盖。 |
| `POST /admin/albums/:albumId/display-metadata/retry` | 权限(`content.write`) | `{miniAppKey}` 重试共享资料向目标包同步。 |
| `POST /admin/translations` | 管理，实际需 `content.write` | `kind` 为 `album` 或 `episode`，并传 `contentId/locale/title/description?/coverUrl?/subtitleRef?` 新增或更新翻译；`coverOnly` 只更新封面。 |
| `GET /admin/ui-components` | 管理，实际需 `settings.read` | 获取页面组件草稿、发布版版本和组件开关。 |
| `PATCH /admin/ui-components/:key` | 管理，实际需 `settings.write` | 修改单个组件草稿的 `page/enabled/config`。 |
| `PUT /admin/ui-components/draft` | 管理，实际需 `settings.write` | `{items}` 整体保存页面组件草稿。 |
| `POST /admin/ui-components/publish` | 管理，实际需 `settings.write` | 将最新草稿发布，并更新小程序读取的组件行。 |
| `POST /admin/ui-components/rollback` | 管理，实际需 `settings.write` | `{version}` 从旧版本生成新的已发布配置。 |
| `GET /admin/home-blocks` | 管理 | 列出首页 CMS 区块及内容项。 |
| `PATCH /admin/home-blocks/:blockId` | 管理，实际需 `content.write` | 更新区块标题、开关、排序、时间窗与配置。 |
| `POST /admin/home-blocks/:blockId/items` | 管理，实际需 `content.write` | `albumId?/targetEpisodeId?/imageUrl?/previewUrl?/linkPath?/sortOrder` 添加首页区块内容项。 |
| `PATCH /admin/home-blocks/:blockId/items/:itemId` | 管理，实际需 `content.write` | 更新首页内容项图片、跳转路径、排序与时间窗。 |
| `GET /admin/genres` | 管理 | 列出后台分类。 |
| `POST /admin/genres` | 管理，实际需 `content.write` | `slug/name/translations?` 创建分类。 |
| `PATCH /admin/genres/:genreId` | 管理，实际需 `content.write` | 更新分类名称和翻译。 |

### 5.4 BytePlus 上传、媒资绑定与平台同步

| 方法与路径 | 鉴权 | 用途、主要参数与返回 |
| --- | --- | --- |
| `GET /admin/upload-jobs` | 管理 | `albumId?/limit?` 列出 URL/本地上传任务及关联分集。 |
| `GET /admin/upload-jobs/:jobId` | 管理 | 获取单个上传任务状态和关联分集。 |
| `POST /admin/upload-jobs` | 管理，实际需 `content.write` | `episodeId/sourceUrl/sourceExpiresAt?` 创建 BytePlus URL 抓取上传任务。 |
| `POST /admin/upload-jobs/local` | 管理，实际需 `content.write` | `multipart` 文件与 `episodeId`；接收 MP4/MOV/M4V，创建本地文件上传任务，返回 202 `{job,platformSyncJob,episode}`。 |
| `POST /admin/upload-jobs/:jobId/retry` | 管理，实际需 `content.write` | 仅重试符合条件的失败任务；过期 URL 或本地文件丢失时需重新提交。 |
| `POST /admin/upload-jobs/:jobId/reconcile` | 管理，实际需 `content.write` | `{byteplusVid?}`：无 VID 时触发待对账本地任务继续处理；有 VID 时校验空间、标签、原任务归属并绑定分集。 |
| `POST /admin/upload-jobs/:jobId/release` | 管理，实际需 `content.write` | `{confirmation:'NO_BYTEPLUS_MEDIA'}` 释放超过两小时且无 VID 的旧式待对账本地任务。 |
| `GET /admin/byteplus/media` | 管理 | `offset?/pageSize?/status?` 浏览当前空间 BytePlus 媒资（最多每页 100）。 |
| `POST /admin/episodes/:episodeId/bind-byteplus` | 权限(`content.write`) | `byteplusVid/coverAssetId?/byteplusCoverUrl?/durationMs?` 手动校验空间与媒资归属后绑定 VID。 |
| `POST /admin/episodes/:episodeId/reset-byteplus` | 权限(`content.write`) | `{confirmation:'RESET_VIDEO_BINDING'}` 在无平台分集、审核或处理中任务时解除 VID 绑定。 |
| `POST /admin/episodes/:episodeId/bind-shared-media` | 权限(`content.write`) | `{sharedMediaAssetId}` 绑定共享媒资并可排队 TikTok 视频同步。 |
| `GET /admin/platform-sync-jobs` | 权限(`content.read`) | `albumId?/episodeId?/limit?` 查询平台同步任务、状态和错误。 |
| `POST /admin/cover-assets/:coverAssetId/sync` | 权限(`content.sync`) | 排队 TikTok 封面图片同步；返回 `{job,alreadySynced}`。 |
| `POST /admin/episodes/:episodeId/sync-tiktok-video` | 权限(`content.sync`) | 排队 TikTok 视频登记；返回 `{job,alreadySynced}`。 |
| `POST /admin/albums/:albumId/sync-version` | 权限(`content.sync`) | 排队剧目及分集版本同步，返回平台任务。 |
| `POST /admin/albums/:albumId/reconcile` | 权限(`content.sync`) | 排队与 TikTok 平台剧目状态对账。 |
| `POST /admin/albums/:albumId/review-submit` | 权限(`content.review`) | `priorityScore?` 取 1 或 2，排队提交版本审核。 |
| `POST /admin/albums/:albumId/online-version` | 权限(`content.publish`) | 排队设置线上版本。 |
| `POST /admin/albums/:albumId/online` | 权限(`content.publish`) | 排队发布剧目。 |
| `POST /admin/albums/:albumId/offline` | 权限(`content.publish`) | 排队下架剧目。 |

### 5.5 共享媒资与跨小程序授权

| 方法与路径 | 鉴权 | 用途、主要参数与返回 |
| --- | --- | --- |
| `GET /admin/shared/media-assets` | 权限(`content.read`) | `status?/byteplusVid?/sourceSha256?/limit?` 查看共享媒资及来源。 |
| `GET /admin/shared/albums` | 权限(`content.read`) | 列出共享主剧目及分集、授权数量。 |
| `GET /admin/shared/albums/:sharedAlbumId` | 权限(`content.read`) | 查看共享剧目详情、媒资、授权和最近操作。 |
| `GET /admin/shared-playback/:albumId` | 权限(`content.publish`) | `targetApps=a,b` 查询主剧目向同组织目标包授权播放的状态；目标包操作需要对应管理员令牌。 |
| `POST /admin/shared-playback/:albumId` | 权限(`content.publish`) | `targetApps` 为目标包数组，`action` 为 `AUTHORIZE` 或 `RECONCILE`，发起授权或对账；返回逐目标处理结果，实际平台操作可能异步。 |
| `POST /admin/shared/albums/:sharedAlbumId/reconcile` | 权限(`content.sync`) | 主包发起共享授权剧目对账，返回 `operation`。 |
| `POST /admin/albums/:albumId/share` | 权限(`content.publish`)；**已停用** | 固定返回 410 `FEATURE_RETIRED`；不要作为新流程使用。 |
| `GET /admin/multi-app-releases/:albumId` | 权限(`content.publish`)；**已停用** | 固定返回 410 `FEATURE_RETIRED`。 |
| `POST /admin/multi-app-releases/:albumId` | 权限(`content.publish`)；**已停用** | 固定返回 410 `FEATURE_RETIRED`。 |
| `POST /admin/shared/albums/:sharedAlbumId/authorizations` | 权限(`content.publish`)；**已停用** | 固定返回 410 `FEATURE_RETIRED`。 |

### 5.6 统计与诊断台

| 方法与路径 | 鉴权 | 用途、主要参数与返回 |
| --- | --- | --- |
| `GET /admin/analytics/revenue` | 管理，实际需 `analytics.read` | 最近 100 条广告收入记录。 |
| `POST /admin/analytics/revenue/import` | 管理，实际需 `analytics.read` | `source/rows`（最多 10000）按 `reportKey` 导入或覆盖广告收入；当前 `requireAdmin` 按路径映射为 `analytics.read`，写入权限需留意。 |
| `GET /admin/analytics/health` | 管理，实际需 `analytics.read` | `minutes?`（5–1440，默认 30）汇总启动/API/广告/播放/上传/平台同步错误及最近异常。 |
| `GET /admin/analytics/overview` | 管理，实际需 `analytics.read` | 剧目、分集、观众、点赞、收藏、分享、搜索、解锁总览。 |
| `GET /admin/analytics/audience` | 管理，实际需 `analytics.read` | `from?/to?/days?/timezone?` 查询 DAU/WAU/MAU、新增、观看、完播、日趋势；默认时区 `Asia/Shanghai`。 |
| `GET /admin/analytics/audience-countries` | 管理，实际需 `analytics.read` | 同日期参数，按国家汇总观众与会话。 |
| `GET /admin/analytics/playback-quality` | 管理，实际需 `analytics.read` | 同日期参数，查询首帧、错误率、卡顿、清晰度、网络与最近播放错误。 |
| `GET /admin/analytics/client-events` | 权限(`analytics.read`)；仅五个指定包 | 过滤 `eventKey/releaseId/placementId/errorCode/operationId/platform/strategyVariant/adPhase/userId/from/to/cursor`，分页读取前端原始埋点。 |
| `GET /admin/analytics/ad-diagnostics` | 权限(`analytics.read`)；仅五个指定包 | `hours?`（默认 24、最多 72）、`from?/to?/releaseId?/platform?/adType?/placementId?/strategyVariant?/operationId?`；按操作 ID 聚合首位/备位尝试、展示成功/失败、关闭、完播、50008/11006 和错误来源。返回 `from/to/summary/errors`。 |
| `GET /admin/analytics/player-diagnostics` | 权限(`analytics.read`)；仅五个指定包 | `hours?/from?/to?/releaseId?/platform?/operationId?`；按操作 ID 聚合启动、首帧、错误、预加载命中和首帧 P50/P95，返回 `from/to/summary/errors`。时间窗必须位于最近 72 小时。 |

## 6. 关键数据契约与排障顺序

1. **广告展示与权益不同。** SDK `show()` 成功后，小程序上报 `/ad-events` 的 `SHOWN`；入口 `shown/complete` 或剧集 `reward-session/.../complete` 再确认计数/解锁。`/analytics/events` 的 `ad_show` 是观测数据，不能替代业务证据。
2. **v0.0.6 双位的职责。** Android 前端使用两个广告位实例并行准备，展示时选一个；同一广告位的重复 `load()` 在前端按位串行。iOS 前端使用单广告位。服务端会话返回可用 ID，并验证 `SHOWN` 的广告位属于该会话；后台配对开关不驱动 `v006-dual`。入口展示次数与是否启用仍由服务端策略决定。
3. **播放凭据。** `/episodes/:episodeId/play` 返回的平台剧目/分集 ID 与 BytePlus VID 供 VePlayer 使用；`playAuthToken` 可以为 `null`，前端需按播放器运行环境处理，不能把 200 响应误判为首帧成功。首帧及错误由 `/playback-quality-events` 和后台诊断查看。
4. **异步同步。** `sync-*`、`review-submit`、`online/offline` 返回任务后，继续查 `/admin/platform-sync-jobs` 和共享操作状态；不要只凭入队成功判断 TikTok 已审核/上线。
5. **排障关联。** 优先按 `requestId` 找 API 错误；广告按 `releaseId + launchId/sessionId + clientEventId + placementId + adIndex` 对齐 SDK 事件、`/ad-events` 与会话结果；播放器按 `episodeId + sessionId + playerOperationId` 对齐播放接口和首帧上报。

## 7. 源码与资料索引

- 路由注册与前缀：[`apps/api/src/app.ts`](../apps/api/src/app.ts)。
- 小程序自定义接口：[`apps/api/src/modules`](../apps/api/src/modules) 下各模块的 `routes.ts`；管理接口集中在 [`admin/routes.ts`](../apps/api/src/modules/admin/routes.ts)。
- 鉴权与权限映射：[`plugins/auth.ts`](../apps/api/src/plugins/auth.ts)。前端调用入口：[`api-client.ts`](../apps/mini-web/src/lib/api-client.ts)、[`admin-api.ts`](../apps/admin-web/src/admin-api.ts)。
- 官方能力本地摘要：[`TikTok_Minis_开发者文档本地摘要.md`](./TikTok_Minis_开发者文档本地摘要.md)。官方在线文档请以第 2、3 节直链为准。

> 本文是当前代码的人工接口目录，不是自动生成的 OpenAPI schema。新增/删除路由、修改 Zod 入参或调整权限映射后，应同步更新本文及正式 OpenAPI；尤其要复核 `/admin/analytics/revenue/import` 的实际写权限。

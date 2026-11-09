# Mini 埋点与调试面板

## 覆盖范围

`dramaflicks`、`heartreel`、`zenclip`、`sweetreel` 和 `luxereel` 共用 Mini 前端埋点实现。

事件先暂存在小程序页面内存队列中；有用户会话且上传成功后，经 `/api/<miniAppKey>/v1/analytics/events` 批量写入该小程序独立 PostgreSQL 数据库的 `ClientAnalyticsEvent` 表，支持 `eventId` 幂等。服务端从用户 JWT 获取 `userId`，客户端不能自行指定用户身份。未登录、网络失败、测试 mock 模式及队列超限时，本机看到的事件不一定入库。

## 事件

- `app_open`：一次页面启动对应一个 `launchId`。
- `ad_config`：入口广告策略成功、失败或超时。
- `ad_load`：广告素材加载结果；运行时没有 `load()` 时记录 `unsupported`。
- `ad_show`：`show()` Promise 接受或失败。
- `ad_close`：Rewarded 使用 `isEnded`，Interstitial 使用 `isEnded: null`。

SDK 原始错误会拆分保存为 `errorCode`、`errorMsg`、`subErrorCode` 和脱敏后的 `errorExtra`。错误文本中的 Token、授权 code、URL 查询参数和签名字段不会写入数据库。

`adSeq` 在本次页面运行中跨入口广告、剧集解锁广告和插屏连续递增；`ad_load.durationMs` 记录 SDK 实际 `load()` 的耗时，`ad_close.durationMs` 从 SDK 接受展示到关闭计算。没有 `load()` 的运行环境使用 `unsupported`，不把缓存等待时间伪装成加载时间。

v0.0.6 四包扩展了 `adType`、跨页面唯一的 `operationId`、`attemptNo`、`adPhase`、`errorOrigin`、`strategyVariant` 和 `placementRole`。`errorOrigin` 分开标记 SDK `onError`、`show()` Promise 拒绝、应用超时和 API HTTP 失败；主位/备位展示尝试分别记为 1/2。广告回调原对象继续只保留限长、脱敏的 `metadata.sdkCallback`。播放器质量事件增加 `playerOperationId`、平台、TikTok 客户端版本、阶段和预加载命中标记。正数 `TIME_UPDATE` 仍是“首个有效画面”的近似指标，不等于视频像素检测。

## 调试面板

将对应包的 `VITE_DEBUG_PANEL=true` 注入本地或测试构建后，连续点击顶部小程序名称 5 次进入 `/debug`，相邻点击不超过 500ms。面板只读取当前设备的最多 200 条内存环形日志，包含运行环境、请求摘要、运行时错误和 `app_open / ad_config / ad_load / ad_show / ad_close` 埋点。支持分类筛选、复制脱敏数据和清空；刷新或关闭页面后内存记录消失。

彩蛋页采用 Network/Ads & Events/Console/Environment 工作台。Network 左侧逐次列出请求、状态和耗时，右侧有概览、Headers、Payload、Response、Timing、Raw。请求 URL 去掉查询串，参数在 Payload 中单独显示；请求头、请求体、可读取的响应头和 JSON 响应只在调试构建的本机内存保留限长脱敏预览。Authorization、Cookie、Token、口令、点击标识、用户 ID、签名及 URL 查询凭据不展示。跨域失败时浏览器通常不给响应头或响应体；这里无法替代浏览器内核的完整 F12 网络面板，也不捕获网页静态资源和 SDK 原生网络请求。

自动登录恢复前收到的 401 与恢复后的重试会分别显示；服务端返回非 JSON 错误页时，Response 显示脱敏且限长的文本预览。请求头是应用设置的请求头，浏览器自动补充或禁止读取的头不一定可见。

API 响应统一带 `X-Request-ID`，并通过 CORS 暴露；它与服务端日志中的请求 ID 对应，旧包可忽略该响应头。调试构建在概览中显示 HTTP 状态文本、请求 ID、错误码、响应类型与长度、`Retry-After` 和剩余限流数；Timing 对照客户端总耗时与服务端已有的 `Server-Timing`。跨域或代理在 API 之前失败时可能没有这些字段，不能据此推断 API 已处理请求。正式构建不生成详细请求快照，也不额外发起诊断请求。

埋点列表显示中文事件名称、结果、广告序号、广告位、耗时、原始错误码和消息。`中文 error msg` 是根据原始字段生成的排查说明，复制记录时也会附带 `errorMsgZh`；官方 `errorMsg` 仍保持原文。未知 SDK 错误不会推断具体原因。`接口请求` 中的 `POST /analytics/events` 显示批次上传的 HTTP 状态及耗时，只有成功响应才能说明该批次已被 API 接收；仅在 `广告埋点` 中看到事件不代表已入库。调试页不查询服务器历史数据，也不能查看其他用户的记录。

对 `Failed to fetch`，浏览器通常只给出没有 HTTP 响应的泛化错误，不能从这句话区分 CORS、DNS、TLS 与连接失败。彩蛋页另记录脱敏后的页面来源、API 域名、是否跨域、是否需要 OPTIONS 预检、客户端超时/取消和设备在线状态，用于缩小排查范围；确切原因仍需浏览器网络面板、预检响应和服务端日志核对。

`dramaflicks`、`heartreel`、`zenclip`、`sweetreel`、`luxereel` 的 Vite 开发模式使用同源 `/api/<miniAppKey>/v1` 路径，并代理到 `VITE_API_DEV_TARGET`，默认 `http://127.0.0.1:3000`。本地先启动 API，再让 `apps/api/.env` 为目标 Mini 配置独立的 `<APP>_DATABASE_URL`；API 只为已配置数据库 URL 的 Mini 挂载业务路由。没有本地数据库配置时，对应 API 会返回 404；配置了路由但 API 未启动时，代理会报连接失败。不要把本机数据库 URL 指向生产库。此代理只影响 `vite serve`，release 构建仍使用每个包 `.env` 中的生产 HTTPS API 地址。

生产构建保持 `VITE_DEBUG_PANEL=false`。生产数据库事件通过管理员接口 `/admin/analytics/client-events` 查询，需要管理员 `analytics.read` 权限。
管理员接口允许按内部 `userId` 查询；客户端不能指定该字段。
v0.0.6 的管理端另有 `/admin/analytics/ad-diagnostics` 与 `/admin/analytics/player-diagnostics` 聚合视图；按 release、平台、广告类型、阶段及错误码排查时，应以去重操作数作展示失败率分母，不能直接把事件条数解释为独立用户数。

## 数据保护与负载

客户端最多缓存 50 条事件，每 10 条或 2 秒尝试提交，每批最多 10 条；单条 SDK `errorExtra` 超过 4KB 时截断并标记。可重试错误最多上传 3 次，其他 HTTP 错误直接丢弃该批，避免服务故障时持续施压。服务端要求匹配小程序的用户 JWT，从中绑定内部 `userId`；每批最多接收 25 条，`errorExtra` 和 `metadata` 各限制 8KB，并通过 `(miniAppKey, eventId)` 去重。

数据库迁移文件：`apps/api/prisma/migrations/20261106090000_client_analytics_event/migration.sql`。

## 上线顺序与限制

v0.0.6 目前只完成本地代码、测试和构建校验，未迁移目标数据库、发布或完成真机验收。上线时先在隔离 PostgreSQL 中演练增量迁移，再逐一迁移目标小程序的独立数据库，部署兼容旧包的 API 与管理端，核对 `/analytics/events` 的端到端入库，最后上传四个 v0.0.6 包。旧包仍使用原有广告、奖励和剧集接口。

正式发布包默认不包含调试页。需要在 TikTok 手机端测试彩蛋时，另用 `VITE_DEBUG_PANEL=true` 构建测试包；不应把无鉴权的本机请求日志入口直接开放给生产用户。Mini Drama SDK 是否提供 `load()`、系统版本信息取决于客户端环境；缺少能力时字段为空或记录 `unsupported`，不能把它解释为广告加载失败。

新事件会增加数据库写入量。上线后应观察批次请求量、数据库 CPU 和表增长，并制定保留期与清理任务；当前迁移尚未包含自动清理，不能无限期保留诊断数据。

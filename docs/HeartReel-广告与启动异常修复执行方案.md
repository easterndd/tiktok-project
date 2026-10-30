# HeartReel 广告与启动异常修复执行方案

## 1. 目的与适用范围

本文针对 HeartReel Mini Drama 在 2026-10-28 日志中的广告、启动/API 异常和 2026-10-29 服务器 CPU 高负载问题，以及**仅入口广告**的双激励位轮换和竖屏视频适配，提供前端和后端 API 的统一执行方案。另附本次 StoryFlicks、DramaBlaze、CineReels、DramaHit、TaleTV 五个 Mini 的入口位及插屏位配置执行记录。剧集解锁、退出挽留仍使用后端配置的单广告位及现有会话/完播校验。

- 104111006 / 11006：广告视频仍处于 active，新的广告 JSB 调用被拒绝。
- 101150000 / 50008：错误码与 `env check failed, current env is unavailable for iaa` 文案疑似不一致，需保留结构化原始字段确认实际子错误。
- 用户另行报告的 11002（广告实例 ID 无效）及 50009；这两个码没有出现在本次粘贴附件中。
- ENTRY_GATE_SLOW：入口门禁 15 秒仍未完成。
- auth/anonymous/session、home、app-entry-ad-sessions 的 Failed to fetch、HTTP 0 和 20 秒超时。
- CPU 优化前曾出现 API/PostgreSQL 高 CPU、Prisma P2028 和 HTTP 500；2026-10-29 后续优化版已部署，短窗口复测无 5xx 且 PostgreSQL CPU 下降，但 API 及同机网站仍有持续 CPU 负载，需要按相同流量窗口继续观察。

方案按先恢复可用、再修复广告调度、最后灰度恢复广告策略执行。本文只描述可审核的实施步骤，不直接修改线上 Portal、数据库或生产服务器。

## 2. 已确认事实

### 2.1 HeartReel 配置

| 项目 | 当前值 |
|---|---|
| TikTok App ID | 7694176685453625365 |
| API | https://api.evergreenprosper.com/api/heartreel/v1 |
| 构建 release ID | 未设置 VITE_MINI_RELEASE_ID，实际使用 default |
| 入口广告位 | ad7690961683200739334 |
| 入口模式 | REWARDED_GATED |
| 入口要求次数 | 10 |
| 入口计数 | SHOWN |
| 广告不可用 | ALLOW |

配置证据来自 tmp/storyflicks-app-comparison-20261026.jsonl 的 HeartReel 报告。正式变更必须从管理后台或受控管理员 API 完成。

### 2.2 代码链路

前端入口链路：

- apps/mini-web/src/components/EntryAdGate.tsx
- apps/mini-web/src/features/ads/entry-ad-flow.ts
- apps/mini-web/src/features/ads/app-entry-ad.ts
- apps/mini-web/src/features/ads/ad-instance-cache.ts
- apps/mini-web/src/features/ads/ad-activity.ts
- apps/mini-web/src/lib/api-client.ts

后端链路：

- apps/api/src/modules/auth/routes.ts
- apps/api/src/modules/app-entry-ads/routes.ts
- apps/api/src/modules/home/routes.ts
- apps/api/src/modules/diagnostics/routes.ts
- Prisma AppEntryAdPolicy、AppEntryAdSession、AppEntryAdCompletion、AdEvent、AppSession、User、WatchProgress 模型

### 2.3 责任边界

| 现象 | 主要责任 | 结论 |
|---|---|---|
| 11006 | 前端广告 show 并发或原生广告仍处于 active | TikTok 官方定义为已有广告正在展示；后端不产生此 JSB 错误，但前端短间隔重试会增加 API/诊断流量。 |
| 11002 | 前端传入无效/不匹配/已失效的广告实例 ID，或实例生命周期错误 | 错误在原生广告调用处产生；需关联 create、load、show 与实例 ID hash，不能只看后端。 |
| 50008 | Mini 容器处于屏幕外预渲染状态，广告操作不可用 | 等待 Mini 可见后有限重试；不能用普通延时替代生命周期检测。 |
| 50009 | 当前客户端/设备/广告类型所在环境不可用于 IAA | 与 50008 分开处理；不支持的环境不应反复重试。 |
| 附件中的 50008 文案 | `env check failed, current env is unavailable for iaa` | 官方码表将类似“环境不可用”含义列为 50009；这是码文不一致信号，不足以单凭文案断定根因。保存完整错误对象中的 `error_code`、`sub_error_code`、`inner_error_code`、`error_msg`、`inner_error_msg`、`error_extra`。 |
| ENTRY_GATE_SLOW | 前端门禁设计及前置请求/广告等待 | 不是 TikTok 独立错误码；重复上报会放大诊断写入量。 |
| HTTP 0、Failed to fetch | 网络、CORS、客户端 abort、代理或后端超时 | 只表示客户端未拿到有效 HTTP 响应；用 requestId、反向代理和 API 访问日志判断请求是否到达。 |
| 客户端 20 秒超时 | API 客户端 AbortController 或 WebView 生命周期 | 附件中 916,870 ms 等计时可能包含页面挂起/恢复，不等于服务器处理耗时；需结合 visibility 和服务端耗时。 |
| CPU 高、P2028/HTTP 500 | CPU 优化前确认 API 与数据库请求负载高，并出现大量事务超时 | `/shown`、广告事件、诊断写入、后台/Worker 大表查询及同机网站负载都曾是热点；优化版后 90 秒日志未见 5xx，但短样本不能代表长期稳定。 |
| requiredCount=10 | 后端运营策略 | 会放大入口广告等待、重试及请求数量；新版入口应脱离服务端逐次门禁。 |

### 2.4 附件日志统计与证据边界

对用户粘贴的 `heartreel-20261027T083120Z` 日志按文本出现次数统计如下。重复上报和重复展示会让同一故障出现多行，因此这些数字**不是独立用户数或独立故障会话数**。

| 日志内容 | 文本出现次数 |
|---|---:|
| 11006 | 4 |
| 50008 | 12 |
| ENTRY_GATE_SLOW | 8 |
| `/auth/anonymous/session` | 4 |
| `/home` | 4 |
| `/app-entry-ad-sessions` | 2 |
| Request timed out after 20 seconds | 3 |
| Failed to fetch | 3 |
| Fetch is aborted | 2 |
| 11002、50009 | 0（附件未出现；用户在其他场景报告） |

附件中的 HTTP 0 与 `Failed to fetch` 既有 89–93 ms 的快速失败，也有页面恢复后显示 916,870 ms 的超长客户端耗时。应同时记录请求开始时间、结束时间、页面可见状态、客户端超时/abort 原因和服务端 requestId；不能把客户端耗时直接当作 API 或 SQL 执行时间。

### 2.5 跨会话结论与当前状态

| 范围 | 当前结论 | 最终决策 |
|---|---|---|
| CPU 线上版 | 按用户确认，服务器已部署 [20261029-cpu-telemetry-optimization.md](20261029-cpu-telemetry-optimization.md) 所记录的版本。记录中的镜像：`quickreels-api@sha256:f4cd66077fcd67a8ee4c9abc72729e734ecea60eaa4fd724d34872db1be0dd3c`；Worker 同步替换。 | 先保留该版本并同口径复测；不要重复部署旧 `c4013b6`，也不要把短窗口无 5xx 等同 CPU 已彻底解决。 |
| 入口广告双位 | 只用于 HeartReel 新版入口，不用于剧集解锁、退出挽留或插屏。 | 两个经 Portal 核验的 ID 固定随前端包发布；本地跨启动 A/B 轮换，每次最多尝试一支，失败只有限切换一次；服务端仍控制启动资格/豁免，不下发广告位 ID。 |
| 入口曝光数据 | 入口曝光不是权益账本；用户明确希望不记录入口每次 shown/完播。 | 新版入口不创建 `AppEntryAdSession`，不调用入口 `/shown`、`/complete`，不写逐次入口 `AdEvent`；匿名会话、启动上下文、共享 IP、归因、用户/IP 豁免继续保留。剧集奖励必须继续后端验证完播。 |
| 错误定位 | 附件有 11006、50008、入口超时及 HTTP 0；11002、50009 是用户在其他场景报告，未出现在附件。附件 50008 与环境不可用文案疑似码文不一致。 | 保留外层/内层错误码和文案；分开处理 busy、实例失效、offscreen 与 IAA 环境不可用，避免仅按 message 推断。 |
| 启动时序 | 当前 `AppProviders` 包含 `EntryAdGate`；它等待匿名/TikTok 会话与入口策略，再运行广告流程，页面通过 `useEntryAdReady` 检查门禁状态。入口不是与首页完全解耦的 best-effort 流程。 | 改为首页壳、导航和首页数据立即可用；广告尝试与首页请求并行，任何广告/API 失败均不阻止进入和播放。 |
| 播放器 | 视频素材确认是 9:16：`1080x1920`、`720x1280`、`540x960`。 | 以真实 VePlayer 媒体容器保持 9:16、宽度自适应、`object-fit: contain` 为基准，真机验证三档素材，不改变视频流。 |

**当前实现边界**：CPU 后端优化已部署。HeartReel 自身的入口本地双位、完全解除入口门禁、原生错误字段完整采集/分类和播放器尺寸修复仍待实施及真机验收。本次五包的入口双位代码已写入本地工作区，但尚需完成测试、Mini 构建、包体检查和发布；不代表生产 API 或 TikTok Portal 已更新。

### 2.6 本次五个 Mini 的广告位与发布约束

`inter_data.txt` 提供的广告位如下。每个包只编译进本应用的两个入口激励位；入口 A/B 只用于启动入口广告。剧集解锁仍使用 API 按 Mini 配置的单激励位，插屏仍使用 API 的 episode-interstitial 配置，不读取入口 A/B。

| Mini | 入口激励位 A | 入口激励位 B | 剧集转场插屏位 |
|---|---|---|---|
| StoryFlicks | `ad7701584763127842868` | `ad7690440635429750836` | `7698625673044428852` |
| DramaBlaze | `ad7701598256443410484` | `ad7690437304389814293` | `ad7701250594312390677` |
| CineReels | `ad7701610884636198918` | `ad7688619656965752838` | `ad7701598971906803713` |
| DramaHit | `ad7701602721589544961` | `ad7691096706410678293` | `ad7701591362000848902` |
| TaleTV | `ad7701580188146124806` | `ad7688599028879722512` | `ad7701229465732532245` |

本次本地产物及待配置的策略版本：

| Mini | 构建 release ID | 压缩包 |
|---|---|---|
| StoryFlicks | `storyflicks-20261029T072048Z-900c91` | `apps/storyflicks/dist/minis.config.zip` |
| DramaBlaze | `dramablaze-20261029T072106Z-0f32af` | `apps/dramablaze/dist/minis.config.zip` |
| CineReels | `cinereels-20261029T072121Z-abed61` | `apps/cinereels/dist/minis.config.zip` |
| DramaHit | `dramahit-20261029T072139Z-6f6694` | `apps/dramahit/dist/minis.config.zip` |
| TaleTV | `taletv-20261029T072156Z-730e46` | `apps/taletv/dist/minis.config.zip` |

实施位置与边界：

- 入口 A/B 清单位于 `apps/mini-web/src/features/ads/entry-ad-placement-config.json`，由五个 Mini 的 Vite 配置分别注入，避免把其他 Mini 的广告位打进当前包。
- 前端在本地持久化下次使用的位序，只在 SDK 接受展示后轮换。一次启动最多尝试两个入口位；广告无效、不可用或无填充时有限结束并放行首页。入口展示不创建入口广告 session，不请求 `/shown`、`/complete`，不写逐次入口 `AdEvent`。
- `/auth/launch-context` 仍负责启动上下文和入口资格，并保留共享 IP 访问、归因、用户豁免与共享 IP 豁免；API 不向客户端返回入口位 ID。资格查询失败时入口广告跳过，不阻塞首页。
- API 插屏变量为 `STORYFLICKS_EPISODE_INTERSTITIAL_PLACEMENT_ID`、`DRAMABLAZE_EPISODE_INTERSTITIAL_PLACEMENT_ID`、`CINEREELS_EPISODE_INTERSTITIAL_PLACEMENT_ID`、`DRAMAHIT_EPISODE_INTERSTITIAL_PLACEMENT_ID`、`TALETV_EPISODE_INTERSTITIAL_PLACEMENT_ID`。对应值已加入 API 与生产环境示例配置；按用户确认，生产服务器也已有这批插屏位，本次不修改服务器环境或部署 API。发布前仍应只读核实 API 容器实际环境及对应 Mini 路由的返回值。
- 新 Mini 前端依赖新版 `/auth/launch-context` 返回 `entryAdEligibility`。若只上传前端而生产 API 尚未包含此兼容改动，客户端会因拿不到资格结果跳过入口广告，但首页仍可用；应先灰度部署 API，再发布 Mini。
- release 构建会生成新的唯一 `releaseId`。API 资格依赖该 release 的入口策略；包构建后、上传前，需在管理端为 `apps/<mini>/dist/minis.release.json` 中的准确 `releaseId` 配置策略，建议 `enabled=true`、`mode=REWARDED_GATED`、`requiredCount=1`、`countMode=COMPLETED`、`onUnavailable=ALLOW`。未配置或未启用时会返回不可展示并放行首页，不会自动继承旧 release 策略。
- 发布前在 TikTok Portal 确认两条入口位均属于正确 App、已启用且适用于目标 Preview/Release 环境；构建校验只能证明包内 ID 与清单一致，不能证明 Portal 审核/填充状态。

这五个 Mini 的入口 A/B 和插屏配置不表示 HeartReel 已应用同一前端代码，也不改变其他 Mini 的入口广告策略。剧集解锁奖励必须继续使用后端配置位、服务端 session、展示证据和 `isEnded` 完播确认。

官方参考：

- TikTok Mini Drama In-App Ads: Rewarded Ads
  https://developers.tiktok.com/docs/en/tiktok-minis-in-app-ads
- TikTok IAA Error Code Reference
  https://developers.tiktok.com/docs/en/mini-games-error-code-reference

## 3. 最终目标

### 3.1 前端目标

1. 同一 adUnitId 任何时刻只有一个 load 在途。
2. 所有入口、剧集激励和插屏 show 全局串行。
3. 每个广告实例只调用一次 show。
4. 11006 遇到时保留实例、退避重试，不立即销毁和补池。
5. 页面不可见、正在预渲染或 SDK 未 ready 时不调用 show。
6. 50008/50009 不阻塞首页，且记录完整原始错误。
7. 入口广告整体等待有时间预算，超时按 ALLOW 进入应用。
8. StrictMode、重复挂载、Try again 不产生重复广告流程。
9. HeartReel 新版入口广告不请求广告位 ID，不创建服务端入口会话，不写入每次展示或完播；A/B 选择只发生在前端。

### 3.2 后端目标

1. 新版 HeartReel 入口不再调用入口会话 API；若旧版仍被 10 次门禁阻塞，再按 release 定向关闭旧策略。2026-10-29 的 CPU 部署没有关闭 HeartReel/SweetReel 策略，不能把“策略已关闭”当作线上现状。其他 Mini 及旧包按各自配置运行。
2. 剧集解锁、退出挽留的会话、展示证据、完播确认和幂等逻辑保持服务端校验。
3. 匿名会话和首页响应达到明确延迟预算。
4. 真实 TikTok Origin 通过 Portal Trusted Domains、CORS 和反向代理验证。
5. 所有启动请求具备 requestId、server-timing 和可聚合日志。
6. API 暂时不可用不能让入口广告永久阻塞主应用。

## 4. 阶段 A：立即止血

### 4.1 旧版本门禁的紧急开关

仅当仍在线的旧版 HeartReel 被入口门禁卡住、且无法立即发布新版时，才使用服务端紧急开关。先核对策略对应的 `releaseId` 和受影响 Mini；不要因为 CPU 高就关闭所有 Mini 的入口策略。2026-10-29 已部署的 CPU 优化保持 HeartReel/SweetReel 策略启用。

如果确认要止住旧版强制门禁，在管理后台对 HeartReel 对应 release 设置：

| 字段 | 值 |
|---|---|
| enabled | false |
| mode | REWARDED_GATED |
| requiredCount | 1 |
| countMode | COMPLETED |
| onUnavailable | ALLOW |

`enabled=false` 是旧客户端的紧急止血开关；`requiredCount`、`countMode` 是将来重新启用旧策略时的安全默认值。这不是解决 P2028 或 API CPU 的替代措施。新版本地 A/B 上线后，应由新版不调用旧入口接口来降低请求量。

现有管理员接口路径：

PUT /api/heartreel/v1/admin/app-entry-ad-policy

变更后使用管理员读取接口确认目标 `releaseId`、`enabled=false`。不要用匿名用户 token 推断后台策略是否已经保存；恢复时也要记录操作者、时间和 release。

### 4.2 入口不可用必须放行

以下情况不得阻塞首页：

- ENTRY_AD_UNAVAILABLE
- AD_BUSY
- 11006、104111006
- 11002、101111002
- 50008、50009
- 广告无填充
- 广告素材加载超时
- 入口展示确认接口短暂失败
- TikTok SDK 不存在或初始化失败

入口广告是可选门禁，不得成为应用单点故障。剧集解锁奖励另按完播校验处理。

### 4.3 固定 release ID

下一次前端构建必须设置稳定 release ID，例如：

VITE_MINI_RELEASE_ID=heartreel-v22-2

实际版本名按发布流程确定。不要让修复包继续共用 default，否则无法区分旧包和修复包的错误率。

## 5. 阶段 B：前端修复

### 5.1 SDK 初始化与页面可见性

涉及：

- apps/mini-web/src/main.tsx
- apps/mini-web/src/lib/ttminis.ts
- apps/mini-web/src/components/EntryAdGate.tsx
- apps/mini-web/src/features/auth/anonymous-session.ts

展示前必须同时满足：

1. window.TTMinis 存在。
2. TTMinis.canIUse(createRewardedVideoAd) 为 true。
3. SDK init 已完成。
4. document.visibilityState 为 visible。
5. 当前页面未取消、未卸载、未进入 pagehide。
6. 全局广告锁为空。
7. 页面已经完成一次可见渲染或平台支持的 onShow 生命周期。

建议增加统一 waitForAdEnvironment(signal)：

1. 等 SDK ready。
2. 等页面 visible。
3. 等一个 requestAnimationFrame。
4. 如果出现 50008/50009，按 100 ms、300 ms、800 ms、1500 ms 退避。
5. 超过入口时间预算则按 onUnavailable 处理。

canIUse 只能证明能力存在，不能证明当前容器已经可展示。

### 5.2 防止 React 重复流程

EntryAdGate 当前在 effect 中启动完整入口流程。需要：

1. 新版 HeartReel 不创建入口 session Promise；以本次启动标识为键缓存本地 `attempted/showing/done` 状态。
2. 同一启动标识最多一次入口 show，不因组件重挂或刷新额外播放。
3. 清理 effect 时取消本组件等待，不把共享的 SDK 广告误判为已关闭。
4. React StrictMode 双挂载不能产生第二次 show。
5. 应用网络错误的 Try again 只重试业务 API，不重新播放入口广告。
6. 页面路由切换后必须停止入口补池定时器。

验收方式：

- 开发 StrictMode 刷新 20 次。
- 快速点击 Try again 5 次。
- 每次启动只允许一个入口 show 在途，不产生入口 session 请求。

### 5.3 同一广告位的 load 串行队列

涉及：

- apps/mini-web/src/features/ads/ad-instance-cache.ts
- 新增或合并 apps/mini-web/src/features/ads/ad-load-gate.ts

建立广告位级队列：

| 状态 | 允许操作 |
|---|---|
| new | 等待入队 |
| queued | 等待前一个 load 结束 |
| loading | 唯一一个同 adUnitId 的 load |
| ready | 可交给 show |
| showing | 禁止再次 show |
| closed/failed | 从池删除 |

规则：

1. Map<adUnitId, Promise> 或等价队列限制同一 adUnitId 一个 load。
2. 创建多个池槽时，后续槽保持 new/queued，不能直接调用 load。
3. 前一槽 onLoad、onError 或 timeout 后才释放闸门。
4. getRewardedAd 不得因为 prewarmNext 立即并发启动相同 adUnitId 的 load。
5. 每个 placement 暂时最多保留 2 个槽。
6. show 过的实例从池删除并销毁。
7. 池中只保留 host 相同的实例，SDK host 变化时清空旧池。

测试包 heartreel-v22.1-pool-early.zip 的可迁移经验是“同一个 adUnitId 的 load 串行”，但其 TTMinis 是 Node vm 模拟，不能代替真实真机验收。

### 5.3.1 双激励位轮换与本地 ID（新增）

**已确认的测试包行为**：`index.html` 内置 rewarded ID `ad7690961683200739334`、`ad7698686827641587732`；`UNIT_SEQ.rewarded` 在创建实例时轮流分配 A/B；`LOAD_GATE` 按 `adUnitId` 排队，同 ID 不并发 load。其 6 槽、20 支连续展示是压测逻辑，不能照搬到真实启动页；两个不同 ID 同时 load 的稳定性也尚需真机验证。

**本次范围**：A/B 仅供 HeartReel 新版**入口广告**使用。剧集解锁 `rewarded-ad.ts`、退出挽留 `EXIT_RETENTION`、插屏均继续使用后端返回的广告位与完整记账链路，不改 `RewardedUnlockSession`、`EpisodeUnlock` 或其 API。入口广告不产生可在服务端兑换的权益，入口是否完播只影响当前页面的本地交互；不把本地计数作为服务端授权条件。

**产品/审核判断**：如果入口广告只是启动曝光，没有“看完后立即获得明确权益”，从官方语义看更适合使用两个 **Interstitial** 广告位，而不是 Rewarded。Rewarded 应在 `isEnded === true` 后给用户明确奖励；把 Rewarded 当作无奖励强制广告虽能调用 SDK，但会造成用户预期、平台审核和收益统计风险。若产品坚持入口使用 Rewarded，必须在页面明确“看完获得什么”，奖励只在当前页面本地发放且不影响剧集后端授权，并先用 Preview 确认审核口径。A/B 轮换、无入口落库的技术方案对两种广告类型都成立；下面以你当前的两个激励位为主描述。

**配置与轮换**：新建 HeartReel 专用 `entry-rewarded-placements.ts`，构建时内置两个已在同一 TikTok Mini 下激活的 Rewarded ID；A 为已知入口位，B 在 Portal 中核对后再启用。构建时校验非空、去重、appKey 与 releaseId，禁止借用剧集解锁或别的 Mini 的 ID。`adUnitId` 是公开参数，不是密钥。轮换指针保存在 `localStorage`（仅做体验优化，不可信也不用于发奖），后续按 A/B 交替；起点可固定 A 或按安装随机。每次入口启动的去重用当前 document 内存状态加启动 epoch，不应只依赖永久 `sessionStorage` 标记：需结合 TikTok Mini `onShow`/冷启动生命周期区分“新启动”和“广告关闭后回到 Mini”，广告回跳不得再次展示。只有 `show()` 确认成功才推进指针；A 加载失败时最多尝试 B 一次，并按原因短期熔断 A。验收要覆盖 WebView 被复用、刷新及广告回跳，避免一启动展示多次或复用 WebView 后永远不展示。

**预热预算**：入口只预热下一次要展示的一个 ID/一个实例，避免为一次展示同时抢两份素材、增加 TikTok SDK 请求或触发频控。A 失败后才懒加载 B；若真机测得备用预热确实降低等待且不增加 11006/30001，再灰度开启每 ID 最多一个 load 的并行预热。show 始终全局串行，每个实例只 show 一次，close 后按第 5.7 节冷却。双 ID 本身不保证填充率或加载速度提高；省掉入口 API 往返和提前预热才是可验证的加速来源。

**无入口广告会话/完播落库的调用链**：新版 HeartReel 的 `EntryAdGate.tsx` 必须让 children、首页 API 和主导航立即可用；入口广告是独立的 best-effort 展示流程，不能再通过 `useEntryAdReady` 禁用首页按钮或阻止播放页进入。应用仍保留匿名会话和已有的 `/auth/launch-context` 启动记录；将入口展示资格并入该启动记录响应，入口广告控制器只在 `showEntryAd=true` 时从前端配置取 A/B 并直接调用 TikTok SDK。对入口禁止调用 `startAppEntryAdSession`、`runEntryAdFlow` 的旧服务端计数分支、`recordAppEntryAdEvent`、`acknowledgeAppEntryAdShown`、`completeAppEntryAd`。剧集解锁仍正常调用自己的 `/reward-session`、`/ad-events`、`/complete`。资格请求失败、两位都失败、广告超时或 SDK 不可用时均放行首页，不重试整条启动链。`onClose({isEnded:true})` 可作为当前页面的本地状态，但不发送到后端；未完播不伪造奖励。

**与双广告位的关系及保留方式**：双广告位 A/B 轮换只负责“本次入口展示使用哪个 `adUnitId`”，不决定共享 IP、归因或豁免策略；这些能力可以保留，不会影响 A/B 轮换，也不要求记录入口广告完播。真正需要避免的是把它们继续绑定在每次入口广告的 session/shown/complete 链路上。

推荐把入口请求拆成两层：

1. **启动资格层（保留）**：扩展现有每次启动会调用的 `POST /auth/launch-context`，让 `recordMiniLaunch()` 返回 `{ saved, entryAdEligibility: { showEntryAd, reason? } }`。不要新增一次网络请求，也不要只依赖 `/auth/anonymous/session`，因为匿名会话通常会复用本地 token、不会每次启动都请求。该层使用当前请求的 `launchContext` 和 IP，异步 `queueSharedIpVisit`，用请求中的 `launchQuery` 直接执行归因判断，并检查 IP 豁免、用户 `appEntryAdExempt` 及合并用户豁免。响应不返回广告位 ID、不创建 `AppEntryAdSession`，也不写 `AdEvent`、`AppEntryAdCompletion`。
2. **展示层（前端本地）**：只有 `showEntryAd=true` 时，HeartReel 从本地 A/B 配置选择广告位并调用 TikTok SDK。入口展示成功、关闭、未完播和失败都只保留内存/本地轮换状态，不发送入口 shown/complete 请求。

这样可以同时满足“保留控制”和“减少开销”：继续使用既有启动网络请求，新增响应字段而不增加一次往返；共享 IP 记录仍为异步、按 `entryId` 幂等写入；归因使用启动请求携带的数据，避免再查询最近 `APP_LAUNCH_CONTEXT`；当前 `/auth/launch-context` 已读取用户合并关系，可在同一次读取中带出用户豁免状态；IP 豁免查询可使用有明确失效时间的短 TTL 缓存。入口广告每次展示不触发数据库读写。共享 IP 统计仍按启动记录，不按 A/B 选择、广告 load、shown、close 或完播事件额外写入。

因此，不需要为了双广告位再调用入口广告 API；入口资格与用户/IP 豁免通过既有 `/auth/launch-context` 请求处理。完全离线时无法保证服务端实时豁免，因此该资格请求失败时按入口广告 best-effort 原则放行应用，并跳过本次入口广告。发布前应对 `showEntryAd=false`、归因缺失、IP 豁免、用户豁免、合并用户豁免、资格请求失败和广告 A/B 轮换分别做验收。

**推荐上线形态**：第一版默认 A/B 只做本地备选与跨启动轮换，入口最多展示一次，失败放行；A 无填充/无效时有限切 B。静态 CDN 开关异步读取，不让它成为白屏/入口时延依赖。若绝对要求每次都交替且禁用某用户时立即生效，需要在线配置/豁免服务，无法同时做到“完全不联网”和“实时后端控制”。

**对应代码改造边界**：

1. `apps/mini-web/src/app/providers.tsx`：HeartReel 不再通过 `EntryAdGate` 等待入口 API session；只挂载匿名会话、诊断和一个独立入口广告启动器。保留其他 Mini 的现有分支。
2. `apps/mini-web/src/components/EntryAdGate.tsx`：拆掉 `LOADING/ERROR` 对 children 的阻塞语义，或新增 `LocalEntryAdAttempt` 组件。Provider 始终先渲染 children；入口广告状态只用于低干扰提示和诊断，不禁用首页按钮，不阻止 `/home`、剧集详情或播放器。
3. `apps/mini-web/src/features/ads/app-entry-ad.ts`：新增 `showLocalHeartReelEntryAd({ placementIds })`，输入只包含本地 ID，不接受 `sessionId`、`requiredCount` 或 `countMode`；复用 `ad-instance-cache`、`ad-activity`、`ad-show` 的 load/show 锁、环境等待和冷却。成功/失败只返回本地结果 `{ placementId, isEnded, errorCode? }`，不调用任何入口 API。
4. `apps/mini-web/src/features/ads/entry-ad-flow.ts`：新版不用旧的服务器计数循环。若保留文件，新增本地一次尝试函数并明确禁止递归重试；旧 API flow 只能被旧包/其他 Mini 使用。
5. `apps/mini-web/src/features/ads/rewarded-ad.ts`：不改剧集解锁链。入口 A/B 选择器不得被共享到剧集解锁，以免误把本地 ID 带入后端的 `RewardedUnlockSession`。

**推荐本地一次尝试算法**：

1. 应用先渲染并并行获取匿名会话、首页；确认 `document.visibilityState === 'visible'`、SDK `canIUse('createRewardedVideoAd')` 和页面生命周期可展示。
2. 读取静态开关/构建开关；关闭、读取失败或超过 500 ms 不阻塞预算时，跳过入口广告。
3. 使用轮换指针选择 A 或 B，创建/预热一支；load/show 总预算 8 秒，等待全局 show 锁和 300–800 ms close 冷却。
4. A 的明确无效/无填充/受限错误只允许切 B 一次；11006/50008 先按统一退避一次，不能把错误立即变成第二次并发 show。A/B 都失败立即结束并放行。
5. 在当前 document 内存状态记录 attempt，`show()` 接受后再持久化 nextIndex；广告关闭后不再次触发同一次启动。不要用永久“已展示”标记阻塞后续新启动，也不要把用户可修改的 localStorage 当作奖励凭证。

**启动速度对照与强制时序**：参考包是广告压测页，检测到 TikTok 广告工厂后立即建立并加载首支；首支 ready 后才扩展到 6 槽服务连续展示。它不等待 HeartReel 的登录、首页或入口策略 API。当前 HeartReel 则是 `ensureAnonymousSession` → `POST /app-entry-ad-sessions` → 返回后才预热 → 等 `load` ready → `show`；匿名 token 已缓存时第一步可跳过，但入口 session 请求仍在广告 load 前。目标实现必须在 SDK 初始化后并行启动首页/现有 `recordMiniLaunch()` 资格请求和本地选中位的一支广告 `load`，不能等资格响应后才开始 load；资格为真且广告 ready 时才 `show`，资格为假或失败则不调用 `show`，并将该实例从业务缓存中移除。入口广告不等待首页 API，也不等待广告完成才开放首页；若用户已离开入口页或页面转入后台，取消本次 show，避免广告迟到后打断用户操作。

以首次原生 `show` 为指标，当前关键路径近似为 `匿名会话（仅无 token 时）+ 入口 session API + 广告 load + show`；目标关键路径近似为 `max(现有启动资格请求, 广告 load) + show`，再加 SDK/原生调度时间。这样能移除一段服务端串行等待，首支速度可以接近参考包，但资格服务、广告填充、设备和 TikTok 容器差异使得无法承诺每台设备都达到压测包的毫秒数。参考包的池 6 是为了缩短 20 支连播的间隔；HeartReel 每次启动只展示一支，不应照搬池 6，也不应为了加速首支同时预热 A、B 两个位。新增 `APP_BOOT_TO_ENTRY_LOAD_START`、`APP_BOOT_TO_ENTRY_LOAD_READY`、`APP_BOOT_TO_ENTRY_SHOW_ACCEPTED` 三个耗时点；现有 `ENTRY_AD_SHOW_ACCEPTED` 只测 `show()` 调用到原生接受的时间，无法衡量从小程序启动到首支广告的总延迟。灰度时按平台、设备、release ID 分组比较 P50/P95，而不是用参考包一次运行的最快值作承诺。

示意逻辑：

```ts
const ENTRY_IDS = ['<HeartReel entry A>', '<HeartReel entry B>'] as const;
const preferred = readLocalNextIndex() % ENTRY_IDS.length;
const selected = ENTRY_IDS[preferred];
// Start eligibility and selected-ID load in parallel after SDK init.
// Show once only when eligibility is true, the ad is ready, and the page is active.
// Persist nextIndex after show is accepted; on bounded load failure try B once.
// Never POST entry shown/completion events.
```

### 5.3.2 广告位轮换的发布约束

- 先把旧 HeartReel `default` 和旧 release 的入口策略关闭，再发新包；新包不调用入口会话 API，旧包和其他 Mini 仍能安全调用原路由。不删除入口表、管理员路由或相关迁移，因为它们还服务其他包及退出挽留/插屏配置。
- 前端内置 ID 意味着撤换 A/B 需要发包。推荐另放一个仅含 `enabled`/`minReleaseId` 的静态 CDN JSON 开关：与 SDK 初始化并行读取，短 TTL，读取失败则不展示入口广告；该文件不查应用 API/数据库。若必须做到入口完全零额外网络请求，则只用构建开关，并接受紧急关闭需要发新版的代价。
- 静态开关不作为服务端授权依据，也不让入口等待它才显示首页；旧版管理员 `enabled` 不会自动控制完全前端化的新包，发布/回滚手册须写明两个开关的作用范围。

### 5.3.3 入口“强弹”策略、参考包差异与正式实现（新增）

#### 5.3.3.1 三种概念必须分开

| 名称 | 行为 | HeartReel 最终选择 |
|---|---|---|
| 自动触发首支 | 小程序启动并检测到 SDK 工厂后自动准备并 `show`，不等用户点击 | **保留**，这是参考包可迁移的“入口强弹”部分 |
| 硬门禁 | 广告未展示/未完播前不允许进入首页或播放器，失败后继续阻塞或重复弹 | **不采用**。会把 TikTok SDK、网络和后端 API 变成启动单点故障 |
| 连续压测强弹 | 首支出现后补池并连续展示 20 支，池深 6 | **不搬到生产入口**。这是测试包的压测流程，不是单次启动产品流程 |

如果产品所说的“强弹”是“打开小程序自动弹一支”，最终方案可以实现；如果是“必须看完且失败也不能进入”，则当前方案没有实现，也不建议使用 Rewarded 来做这种无明确奖励的硬门禁。Rewarded 应在 `isEnded === true` 后给予明确奖励；纯曝光强制场景应评估 Interstitial 和平台审核口径。完全硬门禁还需要服务端资格/完成记录，不能同时满足“入口不落库”和“跨设备不可绕过”。

#### 5.3.3.2 参考包已验证的可迁移逻辑

`heartreel-v22.1-pool-early.zip` 的 `index.html` 行为是：

1. `AUTO_BOOT=true`，检测到真正拥有 `createRewardedVideoAd` 的 SDK 对象后自动启动，不等待用户点击。
2. Android boost 流程首支直接激励，不再先用插屏打底；首支出画面后才补池到 6 支，目标连续 20 支。
3. 两个激励位 A/B 可各自建立 load 通道；同一个 `adUnitId` 通过 `LOAD_GATE` 串行，不同 ID 才允许并行。
4. `104111006/11006` 被视为平台 active 锁，不立即判死实例、不马上补池；按退避等待平台释放。
5. 连续无填充有失败熔断；每支 show 使用全局 show 锁、监听清理和关闭等待。
6. Android 的 `beforeunload` 返回挽留最多三次；它是测试包的退出挽留实验，不是入口广告必须逻辑，iOS 也不支持同样的原生返回框。

这些逻辑可以迁移为 HeartReel 的 SDK 安全层。测试包的 6 槽、20 支、45 秒关闭等待和 Android 返回拦截不能直接作为生产入口参数。

#### 5.3.3.3 HeartReel 正式入口时序

正式入口采用“自动首支、单次尝试、失败放行”的强弹展示策略：

```text
Mini onShow / 冷启动
  -> 立即渲染首页壳和导航
  -> 并行启动 launch-context 资格请求、首页请求和 SDK 工厂探测
  -> 选择本地 A/B 广告位，启动该位 load（同 ID 只有一个 load）
  -> 页面 visible + SDK 可用 + showEntryAd=true + 广告 ready
  -> 自动 show 一支（不等用户点击）
  -> show 接受后记录本地 attempt，并推进下一次 A/B 指针
  -> close/error/超时后释放实例和全局锁；本次启动不再次弹
```

关键时序规则：

1. **资格和素材并行**：不再等待入口 `/app-entry-ad-sessions` 返回后才开始 load。新版资格并入已有 `/auth/launch-context`，失败按入口 best-effort 跳过广告；匿名会话和首页不被广告阻塞。
2. **首支自动 show**：这一步实现参考包的入口自动强弹体验，但只展示一支，不连续弹 20 支。
3. **A/B 加速方式**：第一版默认只预热选中的 A 或 B，A 明确无效/无填充后才切另一位；真机证明不同 ID 并行 load 不增加 11006、50008、无填充和频控后，才允许 A/B 各一条通道竞速首支。相同 ID 永远禁止并发 load。
4. **首页与广告解耦**：首页壳、主导航和播放器入口先可用；广告 ready 后在当前页面自动展示。用户已离开页面、Mini 进入后台或已展示过时，取消本次 show。
5. **预算**：SDK 工厂探测不超过 5 秒；首支 load/show 总预算建议 8 秒，入口总预算建议 10 秒；预算耗尽直接放行，不能继续后台重试。
6. **冷却**：close 后等待真实设备验证过的 300–800 ms，再释放广告活动状态；入口本次不再补池。剧集连续激励广告另用其已有链路。

#### 5.3.3.4 SDK 报错防护顺序

| 阶段 | 防护 | 目的 |
|---|---|---|
| SDK 探测 | `canIUse('createRewardedVideoAd')`/`canIUse('createInterstitialAd')`，并寻找真正存在工厂方法的对象 | 避免空壳 `TTMinis` 导致工厂不存在 |
| load | `Map<adUnitId, Promise>`/load gate；同 ID 一个在途实例 | 避免同位并发 load 触发 11006/active 锁 |
| show 前 | 页面 visible、Mini onShow 状态、全局 show coordinator、实例 state=ready | 避免 50008、重复 show 和 11002 |
| show 中 | 同一实例只调用一次 `show()`；同时处理 Promise、`onError`、`onClose` | 避免 show 结果丢失和监听泄漏 |
| 11006 | 保留当前实例，不立即销毁/补池；等待 1、2、4 秒，最多一次入口重试 | 给原生 active 状态释放时间，避免错误雪崩 |
| 11002 | 记录实例代次和 adUnitId hash；确认前一 show 已结束后最多重建一次 | 避免死实例循环补池 |
| 50008 | 等待 visible/onShow 后最多恢复一次 | 避免屏幕外预渲染调用广告 |
| 50009 | 视为环境/广告类型不可用，记录后跳过本次 | 不在不支持环境无限重试 |
| close/error | 移除监听、释放实例、释放全局锁、冷却后结束本次入口 | 避免下次 show 撞原生状态 |

所有错误保留外层 code、inner/sub code、message 和安全 extra；`50008` 与 “environment unavailable” 文案不一致时标记 mismatch，不能只按文案改成另一个错误码。

#### 5.3.3.5 当前状态与验收

当前工作区的 `EntryAdGate.tsx` 仍执行 `ensureAnonymousSession` → `startAppEntryAdSession` → `runEntryAdFlow`，并按后端 `requiredCount` 循环；因此**参考包式“启动即首支自动强弹 + 本地双位 + 无入口逐次落库”尚未在当前前端实现**。现有代码虽会自动开始旧入口流程，但首支受到 API session 串行等待影响，且可能连续展示后端要求的多支广告。

新包必须通过以下验收才算实现入口强弹：

- 无用户点击时，SDK 可用且资格为真时自动调用一次入口 `show()`。
- 首次 `load` 启动时间点早于资格响应完成时间，或两者同一并行批次启动。
- 同一启动只出现一次入口展示；广告回跳/页面恢复不重复 show。
- 首页渲染不等待广告；SDK 不可用、资格失败、load 超时、11002/11006/50008/50009 均在预算内放行。
- 新版入口网络抓包没有 `/app-entry-ad-sessions`、入口 `/shown`、入口 `/complete` 和逐次入口 `AdEvent`；`/auth/launch-context` 的共享 IP、归因、用户/IP 豁免仍有记录和生效。
- 入口 A/B 各至少 20 次真机展示，检查首支 P50/P95、11002/11006/50008/50009、无填充率和重复 show；剧集解锁仍按后端 placement、SHOWN 和完播确认验收。

### 5.4 全局 show 协调器

涉及：

- apps/mini-web/src/features/ads/ad-activity.ts
- apps/mini-web/src/features/ads/ad-show.ts
- apps/mini-web/src/features/ads/app-entry-ad.ts
- apps/mini-web/src/features/ads/rewarded-ad.ts
- apps/mini-web/src/features/ads/episode-interstitial.ts

所有广告种类共用一个 show coordinator，不能只锁 rewarded。

调用顺序：

1. 请求 show。
2. 获取全局 show 锁。
3. 等待环境 ready。
4. 获取 ready 实例。
5. 注册 onClose/onError。
6. 只调用一次 show。
7. 等待 close/error。
8. 移除监听、释放实例、释放 show 锁。
9. 等待 300–800 ms native release cooldown。
10. 才允许下一次 show。

必须记录锁拥有者：entry、rewarded 或 interstitial。

### 5.5 11006 并发和 11002 实例错误处理

错误分类至少包括：

| 原始错误 | 内部类型 | 前端动作 |
|---|---|---|
| 11006、104111006 | busy | 全局 show 锁仍占用或原生层仍 active；等待锁释放/冷却后有限重试，不并发创建实例。 |
| 11002、101111002 | instance-invalid | 检查 adUnitId 与创建实例是否一致、实例是否已销毁/已 show；只在旧实例确定无效且原生 show 已结束后重建一次。 |
| 11003、101111003 | instance-used | 该实例已展示或已消费；废弃该实例，下一次展示使用新实例。 |
| 50008 | offscreen-prerender | Mini 不可见/预渲染时拒绝广告操作；等可见生命周期事件后有限重试。 |
| 50009 | iaa-environment-unavailable | 环境或广告类型当前不支持；记录设备/平台/广告类型，不循环重试。 |
| 20000 | sdk-network | 走网络错误退避并受总等待预算限制。 |

任何码文不一致时，同时保存外层/内层 code、message 和原始对象的安全白名单字段；分类时优先保留官方 code 与 inner code 两套结果，不要用正则只识别 message 后覆盖原始错误码。

busy 处理：

1. 不把当前实例判死。
2. 不立即创建新实例。
3. 先确认当前 JS show 锁已释放。
4. 按 1 秒、2 秒、4 秒、最多 5 秒递增等待；若服务端给出 Retry-After，则采用有上限的服务端等待。
5. 最多重试 4 次，重试共享同一入口总时间预算。
6. 连续 busy 后停止本次入口尝试并放行，不在后台继续重试。
7. 最终仍失败时入口按 ALLOW 放行；剧集解锁显示可重试。

11002 处理：先确认 `adUnitId`、实例创建参数和当前实例代次一致；原生 show 未结束或 show 锁未释放时不重建。确认旧实例无效后最多替换一次并重新 load，不允许同一请求触发销毁/补池循环。

禁止：

show 失败 -> 立即销毁 -> 立即补池 -> 并发 load -> 再次 11006

### 5.6 50008/50009 环境错误和码文不一致处理

1. 50008：先检查 `document.visibilityState` 与 Mini `onShow`/前后台状态，处于 offscreen 时不创建并行实例；收到 visible 后最多恢复一次。
2. 50009：作为 IAA 环境不可用处理；不支持的设备、客户端或广告类型不重复请求，入口直接跳过。
3. 任何错误都不在错误回调中无限创建实例；入口在总预算耗尽后放行。
4. 记录 visibilityState、Mini 生命周期、TikTok 版本、系统版本、设备类型、广告类型和 SDK 初始化状态。
5. 日志保存 `error_code`、`sub_error_code`、`inner_error_code`、`error_msg`、`inner_error_msg`、`error_extra` 及经过脱敏的原始对象字段。附件中的 50008 + “environment unavailable” 必须标为 code/message mismatch，不能静默改写为 50009。
6. 真实 iOS/Android 在可见且支持的环境持续复现时，再携带最小复现信息提交 TikTok Mini Drama 支持工单。

### 5.7 close 后冷却

onClose 到达不等于原生层已经完全释放。处理方式：

1. 标记业务状态 closed。
2. 移除所有监听。
3. 销毁已展示实例。
4. 等待 300–800 ms。
5. 读取下一个 ready 槽。
6. 冷却结束前不调用 show。

冷却值由真机指标调整，不能直接复制测试包的 2.5 秒超时强行放行。

### 5.8 入口门禁逻辑

涉及：

- apps/mini-web/src/components/EntryAdGate.tsx
- apps/mini-web/src/features/ads/entry-ad-flow.ts

HeartReel 新版入口不再使用服务端 `requiredCount/countMode`。入口最多尝试展示一支；`onClose.isEnded` 仅决定当前页面是否得到明确说明的本地体验权益，不能改变剧集访问或后端权益。广告展示与首页加载并行，首页、匿名登录不得因广告或静态开关等待而停滞；广告准备超过建议 8 秒、总入口流程超过建议 10 秒即放行。失败不连续重启三次，也不把“不完播”当作必须补一支的理由。

**平台语义核对**：[TikTok Mini Drama Rewarded Ads](https://developers.tiktok.com/docs/en/tiktok-minis-in-app-ads) 将激励广告用于观看后获得明确奖励，并要求只在 `isEnded === true` 时发放。官方允许前端处理奖励，后端奖励日志是严格风控场景的可选做法；因此“完播不写数据库”本身可行。但若入口仅为强制曝光、用户看完没有任何可说明的收益，激励广告的适用场景不匹配，应改用插屏并遵守其展示时机；若要把进入应用本身当作必须履行的奖励条件，纯前端记录无法跨设备/清缓存可靠执行。上线前应明确入口的用户权益和审核口径，不宣称官方已批准强制入口激励。

### 5.9 前端错误日志

诊断事件至少包含：

- appKey
- releaseId
- platform
- osVersion
- TikTokVersion
- adType
- placementIdHash
- adIndex
- phase
- errorCode
- subErrorCode
- innerErrorCode
- errorMessage
- innerErrorMessage
- errorExtra
- rawErrorFields（仅白名单、长度限制并脱敏）
- visibilityState
- sdkInitialized
- showLockOwner
- durationMs
- requestId

禁止记录：

- client secret
- Authorization
- access token
- 完整用户身份凭证
- 含 token 的 URL

当前 `/runtime-errors` 服务端 schema 只接受 `kind/phase/message/path/requestId/statusCode/durationMs/occurredAt` 等基础字段，未知字段会被丢弃；代码改造需同步更新 Zod 校验、数据库模型/迁移（若要持久化新维度）、管理后台聚合和数据保留策略。前端仅扩充 payload 但不改 API schema，不算诊断完善。

### 5.10 竖屏 9:16 视频的播放器适配（新增）

**素材规格确认**：用户更正后的实际编码尺寸应为 `1080x1920`、`720x1280`、`540x960`（宽 x 高），均为 9:16。原先写成 `1920x1080` 等是宽高倒置。三者只在像素数不同，长宽比相同；如果只有部分清晰度画面显示异常，不能仅凭“分辨率不同”归因于播放器尺寸，需要查源文件和 BytePlus 转码输出的实际宽高、旋转 metadata、显示宽高比及黑边。源文件物理宽高可能与视觉方向不同，需以播放时 `videoWidth/videoHeight` 与真实画面为准。

**当前实现与可疑点**：`PlayerShell.module.css` 的普通 `.shell` 固定 `aspect-ratio: 9 / 16`，但正式剧集在 `WatchPage.tsx` 传 `immersive`，使 `.immersive` 占满 `WatchPage.module.css` 第一网格行并取消 `aspect-ratio`。底部剧集选择区占第二网格行，顶部标题绝对定位覆盖播放器；第一行真实宽高比取决于设备和可用高度，不一定是 9:16。`playerMount` 仅用 `position:absolute; inset:0`，没有显式 `width/height/min-height`；`create-player.ts` 初始化 VePlayer 时也没有传 `videoFillMode`。本地演示 `<video>` 已用 `object-fit: contain`，但这个规则不作用于官方 VePlayer 自建的视频层。不能据此断言唯一根因，需先拍真机图与量尺寸。

**目标视觉规则**：明确两种模式，产品验收选择其一。推荐正式竖屏剧集采用“完整画面优先”：视频按原始比例等比缩放并居中，短边留黑；任何字幕、人物、边缘信息不得被裁。若产品要求任何手机都视觉满屏，采用“满屏优先”：等比放大裁切超出容器部分，记录裁切区域并确认字幕安全区。手机视口、顶部/底部 UI 占用后的播放器区域与 9:16 不一致时，“完整画面”与“无黑边满屏”无法同时成立；不使用 `fill` 拉伸变形。

**前端改造**：

1. 在 `PlayerShell.module.css` 为 `.playerMount` 定义 `width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; background:#000`，使交给官方 VePlayer 的 root 有确定尺寸。保持 `.immersive` 的网格行尺寸由布局决定；不要通过把素材像素宽高直接设置为 CSS 像素来“适配”。
2. 在 `create-player.ts` 显式设置 VePlayer `videoFillMode: 'auto'` 作为完整画面基线；此值及移动竖屏实际行为必须在 Preview 验证。若 SDK 当前版本的 `auto` 仍裁切，依据该版本 BytePlus/TikTok 文档与真机结果调整官方配置或针对 VePlayer 生成的媒体层设置受控的 `object-fit: contain`，不要用全局 `video` 选择器影响广告、首页预览和控件。满屏模式才评估 `cover`/`fillWidth`，先确认两端对选项的解释一致。
3. 挂载后和 `READY` 后量测 root 与 SDK 视频元素的 `getBoundingClientRect()`、`videoWidth/videoHeight`、`object-fit`、computed styles；在 `ResizeObserver`、屏幕旋转、软键盘/安全区变化和 `playNext` 后，容器尺寸稳定时调用官方内核 `player.resize?.()`。调用前确认内核已创建，组件卸载时断开 observer；不要在 `resize()` 内再修改容器造成循环。
4. 切集后如果新视频保持旧视频的布局或旧内核 metadata，先尝试 `playNext` 后 `resize()`；若 SDK 内部未更新媒体尺寸，针对该异常销毁并在同一 root 新建实例，保留播放进度与清理监听。仍异常时记录 SDK 版本并向 TikTok/BytePlus 提交复现材料。
5. 诊断字段增加 `episodeId`、`vid`、源文件/转码的编码宽高与旋转值、`videoWidth/videoHeight`、root/client rect、SDK 媒体层 rect、viewport、DPR、`videoFillMode`、`playNext` 或新建路径。仅记录尺寸和 ID，不记录播放凭证/带 token URL。

**后端和素材检查**：`/episodes/:episodeId/play` 当前返回 `vid`、播放凭证、时长等，没有宽高；`Episode` 表也没有视频宽高字段。先从三条实际故障剧集各抽一个 `vid`，核对上传原文件与 BytePlus 最终可播档位的编码宽高、旋转信息和是否已有黑边。若诊断需要长期自动化，在上传/媒资同步完成时保存 `displayWidth/displayHeight/rotation` 或等价元数据（可空），再让 `/play` 可选返回 `videoWidth/videoHeight` 供诊断和占位布局使用；不能以该字段替代播放器实际媒体尺寸，不能把未经核验的管理后台录入值当作真实宽高。官方播放器仍由服务端提供批准后的 `albumId/episodeId/vid/playAuthToken`，正式剧集不能改用原生 `<video>`。

**与清晰度的区别**：`1080x1920`、`720x1280`、`540x960` 是素材尺寸或转码档位，不等于播放器容器应动态变成三种尺寸。若问题是卡顿/模糊而非裁切，另查码率、转码档位及 VePlayer `defaultDefinition`；只有确认各 `vid` 存在对应档位时才设置该参数，并保持预加载配置一致。官方文档明确默认清晰度与实际档位不一致会导致缓存/预加载未命中。

官方依据：[TikTok Minis Player](https://developers.tiktok.com/docs/en/minis-player)、[BytePlus Web Player kernel resize](https://docs.byteplus.com/en/docs/byteplus-vod/docs-player-sdk-player-kernel)。

## 6. 阶段 C：后端 API 修复

### 6.1 旧入口策略服务与新包边界

涉及：

- apps/api/src/modules/app-entry-ads/routes.ts
- 管理后台广告策略路由
- Prisma AppEntryAdPolicy

服务端规则：

以下是旧包/其他 Mini 使用的入口会话规则；HeartReel 新版不读取这些接口，不能把旧接口优化当成新版入口的必要前置条件。`AppEntryAdPolicy` 还供退出挽留和剧集插屏配置读取，不能整表删除。

1. 入口策略和剧集解锁策略分离。
2. 入口默认 requiredCount=1。
3. 入口默认 countMode=COMPLETED。
4. 入口默认 onUnavailable=ALLOW。
5. 入口策略不允许绑定错误广告类型。
6. placementId 必须非空、属于当前 Mini、已激活。
7. placement 校验失败时策略接口返回明确错误或 required=false，不返回不可诊断的 500。
8. 返回 releaseId、policyVersion、placementId、mode、countMode。
9. 策略接口本身不等待广告素材，不调用 TikTok SDK。

### 6.2 会话幂等和并发

本节适用于继续使用旧入口会话 API 的客户端与其他 Mini；HeartReel 新版入口无服务端 session。剧集解锁原有 `RewardedUnlockSession` 幂等校验继续保留。

现有数据库唯一约束应保留：

- AppEntryAdSession unique(userId, releaseId, launchId)
- AppEntryAdCompletion unique(sessionId, clientEventId)
- AppEntryAdCompletion unique(sessionId, adIndex)

接口规则：

1. 同一 launchId 重试返回已有 active session。
2. shown 和 complete 对相同 clientEventId 幂等。
3. 拒绝错误用户、过期 session、错误 release、跳号 adIndex。
4. Serializable 冲突最多有限重试，超过次数返回 409 或 503。
5. 所有响应带 requestId。
6. 日志关联 launchId、sessionId、releaseId、userId hash。
7. 不允许前端通过修改 completedCount 越过顺序。

### 6.3 匿名会话 API

涉及：

- apps/api/src/modules/auth/routes.ts
- apps/mini-web/src/features/auth/anonymous-session.ts

建议：

1. 登录关键路径只执行 user upsert、app session upsert、JWT 签发。
2. saveLaunchContext 改为非关键写入；失败只记录 warning/telemetry。
3. 同一 visitorKeyHash 和 clientSessionId 保持幂等。
4. 确认线上唯一索引存在。
5. 数据库超时返回明确 503/504 和 requestId。
6. 记录 db、app、总耗时。
7. 匿名会话 P95 超过 500 ms、P99 超过 2 s 告警。
8. 客户端失败重试使用相同 clientSessionId，不创建新身份。

### 6.4 home API

涉及：

- apps/api/src/modules/home/routes.ts
- Prisma schema 和迁移

执行：

1. 在生产数据库执行真实 EXPLAIN ANALYZE BUFFERS。
2. 检查 HomeBlock(enabled, sortOrder)。
3. 检查 HomeBlockItem(blockId, sortOrder)。
4. 检查 WatchProgress(userId, updatedAt)。
5. 检查内容状态、发布时间和 Mini 授权相关索引。
6. 首页只返回首屏字段。
7. 翻译、完整剧集和不必要 JSON 不进入启动响应。
8. 公开首页和配置使用短 TTL 缓存。
9. 用户进度单独查询或短时缓存。
10. 保留 server-timing db 和 app。

目标：

- /home P95 < 1000 ms
- /home P99 < 2000 ms
- HTTP 5xx < 0.5%

### 6.5 CORS、Portal 和代理

必须独立验证：

1. Portal Trusted Domains 包含 api.evergreenprosper.com 主机，不带路径。
2. API CORS 允许真实 Mini Origin，不使用 *。
3. OPTIONS 正确返回 204 和 Access-Control-Allow-Origin。
4. 反向代理允许 OPTIONS 和 POST/GET。
5. DNS、TLS、证书链、IPv4/IPv6、CDN upstream 正常。
6. API 记录 origin、corsAllowed、route、status、requestId、duration。
7. 不记录 Authorization、请求体、完整 query。

真实 TikTok Origin 必须从 API 日志获取；不能用普通浏览器 Origin 代替。HTTP 0 只能说明客户端没有拿到有效响应。

### 6.6 API 时间预算

| API | 目标 P95 | 服务端超时 | 客户端策略 |
|---|---:|---:|---|
| /auth/anonymous/session | 500 ms | 5 s | 同 clientSessionId 重试一次 |
| /app-entry-ad-sessions（旧包） | 300 ms | 5 s | 新版 HeartReel 不请求 |
| /home | 1000 ms | 8 s | 使用缓存或降级首页 |
| 入口 /shown（旧包） | 500 ms | 5 s | 新版 HeartReel 不请求 |
| 入口 /complete（旧包） | 500 ms | 5 s | 新版 HeartReel 不请求 |

前端总 20 秒保护可以保留，但入口流程不能等满 20 秒。新版没有入口策略 API 等待，广告准备 8 秒、总流程 10 秒是建议初值；匿名会话与首页 API 的时间预算另行计算。

### 6.7 新版入口广告的后端边界（新增）

新版 HeartReel 入口 A/B 不属于剧集解锁奖励，因此不修改 `RewardedUnlockSession`、`EpisodeUnlock`、`/episodes/:id/reward-session`、剧集 `/ad-events` 或 `/complete`。这些接口继续使用后端配置的单广告位，并继续验证 SHOWN 证据、`adIndex`、会话、幂等和 `isEnded === true`。

新版入口不调用 `POST /app-entry-ad-sessions`、`POST /app-entry-ad-sessions/:id/shown`、`POST /app-entry-ad-sessions/:id/complete`，也不为每次入口展示写 `AdEvent`、`AppEntryAdCompletion` 或更新 `AppEntryAdSession`。共享 IP、归因和豁免保留在已有 `POST /auth/launch-context` 启动请求中，资格结果随该请求返回；入口广告仍由前端完全本地 A/B 轮换。共享 IP 记录仍是每次有效启动异步、幂等写入，但不会因为广告位切换或展示状态产生额外写入。相较旧链路，每次启动不再读取入口策略/会话并创建或更新 `AppEntryAdSession`，归因不再额外查询最近启动事件；入口每次展示也不再产生数据库读写、事务竞争或完播确认，因此可降低数据库 I/O、连接池占用和 API/Prisma CPU。IP 豁免检查可做短 TTL 缓存；如要求管理员修改后立即生效，则保留每次启动的索引查询。具体幅度要用灰度前后 `/app-entry-ad-sessions`、`/auth/launch-context`、数据库查询/写入量、API/数据库 CPU 和启动 P95 对比确认。TikTok 广告 SDK 的网络和原生播放成本不会消失，广告填充率也不会仅因少写数据库而自动改善。

**当前实现状态**：截至本方案更新时，工作区的 `apps/mini-web/src/features/ads/app-entry-ad.ts` 仍会请求 `/app-entry-ad-sessions`，旧入口流程仍包含 shown/complete 与入口事件上报。前端本地 A/B、不调用上述入口接口、入口资格并入 `/auth/launch-context` 都是待实施的目标，不属于已部署的 2026-10-29 CPU 遥测优化版。上线验收必须以实际构建 release 和网络请求抓包确认，不能只凭本文目标描述。

保留旧入口路由和表结构，原因是旧版本、其他 Mini、运营后台、退出挽留/插屏配置仍可能依赖它们。新版前端通过固定 `VITE_MINI_RELEASE_ID` 或 HeartReel app key 分流；服务端不要根据“无入口 session”给新版返回异常。入口关闭使用前端构建开关，推荐再提供不经过业务 API 的静态 CDN `entry-ad-switch.json`（`enabled`、`minReleaseId`、`version`），失败按关闭处理。静态开关只控制是否尝试，不承担授权、奖励或用户风控。

采用此边界的前提：入口广告完播不会授予跨页面/跨设备可兑换权益，也不是后端必须强制的合规门槛。若产品以后要求“用户必须看完入口广告才解锁某权益”，必须恢复服务端会话和完成记录，不能依赖 `localStorage` 或前端布尔值。

### 6.8 CPU 高负载、P2028 与数据库写放大（新增）

#### 6.8.1 已有线上证据

以下为“服务器ssh小程序”会话和 [20261029-cpu-telemetry-optimization.md](20261029-cpu-telemetry-optimization.md) 的采样记录。不同采样时间和流量不可直接相加；部署后数值是历史短窗口，不代表当前实时状态。

| 采样阶段 | 观测结果 | 解释 |
|---|---|---|
| 部署前高峰，约 11:14 | 4 核主机 1 分钟 load 约 8.6、CPU 忙碌约 95.5%；API 约 2.7 核、PostgreSQL 约 0.4 核、PgBouncer 约 0.13 核；约 568 次 P2028、562 个 HTTP 500/分钟 | API 事务超时是当时的故障，需要与后续部署后的状态区分。 |
| 部署前另一高流量窗口 | API 约 147% CPU，PostgreSQL 约 82%；SweetReel `/ad-events` 约 4,900 次/分钟；HeartReel/SweetReel 5 分钟分别约 1,700 个入口会话及 10,000 级广告事件；诊断写入集中在重复 ENTRY_GATE_SLOW、SDK 和网络错误 | 高频入口流量、诊断写入和后台/Worker 大表分析都是热点候选；此前不能只归因于 `/shown`。 |
| 部署前 60 秒数据库增量 | HeartReel、SweetReel 分别新增约 957、1,986 条 `AdEvent`；没有观察到对应表的全表扫描 | 写负载仍高，即使查询没有 seq scan，也要减少无业务价值的逐次事件写入。 |
| CPU 优化部署后 60 秒数据库窗口 | HeartReel/SweetReel 的 `AdEvent` 和 `AppEntryAdSession` 均 `seq_scans=0`；API CPU 三次约 97.6%、80.7%、91.8%，PostgreSQL 约 34.2%、19.1%、24.5%，Worker 约 0% | 已确认该窗口没有这些表的顺序扫描；API 仍约 0.8–1 核，CPU 明显低于高峰样本。 |
| CPU 优化部署后 90 秒 API 日志窗口 | 未观察到 5xx；401/409 主要为无授权、过期 JWT 和不可用的旧入口 session | 短窗口内未见 P2028/5xx 回归；401/409 需结合旧包流量判断是否预期，不能视为 CPU 故障证据。 |
| 同机其他负载 | 部署前网站容器 CPU 约 38%–47%；CPU 文档指出同机网站容器也有负载，且高频 Mini 请求估算至少约 150 次/秒 | 整机 CPU 不能只按 API/数据库判断；应同步监测独立网站容器与主机总 CPU。 |

部署记录确认 `/ready`、主应用、HeartReel、SweetReel、StoryFlicks、DramaFlicks 首页均 HTTP 200；API/Worker 重启数为 0，管理后台、PostgreSQL、PgBouncer 未重建，HeartReel/SweetReel 入口策略哈希不变。旧 API/Worker 镜像保留为 `quickreels-api:before-cpu-focused-20261029T053307Z`、`quickreels-worker:before-cpu-focused-20261029T053307Z`。此前会话中约 1,096 个 5 分钟 HTTP 500 是 `c4013b6` 阶段较早的验收结果；不能覆盖之后优化版部署后的“90 秒无 5xx”记录，也不能由 90 秒无错推断长期已解决。

#### 6.8.2 当前线上版本已包含的 CPU 优化

按用户确认，服务器目前部署的是 [20261029-cpu-telemetry-optimization.md](20261029-cpu-telemetry-optimization.md) 记录的优化版；本地代码链包含 `c4013b6`、`1608226`、`a1e4725`、`140cbeb` 和 `438bb30` 等累积改动。部署文档记录 API 镜像 digest 为 `sha256:f4cd66077fcd67a8ee4c9abc72729e734ecea60eaa4fd724d34872db1be0dd3c`，并保留 API/Worker 回滚镜像。当前版本已做：

1. **广告事件写入降载**：`REQUESTED` 不落 `AdEvent`；SHOWN 模式下服务器 `/shown` 已推进门禁计数，后续 `CLOSED_INCOMPLETE` 仅鉴权并检查会话，不再逐次写 `AdEvent`；其他模式的完播校验和服务器计数保持原语义。
2. **入口请求/会话写入降载**：只对确有必要的 `SHOWN` 和临近过期 session 续期；FAILED、重复事件和无需参与门禁的诊断事件不再反复更新 session。`/shown` 改为条件更新/原子计数路径，避免旧交互事务竞争。
3. **诊断去重**：同一 Mini、release、错误类型、phase、message、path 和 status 在 30 秒内仅保留一个 `MiniAppRuntimeError` 样本，API 仍返回 202，重复请求标记 `deduplicated: true`。这减少重复行，不改变入口策略、广告计数和用户权限。
4. **启动上下文写入去重**：合并后的 URL、SDK 回调和查询参数未变化时不再更新 `AudienceActivityEvent.metadata`。
5. **公开首页缓存**：公开首页目录按 Mini app 缓存，避免每次启动重复查询；用户专属进度/权限仍需按用户隔离。
6. **管理后台异常概览缓存**：缓存 60 秒并合并相同 cache key 的并发读取，减少每个后台窗口周期性扫描大型 `AdEvent` 表。
7. **Worker 汇总降频**：每日汇总从每 5 分钟刷新改为每 15 分钟刷新，减少反复扫描近期大型事件表。
8. **广告失败退避和性能观测**：旧版入口失败重试改为递增间隔；入口 `/shown` 纳入服务端耗时采样。API 与 Mini Web 相应 lint/测试在 CPU 优化文档中记录为通过，播放器单测曾出现一次并行时序抖动，独立重跑 3/3 通过。

部署范围是 API 与 Worker 镜像；不需要改生产 `.env`，没有重建 Admin、PostgreSQL、PgBouncer，也没有更改入口策略或共享 IP 限制。首次构建因 Docker 不接受 `--cpus` 自动回滚，随后移除该参数重建成功；该失败尝试没有成为线上版本。

**结论更新**：与此前 `c4013b6` 阶段相比，之后部署的 CPU 优化版复测窗口内未观察到大表顺序扫描，并显著降低 PostgreSQL CPU；90 秒 API 日志窗口未见 5xx。但 API 仍约 0.8–1 核，同机网站容器和每秒 150+ Mini 请求依然占 CPU，因此属于“明显改善、继续观测与流量治理”，不能称为 CPU 已彻底解决。后续措施不能收紧共享 IP 限制或关停广告策略来掩盖负载。

#### 6.8.3 后续定位和优化顺序

1. **同口径连续复测。** 至少 15 分钟，每 30–60 秒采集主机 CPU、API/PG/PgBouncer/网站容器 CPU、容器重启/限流、PG 活跃与等待连接、PgBouncer 排队、各路由 QPS/状态码/P95/P99、P2028/5xx 和表读写/seq scan 增量；按 Mini、release 和 route 区分并记录流量总量。15 分钟无错误后再延长到 1 小时及高峰窗口。P2028 路由定位作为“错误复发时”的诊断动作，不把较早的 1,096 个 5 分钟 500 当作最新状态。
2. **先处理剩余客户端请求量。** 当前服务器端去重和缓存已部署，但小程序请求总量仍高。按 route 和 `miniAppKey/releaseId/clientVersion` 找高频请求、重试及旧包；修复客户端重复启动、重复 `ENTRY_GATE_SLOW`、无界重试等问题，保持旧包兼容。网络/API 错误重试使用同请求幂等键、总时间预算和指数退避。
3. **入口广告改为本地 A/B best-effort。** 新版 HeartReel 发布后，入口 ID 从前端配置读取，首页即刻可用；服务端保留入口资格、共享 IP 访问、归因、用户/IP 豁免职责，但入口广告不再创建 session 或逐次写 shown/close/completion。按 release 验证旧路由流量是否下降。剧集解锁仍走现有后端 session、placement、SHOWN 证据和 `isEnded` 完播验证。
4. **诊断使用已部署去重能力。** 服务端 30 秒语义去重已上线；前端仍应合并同一启动的重复 `ENTRY_GATE_SLOW`，并保证不同错误码、平台或关键状态变化不会被合并。监控 `deduplicated` 数量；不要只按 IP 改限流，也不要将每次广告曝光送到 `/runtime-errors`。
5. **继续检查大表和热点 SQL。** 后台异常概览 60 秒缓存及 singleflight、Worker 15 分钟汇总已上线。确认缓存按 Mini/release 隔离且过期/异常时可回源；每次改动后关注 `AdEvent`、`AppEntryAdSession` 的增量、顺序扫描及 query plan。新热点须以实测 EXPLAIN 和 route 数据证明后再改。
6. **最后评估容量。** 若 API 持续 >1 核、主机长期 >85% 或出现连接池等待/CPU throttling，先区分网站容器、API、PG 和自然流量；然后评估 API 缓存、写入批处理、限并发或扩容。不得用收紧共享 IP 限制、改变豁免或削弱奖励校验来降载。

#### 6.8.4 可执行发布与回滚

1. 保持 CPU 优化版 API/Worker 运行，记录镜像 digest 与回滚镜像；当前文档已有部署健康检查和短窗口验收结果。
2. 连续复测同口径 CPU、route QPS、P2028、5xx、PG 扫描与网站容器占用；出现旧版入口 session 的 401/409 时按 client release 确认是否属于过期会话/旧包流量。
3. 首先灰度 Mini 前端入口改造和完整错误诊断，不改生产共享 IP 限制、后端豁免逻辑或剧集授权语义。
4. 只有发现新的服务器 SQL/事务热点且回归测试通过后，才发布 API/Worker；按实际影响范围滚动替换，保留 API/Worker 旧镜像并检查所有 Mini 首页、匿名会话、启动上下文、剧集奖励和旧包接口。
5. CPU 仍高但 5xx/P2028 受控时，定位同机网站与总请求负载，不因 CPU 单指标回滚已减少的大表扫描；功能/错误率回退时才恢复对应服务旧镜像。

## 7. 测试

### 7.1 前端测试

新增或补充：

- ad-load-gate.test.mjs：同一 adUnitId 不并发 load，失败后才放行下一槽。
- ad-show-coordinator.test.mjs：show 全局串行、close/error 后释放、11006 退避。
- entry-ad-environment.test.mjs：hidden 不 show，50008 等待 ready。
- entry-ad-gate.test.mjs：StrictMode 不重复 show，业务 Try again 不重放入口广告，超时放行。
- api-client-startup.test.mjs：客户端 abort、requestId、HTTP 0 诊断。
- ad-error-normalization.test.mjs：读取 Error、cause、嵌套 data/inner_error_code；保留 11002/11006 与 50008/50009 的原始码/文案不一致，不因错误分类覆盖原字段。
- diagnostics-dedupe.test.mjs：同一 launch 的重复 ENTRY_GATE_SLOW 合并，首次严重广告错误保留完整字段，弱网/页面恢复计时能区分客户端挂起与服务端耗时。
- entry-placement-selector.test.mjs：入口 A/B/A/B、页面内一次标记、SDK 不可用/广告无填充时放行、故障位有限熔断、无入口 API 调用。
- app-entry-ad.test.mjs：对入口 `show` 确认 `startAppEntryAdSession`、`recordAppEntryAdEvent`、`shown`、`complete` 均未调用；确认剧集 `rewarded-ad` 链路仍照常调用后端会话和完播 API。
- ad-instance-cache 双位用例：入口 A 与 B 均按 ID 隔离；每 ID 最多一个 load；同一位不并发，真实 ready 前不 show；跨位并行失败时能切单闸。
- PlayerShell/VePlayer 尺寸用例：9:16 三档素材、切集后 resize、页面网格高度变化、observer 清理及不裁字幕的目标模式。

运行：

pnpm --filter mini-web test
pnpm --filter mini-web build

### 7.2 后端测试

新增或补充：

- requiredCount=1、COMPLETED、ALLOW 默认策略。
- 相同 launchId 返回同一 active session。
- shown 重复确认幂等。
- shown 错误序号返回冲突。
- complete 重复确认幂等。
- 过期 session 被拒绝。
- Serializable 冲突有限重试。
- launch-context 写入失败不影响匿名登录。
- home 返回 server-timing。
- CORS 允许来源 OPTIONS 204，拒绝来源不泄漏配置。
- 新版 HeartReel 入口曝光不新增 `AppEntryAdSession`、`AppEntryAdCompletion` 或入口 `AdEvent` 行；匿名会话和首页仍正常运行。
- 旧包/其他 Mini 的入口 API 测试继续通过，旧入口会话不会因新版前端发布被删除或错解。
- 剧集解锁继续用服务端单 `placementId`；该实际位的 SHOWN、complete、幂等重试和 `EpisodeUnlock.placementId` 原逻辑保持通过，入口 A/B 不会进入剧集解锁 API。
- `/play` 新增可选宽高时，旧客户端可忽略；缺失/无效宽高不影响播放凭证和 VePlayer 初始化。
- `/runtime-errors` 新字段白名单、脱敏、长度限制、全局限流和管理后台按 `releaseId/phase/errorCode` 聚合；重复事件不按每次重试新增一行。
- `/shown` 同一 `adIndex/clientEventId` 并发和重试保持幂等；API 压测期间记录 route、P2028、连接池等待和数据库锁，不仅检查响应成功。

运行：

pnpm --filter api test
pnpm --filter api build
pnpm --filter api exec prisma validate

### 7.3 真机矩阵

| 平台 | 客户端 | 环境 | 必须记录 |
|---|---|---|---|
| Android | 普通 TikTok >= 44.2.0 | Preview | 11002、11006、50008/50009、启动时间 |
| Android | 普通 TikTok >= 44.2.0 | Release | 完播、提前关闭、连续一次展示 |
| Android | TikTok Pro | Preview/Release | 作为不支持环境单独统计 |
| iOS | 普通 TikTok >= 44.2.0 | Preview | 11002、11006；区分 50008 和 50009 |
| iOS | 普通 TikTok >= 44.2.0 | Release | 入口本地完播/提前关闭、剧集解锁奖励 |

每个平台组合至少做 10 次启动和 10 次广告展示。记录设备、系统、TikTok 版本、Mini release ID、网络、Origin、placement、原始 SDK 错误、requestId。

入口双位额外矩阵：A/B 各至少 20 次真实展示，覆盖完播、提前关闭、无填充、弱网、启动快速重入、应用切后台；确认顺序按策略轮换、故障有界 fallback，且业务 API/数据库中没有逐次入口 SHOWN/complete 写入。并确认剧集广告仍只使用后端配置 ID，并记录原来的 SHOWN/complete。播放器额外用实际三档 9:16 `vid`，在不同宽高比手机和 iOS/Android Preview、Release 中比对截图；逐集记录 root rect、媒体 rect、视频内在尺寸与裁切范围，确认片头片尾/字幕安全区。测试包自带 MP4 只能作为界面对照，不能替代已审核 VePlayer 剧集。

## 8. 灰度发布顺序

### 阶段 1：服务端

1. 备份数据库和当前广告策略。
2. 先核实 API/Worker 当前镜像；按用户确认，2026-10-29 CPU 遥测优化版已经部署，不要重复发布旧 `c4013b6`。入口策略当时仍启用且哈希未变。
3. 采集 CPU、路由 QPS、seq scan、写入量、P2028/5xx 基线；只在新一轮错误复发时按 requestId 定位具体 route。不要为了 CPU 无差别关闭 HeartReel/SweetReel 或其他 Mini 的入口策略。
4. 若旧版 HeartReel 仍被 10 次入口门禁卡住，按 release 定向关闭旧策略；新版改为本地一次 best-effort 入口尝试。
5. 确认 `/ready`、`/home`、anonymous session、`/auth/launch-context`、剧集解锁及旧包兼容接口正常；入口双位本身不需要 API/数据库迁移。
6. 如采用静态 CDN 开关，先部署 `enabled=false` 的文件并验证缓存和故障关闭；静态开关不可成为启动等待依赖。

### 阶段 2：前端修复包

1. 固定 VITE_MINI_RELEASE_ID。
2. 发布 load gate、show coordinator、50008/50009/11002 分类、错误去重、入口本地 A/B 轮换及播放尺寸修复。
3. 确认新版 HeartReel 入口流程不发入口 session/shown/complete/入口 AdEvent 请求；`/auth/launch-context` 的共享 IP、归因和豁免仍有效；剧集解锁 API 链未改变。
4. 在 Preview 做 Android/iOS 真机矩阵；广告 ID 初始只启用 A，B 先在 Portal 确认后再上包。
5. 用脚本/受控流量确认相同启动中的重复 `ENTRY_GATE_SLOW`、广告错误诊断已合并，严重错误的首条原始字段仍可查。

### 阶段 3：恢复广告

1. 新版以静态/构建入口广告开关关闭开始，先验证首页不等广告且可正常启动；旧后端入口策略按旧 release 现状保留或单独止血。
2. 通过双位真机展示验证后，静态开关先对少量 Preview/Release 流量启用；每次入口最多一支，在多次启动间 A/B 轮换，不做入口门禁，不连播多支。
3. 观察至少 15 分钟并按相同流量窗口对照：广告准备耗时、show 成功率、11006/11002/50008/50009/无填充率、启动放行时间、各路由 QPS、P2028、API/DB CPU、数据库写入量和连接池等待。
4. P2028/5xx、共享 IP/归因/豁免或剧集奖励校验异常时暂停扩量；纯入口广告故障先关闭静态入口广告开关。
5. 指标稳定再扩大流量；入口策略对旧 release 是否启用单独记录，不得将它与新版本地广告开关混为一个状态。
6. 剧集解锁的 requiredCount、placementId 与完播校验完全按后端配置原状运行。

## 9. 验收阈值

修复包必须达到：

- 连续 100 次入口流程无未处理的并发 show 错误。
- 11006 被分类、退避和有界处理。
- 50008/50009 不阻塞首页。
- 首页渲染和主导航不等待广告；入口广告尝试 P95 < 10 秒并按预算结束。
- 匿名会话成功率 >= 99.5%。
- /home 成功率 >= 99.5%，P95 < 2 秒。
- API 5xx < 0.5%。
- CPU 优化版部署后连续至少 15 分钟无 P2028/5xx；如再次出现，能按 requestId 归属到 route 和等待阶段。
- 同流量窗口主机 CPU 不持续超过 85%，API 通常不持续超过 1 核，且无 CPU throttling/连接池排队；若自然高峰超过目标，应在相同流量窗口评估缓存、并发控制或扩容，不能以单次采样宣称达标。
- `/runtime-errors` 重复事件写入量下降，且 11002/11006/50008/50009 首次样本及码文不一致仍可检索。
- CORS 预检成功率 >= 99.9%。
- 无填充时不无限创建实例或补池。
- isEnded !== true 不产生奖励和完成计数。
- 新版入口 A/B 按本地策略轮换且不调用入口 session/shown/complete API，不新增入口逐次数据库写入；故障、静态开关不可用或无填充时能有限结束并放行。
- 剧集解锁仍使用后端配置的单广告位，完播与事件记录一致；入口 B 不会影响解锁。
- 三档真实竖屏视频在目标视觉模式下比例正确、无拉伸；切集、旋转、页面高度变化后布局稳定，播放凭证接口与官方 VePlayer 保持有效。

性能验收先记录上线前后同时间窗口、同流量结构的 `/app-entry-ad-sessions`、入口 `/shown`、入口 `/complete`、入口 `/ad-events`、`/runtime-errors` 和 `/home` QPS/延迟与数据库查询/写入量，再比较 API/PG/PgBouncer CPU、PG 活跃/等待连接、P2028、CPU throttling、启动 P95。新版入口会话/逐次曝光请求应接近 0；总体 CPU 降幅要在相同流量和同一时间窗口实测，因为匿名会话、`/auth/launch-context`、`/home` 和其他 Mini 的流量仍存在。单独采集 TikTok 广告 `show` 成功率与准备耗时，避免把服务端变轻误判为广告加载变快。

## 10. 监控和告警

前端聚合维度：

- appKey、releaseId、platform、TikTokVersion、osVersion
- adType、placementIdHash、adIndex、phase
- errorCode、subErrorCode、visibilityState
- sdkInitialized、showLockOwner、durationMs、requestId

后端聚合维度：

- route、statusCode、requestId、miniAppKey、releaseId
- databaseDurationMs、applicationDurationMs
- origin、corsAllowed
- route QPS、P50/P95/P99、P2028 分类数、Prisma pool wait、PG lock/wait、PgBouncer queue
- API/PG/PgBouncer CPU 核数、容器重启与 throttling、数据库读写增量
- runtime-errors 原始错误码与 message mismatch 计数、按 app/release/phase 聚合的重复数

新版入口广告聚合优先通过 TikTok 广告后台汇总或低频前端诊断/采样日志统计；不为每个入口曝光调用 `/runtime-errors`。本地记录仅用于当前会话排障，不能作为财务结算或用户权益账本。

告警：

- 11006 在 5 分钟内同 release 超过 1%。
- 11002 在 5 分钟内同 release 超过 1%，或同实例代次重复出现。
- 50008/50009 分开统计；任一在 5 分钟内同版本超过 5% 时按平台、可见状态和广告类型排查。
- anonymous session 或 home 成功率低于 99%。
- home P95 超过 2 秒。
- CPU 优化版部署后再次出现 P2028/5xx 时按 route、requestId 检查，不使用早期 `c4013b6` 阶段计数作为当前告警值。
- 主机 CPU >85% 持续 5 分钟告警，>90% 持续 5 分钟升级；同时检查 API、PG、PgBouncer、网站容器、Mini QPS、连接池等待和 PG 锁，不单独依 CPU 自动重启容器。
- `/runtime-errors` 写入速率连续 5 分钟超过基线 2 倍，或 ENTRY_GATE_SLOW 在单一 release 激增。
- 同广告位连续失败达到 4 次，停止补池并检查 Portal。
- HeartReel 入口静态开关关闭后仍观测到新版入口展示时，检查 CDN 缓存、releaseId 与旧包残留。

## 11. 回滚

### 后端回滚

1. 功能回归或 5xx 明显增加时，将 API/Worker 恢复到 CPU 优化文档记录的旧镜像并验证 `/ready` 和所有 Mini 的关键 API；CPU 仍高但 5xx/P2028 受控时，先定位剩余路由及同机网站负载，不自动回滚 CPU 优化版。
2. 入口广告造成旧客户端无法启动时，可关闭对应 release 的入口策略；纯 CPU 告警不默认关闭所有入口广告策略。
3. 关闭静态 CDN 入口广告开关；新版前端在开关不可用时也必须放行。
4. 保留旧 `/app-entry-ad-sessions`、`/shown` 和 `/complete` 路由及数据库，不删除旧包兼容字段。
5. 不直接删除迁移字段和生产 session 数据；记录策略、镜像、前端 release、静态开关版本及回滚前后指标。

### 前端回滚

1. 发布平台切回上一稳定包。
2. 复核目标 release 的服务端入口策略；只在旧版门禁本身引发启动故障时设为 disabled/ALLOW。
3. 新版静态开关维持关闭，旧包/其他 Mini 的策略按各自 release 恢复。
4. 不通过删除广告位或清空数据库表回滚。

## 12. 完成定义

同时满足以下条件才算完成：

1. 同一 adUnitId load 串行。
2. 所有 show 全局串行，实例只 show 一次。
3. 11006 被退避和有限处理。
4. 50008/50009 不阻塞首页，并有完整原始字段。
5. 真实 Mini Origin 通过 Portal、CORS 和代理验证。
6. anonymous session、home 达到延迟和成功率阈值。
7. 启动不再强制连续 10 条广告。
8. isEnded !== true 永不产生奖励。
9. Preview 和 Release 真机矩阵有可追溯记录。
10. 回滚路径已演练。
11. HeartReel 新版入口 A/B ID 从前端包读取，不请求入口 ID/会话接口，不写逐次入口曝光和完播行；剧集解锁仍由后端记录并验证实际配置位。
12. `1080x1920`、`720x1280`、`540x960` 三档已用真实 VePlayer 通过 Android/iOS 画面与切集验收。
13. 当前 CPU 优化版已至少连续观察 15 分钟并在高峰窗口复测；P2028/5xx 受控，整机/API/数据库 CPU、连接池等待和大表扫描达到阈值。若持续高于目标，整体 CPU 治理仍未完成。

## 13. 2026-10-29 StoryFlicks 官方本地调试实测记录

本节记录开发环境的连接结果，不作为广告、播放器、服务端 CPU 或发布版功能通过验收的证明。

### 13.1 已核实的结果

| 检查项 | 实际结果 | 可作出的判断 |
| --- | --- | --- |
| 手机访问电脑业务页 `http://10.184.139.101:5193/` | 用户确认能打开 | 当时手机到电脑的业务 HTTP 端口可达。 |
| 手机访问 `http://10.184.139.101:3000/check?v=2` | 手机截图显示 HTTP 已连通、WebSocket 4004 成功；CLI 也记录诊断探测通过 | 当时手机到电脑的调试 HTTP 与 WebSocket 端口可达；仅证明网络通道。 |
| 当前调试工具 | 按用户提供的指南启动 `tiktok-minis-cli@0.0.7` 的 `minis dev` | 不混用此前 `ttdx minis debug` 的二维码或调试协议。 |
| 当前二维码参数 | `/api/env` 核对 Client Key 非空，`host_list` 为当前热点地址 `10.184.139.101`，WebSocket 端口为 `4004` | 当前二维码未使用旧有线地址或 WSL 虚拟网卡地址。 |
| TikTok 原生调试握手 | CLI 尚未记录 `Phone connected`；出现过来自手机地址的 WebSocket upgrade 请求，但未确认其来源或有效原生握手 | 不把网页连接、端口探测或 upgrade 尝试当成原生客户端已连接。 |
| 手机外网访问 | 用户确认 TikTok 视频可播放，但浏览器打开 `https://www.tiktok.com/` 仍失败，重新扫码也失败 | 外网网页访问仍有待排查；不能据此单独认定扫码失败的唯一原因。 |
| 手机客户端身份 | 用户先澄清此前使用普通 TikTok；随后反馈已安装 `T-7718a1`，但新客户端在 TikTok 首页或登录页就显示“无网络” | 客户端类型已按用户反馈更正；当前先排查测试客户端自身访问 TikTok 服务的问题，尚未进入 StoryFlicks 调试。 |

辅助检测页 `/check`、`/_minis_network_check`、`/__minis_network_check` 均属于电脑本地排障工具；官方 DevTool 二维码仍在 `http://localhost:3000/`。这些辅助检测逻辑不进入小程序发布包。

### 13.2 客户端要求与后续操作

官方 [Develop Your Mini Drama](https://developers.tiktok.com/docs/en/tiktok-minis-develop-your-mini-app) 明确要求：Android 本地调试使用 TikTok 测试客户端，通过 TikTok 运营联系人或支持工单获取。普通 TikTok 客户端不能作为 `minis dev` 原生调试连接验收环境。已经加入 Test Users 与使用正确的测试客户端是两个独立条件，必须同时满足。

用户提供的《TikTok Minis 开发调试指南》列出 `M-7718a1-googleplay-release.apk` 和 `T-7718a1-googleplay-release.apk`；其中举例 M 包对应 US 等账号地区、T 包对应 JP 等账号地区。应按照官方发包说明和实际账号地区选择，不能只凭界面语言或 `v44.2.3` 这样的版本号判断。当前 DOCX 仅包含这些附件名称，未包含 APK 安装包本体；以官方联系人实际提供的兼容测试构建为准，不从非官方来源下载。

执行顺序：

1. 获取并安装官方 Minis Android 测试客户端，按官方说明选择适合账号地区的构建；登录已经加入 StoryFlicks Test Users 的账号。
2. 保持手机与电脑处于已验证的热点网络。若切换网络，先重新读取电脑实际 IPv4 地址并更新 CLI 广播地址；不要继续扫描含旧 IP 的二维码。
3. 通过能正常访问 TikTok 服务的网络连接外网。VPN 不是官方强制要求；如使用代理，保留局域网直连，并按指南尽量保持代理与账号地区一致。手机普通浏览器能打开 TikTok 网页也不替代测试客户端要求。
4. 电脑保留 `http://localhost:3000/` 官方二维码页，用测试客户端的应用内扫码入口扫描，并保持 TikTok 在前台。
5. 以 CLI 出现 `Phone connected`、官方调试页确认客户端连接及原生 JSAPI 调用结果作为连接验收。指南说明本地调试的业务页面主要运行在电脑，手机展示原生 JSAPI 对应界面，不能只凭手机没有完整首页判定连接失败。
6. 若正确测试客户端仍无法连接，记录具体 APK 构建名、账号地区、扫码时间、最新错误页和 CLI 握手日志，再按官方 [Debug Your Mini Drama](https://developers.tiktok.com/docs/en/debug-your-mini-app) 使用 Network Diagnostics，根据手机原生加载界面提供的真实参数手动连接；不猜测手机 HTTP/WS 端口。
7. 连接成功后，继续验收登录、入口 A/B 广告、剧集解锁、完播确认和三档真实竖屏视频。发布环境仍需按第 7.3 节在 Preview/Release 完成真机矩阵；本地连接成功不等于发布版验收通过。

### 13.3 错误归属和验收边界

- 此前确认存在“使用普通客户端进行 Android 本地调试”的环境问题。用户随后安装 `T-7718a1`，但其首页或登录页仍显示“无网络”；这个新现象发生在进入 Mini 之前，尚无证据将其归因于广告状态机、播放器或业务后端 API。
- 先前出现的 `301`、`206 ClientKey:null` 和网页 `net::ERR_INVALID_RESPONSE` 保留为实测现象；当前查阅的官方 Mini Drama 文档没有给出前两个错误码的权威映射，不能把更换客户端描述为已证明能解决所有历史错误。
- 手机到电脑端口连通已经通过；更换正确测试客户端后，只在出现新证据时重新检查防火墙或端口，不重复修改已验证的网络配置。
- 广告 `11002`、`11006`、`50008` 等的真实 SDK 复现、广告收益与奖励正确性、VePlayer 三档视频、启动性能及服务器 CPU 改善效果，仍需各自独立实测，不因浏览器能打开页面而标记通过。

### 13.4 更换 T-7718a1 后的网络排查

用户确认新测试客户端在 TikTok 首页或登录页就显示“无网络”，不是扫码后才发生。因此，先恢复测试客户端登录和首页访问，再继续扫码验收，不修改 StoryFlicks 业务 API 或广告状态机来处理此提示。

此时电脑复查结果：WLAN 仍为 `10.184.139.101`，3000/4004/5193 均在监听，二维码仍广播此热点地址且 Client Key 非空；CLI 尚未记录有效手机握手。电脑命令行通过当前网络访问 `https://www.tiktok.com/` 的一次请求在约 5 秒连接阶段超时，而访问 `https://connect.tiktok-minis.com/drama/sdk.js` 返回 200。此结果只反映电脑当时的请求路径，不能替代手机测试，也不能证明所有 TikTok 域名或整个外网均不可达。

后续必须确认测试手机当前是否启用代理、代理是否覆盖 TikTok 测试客户端，以及出口地区与账号地区是否符合官方发包说明。若需要代理才能访问 TikTok，应保留局域网地址直连，避免影响此前已通过的手机到电脑通道。不能仅凭 T 包文件名或“无网络”提示认定具体地区、SIM、账号或后端为唯一原因，也不因 T 包失败就直接改用 M 包。恢复测试客户端首页访问后，再扫描当前官方二维码并检查原生握手。

用户随后确认账号为日区，截图显示选中“日本-IEPL 01”，测速约 81ms；另一张截图仍为 TikTok 首页“无网络连接”。日区账号与指南对 T 包的举例相符。节点名称和测速结果不能证明代理已连接、实际出口地区或 TikTok 测试版请求已进入代理；优先检查分应用代理是否覆盖新安装的测试客户端。下一次对照测试只调整手机代理覆盖范围：确认代理已连接，临时让所有应用走代理且保留绕过局域网，关闭并重新打开测试版，再分别记录 TikTok 首页与手机浏览器访问 `www.tiktok.com` 的结果。若两者都失败，优先检查代理连接/出口及其网络链路；若网页成功而测试版失败，再检查该 APK 的路由覆盖、构建适用性和 TikTok 服务请求，不能宣称仅切换代理必然修复。

随后用户反馈 VPN 开启后浏览器可以访问 TikTok，而测试版首页仍无网络。用户复制的完整地址为 `https://www.tiktok.com/foryou`，域名属于 TikTok；但所附截图正文出现“Day”“极速播”及影视资源免责声明，页面内容异常的原因仍未确认，不直接断言 DNS 劫持、代理故障或具体重定向原因。浏览器这一请求也不足以验证原生测试版登录接口可达。首页视频流加载成功不是本方案新增的强制调试门槛，但用户随后明确表示测试版无法登录，也无法使用扫码入口；目前因此无法执行手机原生连接验收。此轮 CLI 仍未记录 `Phone connected`。

### 13.5 测试版无法登录时的处理路径

当前阻断点是 TikTok 测试客户端的账号登录，发生在加载 StoryFlicks 之前。`TTMinis.login()` 是进入 Mini 后的授权接口，与登录 TikTok 客户端本身是不同阶段。修改 Mini 的 Client Key、业务授权 API、广告位或后端数据库不能据此作为当前登录提示的修复措施。

用户已完成同条件对照：同一手机、同一日本 VPN、同一日区账号下，普通版可以登录，只有 `T-7718a1` 在登录页提示无网络或持续加载。排查优先级收敛到测试客户端的联网权限、实际代理出站规则、测试构建及其服务请求路径。对照结果不证明账号在所有客户端都不存在限制，也不证明该构建已经失效；不再重复要求用户完成此对照。

后续按已确认结果执行：

| 对照结果 | 下一步 |
| --- | --- |
| 普通版成功，T 测试版失败 | 优先核查测试版的代理覆盖、手机联网权限及当前构建适用性；向官方联系人确认 `T-7718a1` 是否仍为可用构建并获取适合日区账号的当前测试包。此结果仍不能单独证明旧包失效。 |
| 两者都失败 | 先处理共同网络或账号登录问题；通过 TikTok 官方支持按具体错误定位，不直接认定账号被风控，也不因“无网络”要求重置密码。 |
| 普通版已卸载，无法对照 | 保留现有环境，提供 T 包准确登录提示给官方联系人，确认当前可用测试构建及需要的脱敏诊断信息；不反复卸载、清空账号数据或切换多个配置来制造新变量。 |

针对已命中的第一种结果，先检查系统设置中测试版 TikTok 的 WLAN/移动数据联网权限，再在代理连接日志中观察打开测试版登录页时是否产生请求、实际使用 DIRECT 还是代理、是否出现 DNS/连接超时/TLS 等错误。应用纳入 VPN 与其所有目标请求最终经过代理并非同一条件，路由规则仍可能选择直连。必要时做一次“所有应用覆盖 + 默认出站走日本代理 + 局域网直连”的临时对照。若仍失败，携带对照结果和脱敏错误摘要向官方获取当前可用的日区 T 测试构建。当前公开检索未找到 `T-7718a1` 的失效公告、替代版本或登录故障说明，不能虚构新版本号或下载地址。

指南 FAQ 把网络、设备或账号限制列为可能原因，未提供当前手机的服务端诊断，因此不能宣称已经确认设备或账号受限，更不能直接要求更换手机或账号。

可复制给官方联系人核对的描述如下（仅准备文本，未发送）：

> Android Mini Drama 本地调试，使用指南列出的 T-7718a1，TikTok 账号为日区。同一手机、同一日本 VPN、同一账号下，普通 TikTok 可以登录，只有 T-7718a1 在登录页提示无网络或一直加载，因此无法使用应用内扫码。电脑与手机局域网 HTTP/WebSocket 探测已通过，minis dev 使用 tiktok-minis-cli@0.0.7，尚无原生手机握手。请确认此 T 构建目前是否仍可用、是否需要更新的日区测试包、是否有测试版专用登录条件，以及需要提供哪些脱敏登录诊断信息。

### 13.6 已连接后的真实扫码验收（2026-10-29）

本轮新结果取代 13.1—13.5 中“尚无手机握手、无法进入 StoryFlicks”的当前状态判断；前文作为排查历史保留。CLI 已记录 `Phone connected (debug channel ready)`，官方 DevTool 持续收到手机原生 JSAPI 返回，真实首页已显示 19 部剧。开发服务、官方调试服务和 WebSocket 端口均在监听。

详细步骤、证据、错误归属和复测矩阵见 [StoryFlicks 官方本地扫码验收记录](./20261029-storyflicks-local-acceptance.md)。本次验收使用当前开发源码和生产 API 开发代理，不是此前五个发布 ZIP 的完整验收。

| 发现 | 归属与处理 |
| --- | --- |
| 启动 API 200 回包只有 `saved`，缺少 `entryAdEligibility` | 当前 API 合约阻断；前端按缺资格跳过入口广告。核对实际运行 API 版本及 Mini/release 策略，不删除豁免检查或伪造允许字段。 |
| 激励与插屏初始化返回 `101120000 / subErrorCode:20001`，原文为广告位校验网络失败 | 优先调查手机原生广告服务请求。官方通用表未直接列出这个完整组合，不能仅凭副码认定广告位不存在。 |
| 约 8 分半内有 10 次相同插屏创建失败 | 源码定时插屏每次失败后约 60 秒再试；失败不计入成功展示上限，播放页长时间活跃可能持续初始化并按诊断限流再次上报。修复会话内失败上限/退避并补测试；本轮未修改此代码，CPU 影响待实测。 |
| `getDramaInfo` 返回连接超时，页面显示 `Player playback failed.` | 原生 TikTok 剧集服务请求未成功；无真实首帧，三档视频和首帧/切集速度均未通过。 |
| 匿名会话中间检查曾返回 502，随后合约复查成功 | 保留 API 稳定性待查项，单次成功或失败都不作为生产成功率、CPU或数据库根因的证明。 |

本轮开发环境已将 StoryFlicks 的 API 请求改为仅在 Vite serve 时使用同源代理，恢复首页数据访问；生产构建继续使用发布环境 API。未部署生产后端、调整生产策略或上传 Portal。

本轮 `pnpm --filter mini-web test` 通过 65 项，TypeScript 检查通过；现有插屏测试没有覆盖连续创建失败后的调度上限，所以不能抵消本轮发现的无界重试风险。未重跑 API 测试或发布 ZIP 构建。

先限制插屏初始化失败时的会话内重试，再恢复手机原生广告/剧集目标服务连通性，同时让测试 API 返回真实新版资格；之后完成 load→show→close、跨启动 A/B 轮换、全局互斥、提前关闭、后端解锁、三档竖屏与性能矩阵。当前资格 Promise 的慢请求预算仍需验证，不能仅凭 10 秒 deadline 常量宣称所有入口路径达标。本轮没有成功 show 或首帧，整体验收未通过；历史单测、构建与 ZIP 校验结果不替代本轮真机验收。

# StoryFlicks 官方本地扫码验收记录（2026-10-29）

本轮结论：**调试连接与真实首页已通过；入口广告、插屏和剧集播放仍被阻断，整体未通过验收，暂不能据此发布。**

## 1. 验收对象与环境

- 对象：当前工作区 StoryFlicks 开发源码及共享 `mini-web` 代码，不是此前五个发布 ZIP 的逐包验收。
- 工具：官方 `tiktok-minis-cli@0.0.7` 的 `minis dev`；官方 DevTool 页面为 `http://localhost:3000/`。
- 本地业务服务：`http://localhost:5193/`，WebSocket 调试端口为 `4004`。收尾检查三个端口均在监听。
- API：Vite 开发代理 `/api/storyflicks/v1` 转发到现有生产业务 API；本轮未启动独立测试后端。
- 手机：用户扫码，CLI 已出现 `Phone connected (debug channel ready)`，DevTool 持续收到手机原生 JSAPI 返回。
- 当前原生请求附带的版本字段为 `46.4.3`；此前用户提到的 `44.2.3` 不能代表本轮构建。版本字段也不能单独证明 APK 的完整身份。
- 本地调试业务页面位于电脑 DevTool iframe，手机承载原生 JSAPI 对应界面。手机未显示完整首页不能单独作为连接失败依据；此运行方式也见用户提供的调试指南。

本轮时间以电脑日志 UTC 为准。手机与电脑时间存在偏移，不跨设备时间戳相减计算响应速度。

## 2. 验收结果矩阵

| 项目 | 状态 | 本轮证据与限制 |
| --- | --- | --- |
| 手机原生调试握手 | 通过 | CLI 连接成功，收到原生广告、授权和剧集调用回包。 |
| 本地业务服务与首页数据 | 通过本次检查 | 业务页和 `/home` 返回 200；DevTool 显示真实封面、标题及 19 部剧。未达到成功率或 P95 的统计样本要求。 |
| 本地开发 API 跨域问题 | 已恢复本次访问 | 开发时改用同源 Vite 代理，首页恢复。生产 Origin/CORS 仍须独立验收。 |
| `/auth/launch-context` 新版入口资格合约 | 未通过 | 200 回包仅有 `saved`，没有 `entryAdEligibility`。 |
| 入口激励广告原生初始化 | 阻断 | `minis.createRewardedVideoAd` 返回广告位校验网络错误。 |
| 插屏原生初始化 | 阻断 | `minis.createInterstitialAd` 返回相同错误。 |
| 入口自动 `load → show → close` | 未验证 | 资格字段缺失，且原生广告初始化失败；没有成功展示和关闭证据。 |
| A/B 展示后轮换、备用位回退 | 未验证 | 没有成功 show，不能把创建广告请求或代码存在当成轮换成功。 |
| 本次广告失败后可继续进入业务页 | 本次路径通过 | 能进入首页及剧集详情；不代表所有错误分支均已通过。 |
| 官方剧集播放器 | 未通过 | 第 1 集页面显示 `Player playback failed.`，`getDramaInfo` 原生请求超时。 |
| 首帧、切集、播放流畅度 | 未验证 | 没有成功首帧，无法评价性能。 |
| 三档真实竖屏视频适配 | 未验证 | `1080×1920`、`720×1280`、`540×960` 尚未在真实播放中验收；封面比例正确不替代视频验收。 |
| 剧集解锁、提前关闭、完播确认 | 未验证 | 未完成真实广告展示及播放链路。 |
| `11002`、`11006`、`50008`、`50009` 实机处理 | 未验证 | 本轮未获得这些码的原生复现；新的错误组合必须保留独立样本。 |
| 插屏失败重试上限 | 代码问题，需修复 | 最近 8 分 32 秒内观察到 10 次同类插屏创建失败；定时任务失败后每约 60 秒再次尝试，失败不占展示上限。 |
| 共享 IP、归因、豁免与逐次入口广告写入量 | 未完整验证 | 启动合约请求成功不证明数据库行为和各资格分支正确。 |
| 生产 CPU、数据库写入及连接池改善 | 未验证 | 未执行生产压测、15 分钟观察或数据库增量核对。 |
| 其余四个 Mini / iOS / 发布 ZIP | 未验证 | 本轮是 StoryFlicks Android 本地扫码记录。 |

## 3. 后端 API：入口自动广告的独立阻断

本轮通过正常匿名业务会话请求：

```text
POST /api/storyflicks/v1/auth/launch-context
localEntryAd: true
releaseId: default
launchScene: LOCAL_ACCEPTANCE
```

复核结果（2026-10-29 12:42:26 UTC）：

```json
{
  "sessionStatus": 200,
  "status": 200,
  "saved": true,
  "responseKeys": ["saved"],
  "entryAdEligibility": null
}
```

这里的 `null` 是检查器在字段缺失时记录的结果，实际回包没有该字段。证据见 [API 合约复查](../output/acceptance-20261029-storyflicks-local/api-contract-recheck.json)。其中 `durationMs:13046` 是匿名会话与启动合约串行检查的总耗时，不能当作单独 launch-context 延迟，更不能当作生产 P95。

前端当前实现会预热广告，再等待资格；缺少 `entryAdEligibility.showEntryAd` 时跳过入口展示，跳过原因为 `ELIGIBILITY_UNAVAILABLE`。因此，**即使手机广告服务网络恢复，当前回包仍不足以触发入口自动广告**。不能通过删除资格检查来绕过用户/IP 豁免或服务端策略。

本地源码有新版资格逻辑，不等于当前连接的生产服务已部署此实现。后续须核对实际运行版本、路由和请求参数；当前检查只能证明这次 API 回包缺失字段，尚未通过服务器源码/镜像核对确认其部署根因。

复测前满足以下条件：

1. 测试所连接的 API 实际返回新版资格字段。
2. 策略覆盖当前 Mini 与实际 release。本地未注入 release 时为 `default`；发布包使用准确 release ID，不能互相替代。
3. 依照现有后端规则配置策略启用、模式及可选归因要求，并确认测试用户/IP 没有被豁免。允许与拒绝均使用真实后端判断结果。
4. 共享 IP 访问记录、归因和豁免仍随启动 API 保留。仅入口广告逐次会话/展示/完播记录退出该链路；剧集解锁继续走后端。

一次中间复查的匿名会话请求曾返回 502；随后正常匿名会话与 launch-context 均成功。同期首页经代理和直连分别返回 200，耗时约 6.4 秒和 4.6 秒，仅是不同请求的单次观察。502 的根因尚未核实，不据此认定数据库、CPU或前端为唯一原因；该次失败后的无授权请求不计入有效资格合约样本。

## 4. 原生广告：失败发生在广告位校验阶段

捕获的实际字段：

```text
method: minis.createRewardedVideoAd / minis.createInterstitialAd
errorCode: 101120000
subErrorCode: 20001
errorMsg: [Server] Minis/adplacement/validate - request failed due to a network issue. Please check your network and try again.
```

本轮未得到成功 `load`、`show`、`onClose` 或完播结果。这个失败发生在原生广告初始化/校验阶段，尚不能归因于前端 show 并发、业务解锁 API 或广告未完播。

官方 [Mini Games Error Code Reference](https://developers.tiktok.com/docs/en/mini-games-error-code-reference) 将完整码 `101120000 / 101320000` 列在初始化网络校验错误项中；表中的 `20001` 则对应完整码 `101320001` 的广告位不存在。**该页没有直接列出本次 `101120000 + subErrorCode:20001` 的组合，也没有说明表中 Error code 等于本日志的 subErrorCode。** 不能单凭副码断言广告位不存在。这还是 Mini Games 通用资料，不能替代 Mini Drama 对该组合的精确说明。

目前按原始错误消息调查“原生广告位校验请求网络失败”。后续在手机侧确认请求目标、代理路由、DNS、连接/TLS 及响应；若网络正常仍报错，再核对广告位所属 Mini、激活状态、测试权限和当前测试构建，并向官方提交脱敏字段核对。不能承诺某项前端修改能消除所有 SDK/服务端错误。

日志中还有多个相隔一段时间的插屏创建失败回包；样本可能跨越重扫、页面行为或重试，尚未按启动分组，不据此判定同一启动无限重试。复测需按一次启动的尝试数、触发源和退避状态核对。

继续按本地电脑日志分组后，12:37:50—12:46:22 共观察到 10 次 `minis.createInterstitialAd` 返回同样的网络校验错误。这不是“已展示 10 次”：它们都是创建失败，没有成功 load/show 证据。源码中 `startEpisodeInterstitialSchedule` 在每次尝试结束后按 60 秒再次调度；创建/加载失败会被 `showInterstitial` 记录后转为 `undefined`，而 `shownCount` 仅在 `show()` Promise 接受后增加。因此失败不会触及 `maxPerSession`，播放页持续活跃时定时流程会反复创建实例。

这是可从源码与本轮调用序列共同确认的**无界定时重试风险**，与广告服务器网络错误是不同层次的问题。`reportDiagnostic` 对同一键仅压制 30 秒内重复值，定时失败约隔一分钟时仍可能再次请求 `/runtime-errors`，并受每分钟 10 条的本地上限约束。由此会增加 SDK 初始化与诊断请求；对生产数据库写入量或 CPU 的实际影响本轮没有测量，不能称其为 CPU 异常的已证根因。

应修复失败调度：设置明确的连续失败上限与退避，达到上限后在当前播放会话停止自动创建，页面可继续播放；用户主动触发或下个剧集会话可重新启用。成功 show 后才重置连续失败计数。对入口广告的 A/B 回退策略保持独立，不把插屏失败逻辑混入入口位切换。加入测试验证失败次数上限、成功后的重置和页面卸载取消定时器；此修复未包含在本轮代码改动中，也尚未由真机复测。

## 5. 播放器：TikTok 原生剧集服务超时

已进入真实剧目第 1 集，页面从准备播放器变为 `Player playback failed.`，提供 Retry。相关原生回包：

```text
method: minis.getDramaInfo
errorCode: -1
subErrorCode: 0
net::ERR_CONNECTION_TIMED_OUT / net::ERR_TTNET_APP_TIMED_OUT
net_error: -118 / -199
```

原生日志目标主机包括 `api-h2.tiktokv.com`、`api22-normal-c-alisg.tiktokv.com`；失败路径包括 `/openplatform/governance/mini_drama/review_info`。原始请求含设备与会话参数，未写入本报告或脱敏附件。

部分日志显示约 31.7 秒的连接等待且 TLS 未完成。这支持优先调查手机原生服务连通性，不能单独证明 DNS 污染、账号限制、地区不符或 SDK 缺陷。电脑 Vite 代理成功、手机能打开本地网页或浏览器能访问 TikTok，均不能证明手机原生请求的目标服务可达。

`getDramaInfo` 多次调用可能涉及预加载、重试或页面切换，需按调用来源进一步归组；目前不直接认定为前端重复请求缺陷。另有 `TTMinis.login` 失败与 SDK 内 `TypeError: e is not a function` 的观察，作为独立待查项，不作为全部故障的统一根因。

![官方 DevTool 中的第 1 集播放失败](../output/acceptance-20261029-storyflicks-local/player-failed.jpg)

## 6. 已完成的开发环境调整

`apps/storyflicks/vite.config.ts` 在 `command === 'serve'` 时使用同源 API 路径并启用 HTTPS 上游代理，首页恢复；生产 build 继续使用发布环境 API。此前加入的入口 A/B 配置注入已保留。

本轮结束时执行 `pnpm --filter mini-web test`：65 项测试通过、0 失败，随后 `tsc --noEmit -p tsconfig.app.json` 通过。现有插屏测试覆盖跳过、频率竞争、关闭和错误放行，但没有覆盖 `startEpisodeInterstitialSchedule` 在连续创建失败后停止重试；上述实测无界重试未被当前测试发现。本轮未重跑 API 测试、StoryFlicks release 构建或 ZIP 校验。此前交付中提到的前端 64 项、API 222 项属于历史结果，不能作为本次扫码验收的新增通过记录。本轮没有部署生产 API、修改生产策略或上传 Portal。

## 7. 后续可执行复测顺序

### 7.1 先恢复两条独立依赖

1. 保留当前电脑到手机的正常连接。出现断连或换网时才检查热点地址和端口；网络错误未解决时反复扫码不能验证广告状态机。
2. 手机侧打开代理连接日志，在一次触发广告、一次点击播放后，观察实际 TikTok 目标主机、DIRECT/代理出站、DNS、连接和 TLS 结果。保留局域网直连。需要排查的是原生请求路径，浏览器访问网页不作为替代证据。
3. 使用支持新版资格字段的测试 API。可在独立测试数据库上运行当前后端，配置测试 Mini、剧目与入口策略，再将本地代理指向测试 API；也可在后续生产部署任务中完成 API 版本核对与升级。本轮没有自动执行生产部署。
4. 测试后端接入真实 TikTok 能力仍受手机、广告位及平台权限约束。返回固定 `showEntryAd:true` 的 mock 只能测前端分支，不能作为真实资格或原生展示验收。
5. 核对资格响应允许展示后再开始一次新的入口流程；资格已在当前页面缓存时，普通路由切换不能替代完整重启测试。

### 7.2 入口双位验收

| 场景 | 操作 | 通过条件 |
| --- | --- | --- |
| 正常自动弹出 | 保持 TikTok 前台，重新启动业务页，记录资格及 SDK 生命周期 | 首页不等广告；资格允许；先 load ready，再 show accepted；一次入口最多成功展示一支。 |
| A/B 跨启动轮换 | 第一次成功展示并关闭后，再完整启动一次；保留本地存储 | 第二次使用另一入口位；仅在 SDK 接受展示后推进位置。失败创建/加载不算成功轮换。 |
| 有限失败回退 | 在独立测试环境对首选位做可控失败，另保留真实有效位 | 尝试数量与退避符合状态机，失败不阻塞首页，不形成连播或无限补池。真实网络行为另行记录。 |
| 无资格/豁免 | 使用后端策略拒绝、豁免用户/IP等测试样本 | 不 show；记录明确理由；共享 IP 与归因仍按规则处理。 |
| 页面隐藏/其他广告占用 | 在加载中切后台，或测试解锁/插屏同时触发 | 不在后台强行 show；同一时刻至多一个原生广告展示；恢复后无过期展示。 |
| 提前关闭 | 广告可关闭时提前关闭 | 入口不发奖励、不创建入口 shown/complete 会话请求；可继续首页。 |

当前代码为一次入口最多两位尝试、单次 load 最多 6 秒，展示准备 deadline 从流程开始按 10 秒计算。资格 Promise 当前直接等待，尚需验证慢资格请求时的整体预算，不能只凭 deadline 常量宣称所有启动路径均在 10 秒结束。该预算也不是强制在 10 秒内关闭正在播放的广告。

### 7.3 播放与解锁验收

1. 先确认 `getDramaInfo` 成功并出现真实首帧，再分别播放三档真实竖屏视频；固定 9:16 外壳，检查无拉伸、意外裁切和切集后尺寸残留。
2. 连续切换至少 10 集，记录业务接口、原生剧集信息、播放器准备及首帧各阶段耗时，并检查旧实例销毁、声音重叠与过期回包。
3. 到达锁定集后确认采用后端配置的解锁广告位，完成 session、shown、complete 和权益刷新；入口 A/B 位不得替代解锁配置。
4. 分别测试完整观看、提前关闭、重复回调、请求失败后重试；只有后端验证有效完播才解锁，重复回调不重复发放权益。
5. 插屏恢复初始化后再检查展示时机、与入口/解锁全局互斥及失败放行。

### 7.4 性能、错误与发布门槛

- 同一时钟记录启动、首页可交互、资格、load、show accepted、播放首帧、切集首帧；分别报告样本量、P50/P95和失败率。禁止把两端日志时间相减。
- 对 `11002/11006/50008/50009` 做有明确结果的错误分支测试；注入测试与原生真实复现分开记录。保留 `errorCode/subErrorCode/message/phase`，验证去重、退避及重试上限。
- 生产 CPU 与数据库验收按总方案执行相同流量窗口对照和至少 15 分钟观察；正常启动 API 仍会读写，不要求全站数据库写入为零。本轮合约检查也会产生正常匿名会话和启动记录，没有执行压力流量。
- 插屏定时任务必须先修复无界失败重试并通过有界重试测试，再对多播放会话观察原生创建次数与 `/runtime-errors` 写入量；本轮重复样本不用于估算生产 CPU。
- 完成本地真实链路后，再对准确 release ID 与 ZIP 在 Preview/Release 复测；五个 Mini 的广告位、策略与真机状态逐个留证。

## 8. 证据索引与参考资料

- [脱敏原生错误样本](../output/acceptance-20261029-storyflicks-local/native-errors.sanitized.json)：保留方法、回调 ID、电脑时间和原始错误码/消息中的安全摘要；未保存设备标识和完整 URL。
- [API 合约复查](../output/acceptance-20261029-storyflicks-local/api-contract-recheck.json)：成功请求仍缺少资格字段。
- [播放失败截图](../output/acceptance-20261029-storyflicks-local/player-failed.jpg)。
- [统一修复执行方案](./HeartReel-广告与启动异常修复执行方案.md)：本轮结果见 13.6。
- 官方 [Debug Your Mini Drama](https://developers.tiktok.com/docs/en/debug-your-mini-app)：同一 Wi-Fi、设备外网可达、测试用户及调试连接要求。
- 官方 [Mini Games Error Code Reference](https://developers.tiktok.com/docs/en/mini-games-error-code-reference)：仅作相关初始化完整码的参考，不宣称覆盖本次 Mini Drama 副码组合。

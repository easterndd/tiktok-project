# StoryLand 登录、入口归因与广告体验优化方案

> 2026-10-20 初稿：需求分析与技术方案；初稿阶段未修改产品代码、数据库、后台配置或生产服务。用户提供的 DOCX、参考 ZIP、截图和项目现状文档只作为分析材料。

> 实施更新（2026-10-20）：原先的“未修改产品代码”只描述本方案初稿。当前工作树已经接入切集插屏的可选配置与前端调度；服务器和 Portal 广告位仍未配置，也没有发布。本文其他“当前”描述可能对应初稿时点。

## 需求澄清（用户于 2026-10-20 确认）

用户最新澄清：只需让**自己及明确授权的开发/测试账号**在日常预览中跳过入场广告，以便测试；普通用户继续按正常配置访问。这不是识别 TikTok 审核人员的需求。截图显示 StoryLand 的 Developer Portal「Roles and access > Test accounts」中有一个具备「Debugging & testing」权限的账号；这证明该账号可用于调试/预览，不证明 `TTMinis.login()` 会返回「开发者」标志，也不证明业务后台能读取 Portal 的测试账号名单。方案采用开发者自行登记、核验并可撤销的个人测试豁免，不通过未知 IP/UID 猜测平台人员身份。

## 一、结论与边界

用户描述的理想状态是：投放来源用户打开小程序时，先连续观看后台指定次数的激励广告；完整播放模式仅在看完后计数，不完整播放模式在展示后关闭也计数；达标才进入首页。随后在锁集处用激励广告解锁，并在上下集切换时使用插屏。这个状态**当前没有完整实现**。

上述强制连续激励是**需求记录，尚非上线建议**。按 [官方激励广告指南](https://developers.tiktok.com/docs/en/tiktok-minis-in-app-ads) 的奖励语义，提前关闭不能视为获得奖励；[官方插屏指南](https://developers.tiktok.com/docs/en/tiktok-minis-in-app-ads-interstitial-ads) 建议在章节/页面过渡展示，不建议打开 Mini 或剧集时立即触发，也不建议高频连弹。落地页必须可用，质量信号可能影响审核和投放表现；参考包的实现不能证明规则获平台认可。[TikTok 落地页政策](https://ads.tiktok.com/resources/help/article/tiktok-ads-policy-ad-format-and-functionality)。因此入场 N 次激励需要先做政策确认及真实用户可用性评估，尤其是 N 次均未看完却仍可进入首页的「SHOWN」模式。

推荐可上线的目标体验：所有入口都能立即看到有效首页和免费内容；锁集时用户主动选择「看完广告解锁」，只在完整播放后解锁；自然切集节点可显示频控插屏，关闭/失败后继续播放。来源按证据分类；开发者个人测试豁免只作用于入场广告，锁集激励仍可按真实业务流程测试，后台可单独提供广告模拟测试模式。

## 二、现状与参考包差异

| 能力 | 当前 StoryLand / 共用代码 | 参考 ZIP 中可观察行为 | 建议 |
| --- | --- | --- | --- |
| 用户身份 | 使用随机 visitorKey 和匿名业务 JWT；数据库 User 已有 TikTok OpenID 字段，但没有观众端静默登录接口 | 前端初始化 Minis SDK，调用 TTMinis.login，向 /api/users/init 提交 code，服务端返回 uid 和 token 后启动广告 | 补齐官方静默登录；不要假设参考包 uid 就是 OpenID |
| 进入广告 | 共用 EntryAdGate 支持 REWARDED_GATED、INTERSTITIAL、次数、COMPLETED/SHOWN 计数；StoryLand 当前工作树在 providers.tsx 中绕过此门禁，另走 ad_entry=1 的首页延时 30 秒单次插屏 | 登录成功后按 ad_conf 启动自动激励及定时插屏；某个循环每次 onClose 即加 1，不校验完整观看 | 先确认正式 ZIP 版本，再在服务端统一决定是否触发、次数与计数模式；不能将参考包行为视为平台认可 |
| 锁集激励 | 已有 reward-session、广告事件、complete 与服务端解锁验证；中途关闭不解锁 | 包内也调用激励广告解锁接口；后端细节不可见 | 复用现有流程，完整播放才记解锁 |
| 切集插屏 | 有 createInterstitialAd 封装，但 WatchPage 的上一集/下一集未接独立插屏机会判定 | 参考包有全局插屏调度，不能由此证明它只在上下集切换时展示 | 新增切集调度、冷却和与激励互斥 |
| 入口归因 | ad_entry=1 是普通 URL 参数，可伪造 | 参考包向后端传启动 path/query/urlJson；其服务端分类规则不可见 | 区分入口候选与 TikTok 官方归因；未知来源单列 |
| 个人测试豁免 | 当前未见按开发账号或指定 IP 排除入场广告的服务端决策 | 参考包 ZIP 的前端现象不足以证明其识别测试账号/IP 的后端机制 | 登记本人登录身份为主、固定办公 IP 为可选辅助，只跳过入场广告 |

本地代码依据：[全链路梳理](./项目全链路逻辑梳理-2026-10-20.md)、[providers.tsx](../apps/mini-web/src/app/providers.tsx)、[StoryLandEntryAd.tsx](../apps/mini-web/src/components/StoryLandEntryAd.tsx)、[EntryAdGate.tsx](../apps/mini-web/src/components/EntryAdGate.tsx)、[app-entry-ads/routes.ts](../apps/api/src/modules/app-entry-ads/routes.ts)、[auth/routes.ts](../apps/api/src/modules/auth/routes.ts)、[WatchPage.tsx](../apps/mini-web/src/pages/WatchPage.tsx)。

## 三、建议的业务状态机

1. 打开：初始化 SDK，取得静默登录 code，后端兑换当前应用 OpenID，并签发本方会话。登录异常时保留功能性首页与有限匿名业务会话，并可重试。
2. 记录本次入口和来源证据；服务端识别已核验的开发测试豁免，再读取对应广告策略。并行加载可用首页及免费剧集；广告失败、库存不足或登录失败不能导致落地页空白。
3. 锁集：明确展示“完整观看广告后解锁第 X 集”，由用户点击。isEnded=true 才计入集解锁；提前关闭记 CLOSED_INCOMPLETE，但不发奖励；失败与无填充单独记录。
4. 切集：在剧情自然结束后评估插屏机会；如前一动作是激励广告解锁，跳过本次插屏。广告关闭/失败后继续切换，不拦截播放。
5. 建议初始频控作为待验证产品假设：首集与首次打开免插屏；单会话至多 1–2 次；两次插屏至少约 3 分钟；完整激励后的 60–120 秒免插屏。根据留存与收入调整，不把这些数字说成 TikTok 官方规定。

激励广告和插屏广告承担不同任务：前者用于用户主动选择的剧集解锁，完整播放决定能否发放权益；后者用于自然切集，不发解锁奖励。两者的单次收益没有固定大小关系，需分别观察广告请求、填充、实际展示、有效收益、eCPM、用户退出与后续观看时长。`SHOWN` 入场次数不等于平台结算展示，更不等于完整激励观看；不能仅按「弹出次数」预测收入。

### 切集插屏实施状态（2026-10-20）

- 新增每应用独立的 `EPISODE_INTERSTITIAL_PLACEMENT_ID` 或 `<APP_KEY>_EPISODE_INTERSTITIAL_PLACEMENT_ID` 服务端配置，当前为空。`GET /episode-interstitial/config` 返回当前应用的开关与广告位；为空时返回 `enabled:false`，前端不创建或展示插屏，直接切集。不可用入场插屏或激励广告位代替。广告位创建并设为 Active 后，部署 API 配置才有真实广告。
- `WatchPage` 的播放结束和上下滑切集进入同一候选流程；剧集列表点选、锁集解锁后立即跳转不弹插屏。前两次切集放行，此后每三次切集才尝试一次，单会话最多两次成功展示，展示间隔至少三分钟；激励广告结束后一分内跳过，入场/激励/切集广告互斥。关闭、失败、无填充或不支持 API 时继续切集。该节奏是可调整的产品初值，并非平台强制频率。
- 当前实现没有新增数据库机会表、服务端广告展示事件或后台频控配置；实际填充率和收益要在 TikTok 统计中验证。部署前还需独立广告位 ID、Portal Active 状态和真机正常展示/关闭/失败回归。

### 待办：左右滑返回挽留交互（本次不开发）

用户描述的横向左滑/右滑返回动作，先辨别是小程序内 H5 手势还是 TikTok 容器/系统原生返回手势。若平台允许页面拦截且可控，前端可仅在 `WatchPage` 的明确横向手势上呈现一次挽留面板，供用户继续观看或确认返回；不要通过广告覆盖系统返回，也不要把返回动作直接变成强制插屏。必须保留清晰的退出路径、避免与现有纵向切集手势冲突，并在 iOS/Android 真机分别测试。系统级返回若不可拦截，就遵循平台导航。

如仍需评估入场广告的两种次数模式，应在需求和日志中严格区分：`COMPLETED` 只有 `isEnded=true` 才使入场计数加一；`SHOWN` 在广告成功展示且关闭后计数，包括未看完的关闭，但请求失败/无填充/未展示不计数。`SHOWN` **仅是入场流程次数**，不得发放剧集解锁奖励，也不得记为完整观看。需要设置总尝试次数、总等待时长、退出路径及失败时可进入首页的降级策略，避免用户被困在门禁。现有服务端已有这两种计数骨架；前端 SDK 回调仅是客户端证据，不能据此声称后台独立验证了观看行为。

## 四、静默登录

用户提供的《TikTok Minis 静默登录（login）能力接入说明》与[官方静默登录指南](https://developers.tiktok.com/docs/en/tiktok-minis-silent-login)都要求：HTML 初始化 SDK；前端 TTMinis.login 获取一次性短期 code；立即通过 HTTPS 提交给本方后端；后端使用当前小程序专属 client_key/client_secret 调 TikTok OAuth token 接口，获得并保存 open_id、access_token、refresh_token 与到期时间。

实施方案：

- 为每个品牌校验自己的 Client Key/Secret 和 App ID，防止跨品牌 code/用户混用；密钥仅在服务端。
- 复用 User.tiktokOpenId 与 User.identityType，新增加密凭证存储及到期刷新；本方业务 JWT 和 TikTok access_token 分离，前端不接触 TikTok token。
- 已有匿名用户的观看进度、收藏、解锁要事务化合并到 TikTok 身份，处理用户+剧集唯一约束；重复登录不丢权益。
- code 只用一次，不进日志；OAuth 错误分别记录错误类别、耗时、品牌和请求 ID；失败继续提供可用首页并允许重试。
- 静默登录给出本应用范围内的 OpenID；它本身不提供「开发者/测试账号」标记、可信投放归因、客户端真实 IP 或任意个人资料。要在后台识别个人测试身份，须把已登录的本人账号与 OpenID 主动绑定。

## 五、入口来源与开发者个人测试豁免

### 入口来源

业务定义是：来自自家广告投放入口的访问才有资格进入「入场广告候选」流程，其他直接打开/预览/自然流量不触发入场广告；**锁集激励与切集插屏按独立规则运行**。必须区分「带自家投放 URL 标记的候选访问」和「TikTok 官方最终归因用户」。`ad_entry=1` 可自行拼接，只是 URL 提示；即使链接带签名，也最多证明入口 URL 由己方生成，不能证明真实广告点击或平台最终归因。本次公开文档核对未找到按 OpenID 实时查询用户投放归因或 Portal 测试账号身份的 Minis API；[Mini Drama Analytics](https://developers.tiktok.com/docs/en/mini-drama-analytics) 是聚合分析依据，不应被描述为实时逐人鉴权接口。

建议记录 `launchId`、入口路径、允许的 campaign 参数、首次打开时间、`sourceClass=PAID_CANDIDATE|ORGANIC|UNKNOWN`、`evidenceType=SIGNED_LINK|URL_HINT|NONE`。`PAID_CANDIDATE` 仅代表满足己方广告入口约定；报表不能将其写成「官方已归因」。未知来源单列；当证据缺失或冲突时不启动入场广告，继续提供正常首页。广告配置、前端路由和后端入口判断应共享同一规则，消除「预览也强弹」及重复调度。

入场广告会话只能引用后端已记录的 `LaunchContext`，不能因为前端自报 `sourceClass=PAID_CANDIDATE` 就弹广告。静默登录失败、入口证据无法核验或豁免状态暂时无法查询时，返回可用首页并记录 `decisionReason`，待下一次正常启动再重新评估；不能因一次错误重复弹出或无限等待。该降级可能减少部分展示，但能保证测试与普通用户都不会被错误门禁困住。

### 本人及团队账号的测试豁免

Portal 截图中的测试账号是调试资格配置，不是小程序可直接读取的人员类型。采用两层识别：

1. **首选账号级**：本人用 Portal 已添加的测试账号进入小程序，完成 `TTMinis.login()`；管理员在受保护后台将此账号的当前应用 OpenID 绑定为 `DEVELOPER_TESTER`。后台只显示脱敏标识，操作需二次确认、理由、有效期和审计日志。撤销后立即生效。业务 JWT、客户端传入的 `isDeveloper` 或 Portal 用户名本身都不能当授权凭据。
2. **可选 IP 库**：后台维护自己掌控的固定办公室/测试出口 IP，字段为 `miniAppKey`、绑定的测试账号、精确 IP（IPv4/IPv6）、备注、创建人、到期时间、启用状态。由本人从已认证的后台查看当前服务端识别的出口 IP，再手动加入；默认短有效期。IP 规则仅能作为**已绑定测试账号的附加条件**，不能单凭 IP 让任意访问者免广告，否则共享出口上的普通用户也会被误排除。移动网络、家庭动态 IP、VPN 和运营商 NAT 均可能变化；服务端只信任受控代理链路传来的客户端 IP，不能直接信任任意 `X-Forwarded-For`。
3. **生效范围**：仅在服务端创建入场广告会话前判断。已绑定账号满足豁免配置（如配置了限定 IP，还须命中该 IP）时返回 `required:false, reason:DEVELOPER_TEST_EXEMPT`；锁集激励仍可正常测试，切集插屏是否测试由独立测试配置决定。记录脱敏决策日志，不把豁免名单下发前端。普通用户没有绑定测试身份时始终按正常来源及广告规则执行。
4. **优先级**：身份校验与应用隔离 → 开发测试豁免 → 来源证据判定 → 入场广告策略 → 频控/库存/失败降级。后台可为已绑定账号提供「真实体验测试」临时开关，供开发者验证完整入场链路；该开关只对本人账号生效。

绑定流程：本人用测试账号在小程序里完成静默登录，点击受限的「生成测试绑定码」入口；后端生成一次性、短有效期绑定码，并在服务端把它关联到当前应用 OpenID 及本次请求所见的出口 IP。管理员在后台输入绑定码，核对应用、账号与脱敏 IP 后批准账号豁免；需要限定固定 IP 时再批准该 IP。绑定码不能由前端自填 OpenID/IP，也不能通过访问预览页自动完成登记。更换设备或动态 IP 时，账号级豁免继续有效；启用 IP 限定的账号须更新对应 IP 才生效。

这样可以使开发人员日常测试免受入场广告干扰，同时保留真实流程的可测性。IP 库管理的是本人账号的可用测试网络，不能靠预览、IP 归属或其他特征推断平台人员身份。

## 六、建议新增 API 与数据表（设计稿）

所有路径相对各品牌的 /api/<key>/v1；主应用相对 /api/v1。落地时同步共享 DTO 和 OpenAPI 文档。

| API | 输入/输出 | 约束 |
| --- | --- | --- |
| POST /auth/tiktok/session | code、clientSessionId、可选匿名 JWT → 本方 accessToken、viewer | 后端 OAuth 兑换；限流；一次性 code；匿名数据合并幂等 |
| POST /launch-contexts | launchId、releaseId、入口路径、允许的活动参数 → sourceClass、evidenceType | 参数白名单；服务端证据分类；同 launchId 幂等；不能声称官方归因 |
| GET /me/session（可选） | 身份类型、入口候选类别、可用功能 | 只返回本人业务数据，不返回 TikTok 凭证或 IP |
| POST /me/developer-test-binding-challenges | 本人已登录会话 → 一次性短期绑定码、有效期、脱敏 IP | 服务端关联当前应用 OpenID 和可信代理解析的 IP；限流；仅供本人主动发起 |
| POST /app-entry-ad-sessions（扩展现有） | launchId、releaseId → required、reason、sessionId、mode、requiredCount、countMode | 后端先核验本人测试豁免与入口来源，再决定是否创建会话；不接受客户端自报开发身份 |
| GET/POST/DELETE /admin/developer-test-accounts | 脱敏列表；提交本人绑定码批准、撤销、期限与理由 | 管理员权限、一次性码核验、应用隔离、到期自动失效、审计 |
| GET/POST/DELETE /admin/developer-test-ips | 已绑定测试账号、精确 IP、期限、备注、启停；列表与撤销 | 管理员权限、短期有效；与账号身份共同校验，IP 单独命中不豁免 |
| PUT /admin/developer-test-accounts/:id/real-experience | 指定本人账号临时开启/关闭完整入场流程 | 有时限，供回归测试；不能影响其他用户 |
| POST /episode-transitions/opportunity | 前后集 ID、launchId → show、opportunityId、placementId、reason | 后端频控、可播性校验、激励互斥；不保证广告填充 |
| POST /episode-transitions/:id/event | 广告展示/关闭/失败与 clientEventId | 机会归属校验、重复事件幂等，失败继续切集 |
| GET/PUT /admin/ad-experience-policy | 入场/插屏广告位、次数、计数模式、冷却、会话上限、启停、版本 | 权限、审计、回滚；来源规则与个人测试豁免分别配置 |
| GET /admin/analytics/launch-ad-funnel | 首页、首帧、锁集、激励完成、插屏、流失 | 来源仅候选分类，与平台聚合报表区分 |

建议新增 TikTokCredential（密文 token 与过期时间）、LaunchContext、DeveloperTestAccount、DeveloperTestIp、DeveloperTestBindingChallenge、InterstitialOpportunity；现有 User、AppSession、AppEntryAdPolicy、AppEntryAdSession、AdEvent、RewardedUnlockSession 与 EpisodeUnlock 尽量复用。测试绑定码和 IP 记录应设有效期、过期清理和最小权限访问；广告事件日志不存完整 IP。入场广告次数策略需要单独政策确认，默认以可用首页为优先。

会话边界须在产品上定义为一次真正的小程序启动，而不是每次路由切换或页面刷新。现有前端 `getLaunchId()` 存在 `sessionStorage` 中，后端按 `userId + releaseId + launchId` 复用入场会话；实现新策略前要确认冷启动、后台恢复、网页刷新分别何时生成新 ID，避免同一次进入重复弹 N 次，或下次进入错误沿用上次完成状态。所有关闭/失败事件使用幂等 `clientEventId`，后台策略变更按 `policyVersion` 固定在已开始的会话上。

## 七、生产观察与实施顺序

本次只读检查：本地 HEAD 为 73b9f0f；服务器 /opt/quickreels HEAD 为 33c855a，工作树约 72 条未提交改动；服务器的 auth 目录只见 anonymous-session.ts。公开 StoryLand 剧目 API 返回 200，但这不能证明正式 Mini 包的代码版本、首页可用或广告逻辑。当前 SSH 用户无 Docker socket 权限，所以未核实容器镜像摘要。未修改生产服务，也未输出 key.txt 内容。

1. **P0 落地页排查**：固定实际广告点击 URL，在目标地区真机核验首页内容、免费集、锁集提示、隐私/条款、API 与播放。查看首页空白、请求错误、广告占屏比例、首帧耗时及审核拒绝截图。无法仅凭拒绝文案断定唯一原因是强弹广告。
2. **P1 静默登录**：完成服务端 OAuth、凭证加密与匿名数据迁移，再接前端 login；真机验证相同 OpenID 多次进入权益一致，跨品牌隔离，弱网仍可使用首页。
3. **P2 个人测试豁免与来源**：管理员绑定本人测试账号 OpenID，并可登记固定测试出口 IP 作为附加条件；后台在入场广告会话创建前执行豁免及来源判断。StoryLand 目前绕过共用门禁并由单独组件调度，改造时要统一决策点并验证只触发一次。先在测试账号开关中验证完整广告流程，再验证关闭后的豁免效果。
4. **P3 广告协同**：锁集激励维持完整播放解锁；新增切集插屏机会、冷却和互斥；后台启停、版本化与回滚。Portal 启用对应类型广告位，用官方广告 Mock 测完整、关闭、失败和无库存。入场连续激励作为待政策确认的需求单独评估。
5. **P4 分析**：观察打开→首页→首帧→锁集→激励完成→下一集漏斗；对照官方 IAA 请求/展示/eCPM/收益、留存和投诉，调整插屏频率。

发布前需先确认服务器实际运行镜像与 Git 版本，备份各品牌数据库，逐品牌迁移；服务器部署与 Mini ZIP 上传是两条独立发布链。个人测试账号有明确豁免记录，普通账号按其真实入口和相同发布版本执行公开策略。若仍要尝试首页前连续激励，先向 TikTok 获取针对该具体交互、次数与关闭计数规则的书面确认。

## 八、需求清单与验收

| 需求 | 方案中的归属 | 验收标准 |
| --- | --- | --- |
| 开发者本人预览免入场广告 | 已绑定测试账号为准、固定自有 IP 为可选限定 | 测试账号从预览或投放入口打开均不触发入场广告；仅 IP 命中的普通账号不能免广告；豁免撤销后按正常规则执行；锁集广告可继续测试 |
| 普通用户按来源区分 | `LaunchContext` + 服务端入口判定 | 无投放入口证据时不开入场广告；有效己方投放 URL 进入候选流程；UNKNOWN 单列，不将 URL 标记冒充官方归因 |
| 后台设置入场广告次数 | 复用 `AppEntryAdPolicy` / `AppEntryAdSession` | 可设置类型、次数、计数模式、启停；不能与 StoryLand 额外调度重复弹出；正式开启以政策确认为前提 |
| 完整播放/展示后关闭计数 | `COMPLETED` / `SHOWN` | 完整播放模式提前关闭不计入；展示计数模式在成功展示并关闭后计入；请求失败不计；两种模式都不自动授予剧集解锁 |
| 完成入场流程后进入主界面 | 统一会话状态机 | 达到次数即结束；失败、无库存或超时有可用首页和明确降级，不出现无限循环/白屏 |
| 静默登录 | `TTMinis.login()` + 本方 `/auth/tiktok/session` | 同一用户重复进入保留进度/解锁；多应用隔离；无弹窗；OAuth 失败有可用页面 |
| 锁集激励 | 复用现有 reward session | 用户主动触发，只有完整播放才解锁；提前关闭、失败、无库存不发奖励 |
| 上一集/下一集插屏 | 机会接口 + 冷却/互斥 | 只在自然切集机会展示；关闭或失败后仍可切集；刚完成激励时跳过；频控可调 |
| 广告表现和落地页健康 | 漏斗、客户端错误与平台聚合报表 | 能分辨登录失败、无填充、展示、完整观看、退出和首帧失败；实际广告入口在目标地区可看到有效内容 |

测试矩阵至少覆盖：开发者账号/普通账号 × 投放候选/自然入口 × 预览/正式包；固定 IP 命中/失效/动态变化；广告完整/提前关闭/无填充/SDK 不支持；匿名转静默登录；激励解锁后立即切集。须证明共享出口上的普通账号不会因 IP 规则获得豁免；无法可靠取得客户端 IP 时回退到纯账号级豁免。

## 官方文档

- [Mini Dramas 总入口](https://developers.tiktok.com/docs/en/mini-dramas-landing)
- [Silent Login](https://developers.tiktok.com/docs/en/tiktok-minis-silent-login)
- [Rewarded Ads](https://developers.tiktok.com/docs/en/tiktok-minis-in-app-ads)
- [Interstitial Ads](https://developers.tiktok.com/docs/en/tiktok-minis-in-app-ads-interstitial-ads)
- [Mini Drama Analytics](https://developers.tiktok.com/docs/en/mini-drama-analytics)
- [Ad Format and Functionality](https://ads.tiktok.com/resources/help/article/tiktok-ads-policy-ad-format-and-functionality)

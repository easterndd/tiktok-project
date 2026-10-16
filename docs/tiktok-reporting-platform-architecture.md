# TikTok 广告报表平台完整架构与实施方案

更新日期：2026-10-14  
交付范围：架构与实施文档；尚未接入真实 Token、部署新站或完成性能压测。

## 1. 目标与首版边界

建设独立网站、独立 Java 工程、Vue3/TypeScript 前端、数据库和部署环境，不纳入现有短剧后台。已确认接入对象是 **4 个有独立 BC ID 的 Business Center**，不是 4 个登录账号。

首版功能：

- 同一个 TikTok 开发者 App，支持多次 OAuth 授权，发现可访问 BC 和广告账户。
- 全部 BC 汇总、单 BC 查看，按公司主体、广告账户、Campaign、Minis 筛选。
- UTC+0 的每日消耗、展示、点击、转化趋势，日汇总生成月报。
- UTC+0 的账户/广告系列分时消耗；今日显示 00:00 至 23:00 的小时区间。
- Campaign 下钻、Minis 日报、可用的 Native Growth 收入与 ROAS。
- 赔付资格/状态、历史金额；不编造“官方审核赔付转化数”。
- CSV、Excel 导出、同步状态、权限与审计。

采集策略：在已确认“一个广告只绑定一个 Minis”的前提下，首版以广告层为主要事实来源，再按广告的 Campaign、广告组、Minis 关系汇总。该策略减少多层重复拉取，并保留广告素材和产品的可追溯性；但仍要保留账户层和 Campaign 层对账请求，因为 Minis 归因窗口、删除对象和非加性指标不能仅靠广告层相加还原。

三个边界必须在产品中明确：

1. 官方现有维度组合不支持 Minis + 小时，不能承诺直接取得原生 Minis 分时报表。
2. Minis 是广告中的 Minis 产品标识，不天然等于某部短剧。若一个 Minis 产品包含多部短剧，本报表不能仅凭 minis_id 识别剧目。
3. 不同币种默认分别汇总；ROAS 按同一口径的收入与消耗重算，不能直接平均。

## 2. 框架选择与参考项目

### 2.1 推荐框架

推荐 **RuoYi-Vue-Plus + 官方配套 plus-ui**，采用模块化单体，并将 API 与后台 Worker 独立运行。

| 方案 | 适配判断 |
| --- | --- |
| RuoYi-Vue | 若依经典前后端分离方案；需额外确认选用分支的 Java 和前端版本，并自行加强数据权限与业务任务能力 |
| RuoYi-Vue-Plus + plus-ui | 推荐；提供权限、组织、审计等基础功能，配套前端为 Vue3 + TypeScript，便于开发报表模块 |
| RuoYi-Cloud | 首版没有明确微服务需求，额外服务治理成本较高，暂不选 |

官方仓库与文档：

- 后端：[GitHub](https://github.com/dromara/RuoYi-Vue-Plus)、[Gitee](https://gitee.com/dromara/RuoYi-Vue-Plus)。
- 前端：[GitHub plus-ui](https://github.com/CrazyLionCat/plus-ui)、[Gitee plus-ui](https://gitee.com/JavaLionLi/plus-ui)。
- 备选：[RuoYi-Vue](https://github.com/yangzongzhuan/RuoYi-Vue)。
- 框架文档：[RuoYi-Vue-Plus](https://plus-doc.dromara.org)。

本次检查确认 Plus 后端仓库为 MIT，前端 README 明确 Vue3/TypeScript/Element Plus/Vite 技术栈。未锁定具体正式 release tag；实施时选择兼容的前后端正式 tag 或 commit，锁定依赖与 License，不能拿两个仓库的任意 master 混用。Java 21 是本方案基线，Spring Boot 版本以所选框架正式版本兼容矩阵为准；不沿用旧项目的 Java 8 / Boot 2.5。

### 2.2 两个参考项目的实际发现

| 项目 | 已查看内容 | 借鉴方式 |
| --- | --- | --- |
| E:/kuaishou-ad-tool | Java 多模块、Spring Boot 2.5/Java8；Vue3/Vite 前端；OAuth state、TokenCipher、锁和任务模块 | 借鉴 state 持久化与一次性消费、AES-GCM 加密、授权后异步发现账户、限流锁、迁移和任务可观测性 |
| E:/ad_serving2/ad_serving2 | ruoyi-admin.jar、前端 dist、MySQL/Redis/MinIO/Nginx 部署产物；JAR 元数据为 RuoYi 3.8.8、Boot 2.5、Java8 | 参考模块组织与部署方式；当前提供目录缺少可维护的完整业务源码，不能据此直接复用投放系统业务 |

新站只做 TikTok 报表，不复制快手接口字段和 Token 刷新协议，不从现有短剧数据库采集业务数据。

### 2.3 技术栈

| 层 | 选择 |
| --- | --- |
| Web | Vue3、TypeScript、Vite、Pinia、Element Plus、ECharts；复杂列表可使用 vxe-table 服务端分页 |
| API | Java21、Spring Boot、MyBatis-Plus、自定义聚合 SQL、框架配套权限组件 |
| 数据迁移 | Flyway；与框架初始化 SQL 明确职责，所有业务表变更纳入迁移 |
| 主库 | MySQL8.4，事务维表、按月分区事实表、预汇总表 |
| 缓存 | Redis，短期查询缓存、任务锁、限流计数 |
| 任务 | 优先使用所选框架正式版本已配套的调度器；需要独立执行器时部署 Worker |
| 文件 | MinIO 或兼容 S3，保存导出与必要的原始响应 |
| 部署 | Docker Compose 起步，Caddy/Nginx HTTPS 入口，API/Worker/数据库独立服务 |

不同时引入 Quartz、多个消息队列和另一套任务平台。如框架配套调度器无法满足持久任务需求，再选择一种持久队列；数据库 sync_task 必须是任务状态的可靠来源。

## 3. 组织、主体、BC 和授权模型

### 3.1 不能使用单一树形关系

正确对象关系为：

- Workspace/Tenant：本网站的组织与权限隔离边界。首版一个内部 Workspace 管理全部 4 个 BC，可管理多个公司主体。
- Legal Entity：注册公司主体，保存公司名称与外部核验来源。
- BC：真实 Business Center，使用官方 bc_id 标识。
- Connection：一次 OAuth 授权连接，属于某个 TikTok for Business 用户，不等同于 BC。
- Advertiser：广告账户，使用 advertiser_id 标识。
- Campaign：广告系列。
- Minis：Minis 产品维度。

Connection ↔ BC、Connection ↔ Advertiser、BC ↔ Advertiser 均按多对多设计。一个用户可能访问多个 BC，一个账户可能被多个 BC 共享。

BC 的注册主体与广告账户的注册主体可能不同。报表“主体公司名称”默认展示 **广告账户主体**；需要查看 BC 主体时单独提供字段，不能把 BC 名称或账户名称当作法定公司名称。

### 3.2 公司名称数据来源

优先检查 /advertiser/info/ 以及业务已获权限允许读取的官方主体信息；本次可读官方 SDK 没有给出完整响应模型，**尚未确认 company 等字段的实际返回及法律含义**。

实施必须记录 entity_source、verified_at 和原始依据。接口有可核验主体字段时同步；没有时由管理员维护账户 → 公司主体映射。未知主体显示“待确认”，不能根据名称自动猜测。BC 主体也独立维护和核验。

### 3.3 四个 BC 的授权流程

同一个开发者 App 可以接入多次用户授权，无需每个 BC 分别创建一个 App。能读哪些账户取决于应用权限、用户权限和实际资产授权；OAuth 不是“授予整个 BC 全部权限”的保证。

1. 后端生成一次性 state，记录发起人、tenant_id、预期 BC ID、过期时间和安全回跳路径。
2. 用户通过官方 OAuth 页面授权。
3. 回调原子消费 state，并在后端通过 /oauth2/access_token/ 交换 auth_code。
4. /bc/get/ 发现该连接能访问的 BC，验证预期 BC 是否存在。
5. 对目标 BC 调用 /bc/asset/get/，asset_type=ADVERTISER，遍历分页，保存 BC 与账户的资产关系。
6. /oauth2/advertiser/get/ 查询该 Token 实际可访问账户，交叉验证资产清单。
7. /advertiser/info/ 补充账户名称、时区、币种等资料，管理员核验主体和报表权限。
8. 对每个 advertiser_id 选择可用主连接发起报表任务，备用连接仅在已验证权限时接管。

state 中的预期 BC 只是平台上下文，不能作为 TikTok 已验证 BC 归属的证据。BC 资产中“拥有”和“共享”关系应保存；Token 看到账户也不代表账户属于某一 BC。

TikTok Marketing API 的长期 Token 不能照搬快手 refresh_token 逻辑；按该应用当前官方授权规则处理撤销、权限变化和重新授权。服务端加密存储 Token，不发送给前端。

官方依据：[AuthenticationApi](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/AuthenticationApi.md)、[BCApi](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/BCApi.md)、[AccountManagementApi](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/AccountManagementApi.md)、[Authentication FAQ](https://business-api.tiktok.com/gateway/docs/index?doc_id=1766037914914818&identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b)。

### 3.4 汇总去重和归属

全部 BC 汇总：先得到用户有权查看的 advertiser_id 集合，对账户去重，再读取事实。不能直接把 4 个 BC 的小计相加。

单 BC：读取该 BC 可用账户集合。共享账户可在两个 BC 的单独页面出现，因此各 BC 小计相加不一定等于全局总计。

首版增加“主归属 BC”口径，用于可相加的 BC 对比；同时保留“包含共享账户”查看模式。多选 BC 时始终以去重账户集合查询。主体归属与主 BC 归属有生效日期，历史报表默认按历史归属查看，提供“按当前归属”选项时明确标注。

事实表不包含可变的主 BC、公司主体或 OAuth connection 作为唯一粒度；主体/BC 是查询映射，避免归属变化或重新授权造成重复入库。

## 4. 指标与 API 能力边界

### 4.1 首版字段清单

| 业务字段 | API/数据来源 | 处理规则 |
| --- | --- | --- |
| BC ID/名称 | /bc/get/、BC 资产关系 | 显示真实 BC ID，不能以授权连接代替 |
| 账户 ID/名称、币种、时区 | /oauth2/advertiser/get/、/advertiser/info/ | 名称可变；ID 用字符串；所需字段按实际响应核验 |
| 主体公司名称 | 可核验官方主体资料，或人工账户主体映射 | 与账户名称、BC 主体分开；记录来源 |
| Campaign ID/名称 | 报表 ID、可用的名称指标或 /campaign/get/ | 元数据单独同步，保留已删除系列历史名称 |
| minis_id / minis_name | 支持 Minis 的报表维度/名称返回与已核验产品资料 | ID 为主键；名称不可取时维护映射，不依赖名称去重 |
| 消耗 | spend | DECIMAL；同币种汇总 |
| 展示/点击 | impressions、clicks | BIGINT；按同一报表口径汇总 |
| 转化 | conversion | 通用优化转化不等同于赔付审核事件或收入事件 |
| CPI/CPA/CTR/CPC/CPM | 兼容的官方指标或基础指标计算 | 分子分母汇总后计算，不平均单行比率 |
| IAA 广告变现事件数 | native_growth_total_ad_impression_event_count | 不是 impressions，属于广告变现事件 |
| IAA 广告收入 | native_growth_total_ad_impression_value | 是归因广告变现收入，不是赔付金额 |
| IAA 广告 ROAS | native_growth_ad_revenue_roas | 与对应收入、消耗及归因口径一起验证 |
| IAA D0 事件/收入/ROAS | native_growth_ad_revenue_event_count_d0 / native_growth_ad_revenue_value_d0 / native_growth_ad_revenue_roas_d0 | D0 为点击后 24h 口径，不等于 UTC 自然日 |
| IAP 购买事件/价值/ROAS | native_growth_total_purchase_event_count / native_growth_total_purchase_value / native_growth_purchase_roas | 不与 IAA 事件混成通用 conversion |
| IAP D0 指标 | native_growth_purchase_event_count_d0 / native_growth_purchase_value_d0 / native_growth_purchase_roas_d0 | 同样需校验窗口与维度兼容性 |
| 利润 ROI | 本网站计算，需要利润/成本数据 | 仅广告 API 无完整利润成本，首版不称为利润 ROI |
| 赔付资格/状态 | /report/bid_protection/status/get/ | 对支持产品如 Upgraded Smart+ 的资格状态 |
| 历史赔付金额 | /report/bid_protection/detail/get/ | 原始金额按官方单位除以 100000；保留本地 record_date |
| 赔付审核转化数 | 当前已核验赔付接口未提供单独字段 | 展示符合相应口径的候选事件用于对账，标注非官方审核数 |

上述 Native Growth 字段仅在账户、产品、维度和权限支持时请求；不保证任意字段能同时用于 Minis、小时或所有广告系列。为每组建立 metric_profile 和兼容矩阵，联调验证后启用。普通 conversion、IAA 事件、IAP 事件独立展示，禁止相互替代。

官方来源：[基础报表指标](https://business-api.tiktok.com/portal/docs/basic-reports-supported-metrics/v1.3#anchor-2-4-2)、[支持维度](https://business-api.tiktok.com/portal/docs/basic-reports-supported-dimensions/v1.3)、[Minis 180 天指标](https://business-api.tiktok.com/portal/docs/180-day-attribution-window-metrics-together-with-the-dimension-minis_id/v1.3)、[赔付状态](https://business-api.tiktok.com/portal/docs/get-bid-protection-statuses/v1.3)、[赔付历史](https://business-api.tiktok.com/portal/docs/get-bid-protection-history/v1.3)。

### 4.2 原生报表粒度

| 报表 | dimensions 方案 | 用途 |
| --- | --- | --- |
| 账户日报 | advertiser_id + stat_time_day | 账户总览与对账的规范数据源 |
| Campaign 日报 | campaign_id + stat_time_day | 系列下钻与规范系列汇总 |
| 广告 + Minis 日报 | ad_id（或适用的 ad_id_v2）+ minis_id + stat_time_day | 首选事实采集粒度；一个广告一条有效 Minis 绑定时可按 Minis 汇总 |
| Campaign + Minis 日报 | campaign_id + minis_id + stat_time_day | 对账、补缺和没有可用广告层映射时使用 |
| 账户小时 | advertiser_id + stat_time_hour | UTC 当日账户趋势 |
| Campaign 小时 | campaign_id + stat_time_hour | UTC 分时系列趋势 |
| 月报 | 对规范日报汇总 | 不使用不存在的 stat_time_month |
| 广告小时 | ad_id（或适用的 ad_id_v2）+ stat_time_hour | 分时消耗/展示/点击；按广告生效映射汇总到 Minis |
| Minis 小时 | 当前没有已确认的原生 Minis + stat_time_hour 组合 | 使用广告小时映射时必须标记为 derived，不能称为 TikTok 原生 Minis 小时 |

一个请求按官方规则选择一个普通 ID 层级和时间维度；Minis 作为资产维度时可与一个 ID 维度组合。因此在本业务约束成立时，日报请求可使用 `["ad_id","minis_id","stat_time_day"]`；广告小时请求使用 `["ad_id","stat_time_hour"]`，再通过广告绑定表映射到 Minis。不能把 advertiser_id、campaign_id、adgroup_id、ad_id 同时作为多个 ID 维度。升级版 Smart+ 需按官方支持选择 `ad_id_v2`，不能把两个 ID 维度同时请求。

广告层方案的硬约束：

1. 同步广告元数据（广告、广告组、Campaign）并保存 `ad_id`/`ad_id_v2`、campaign_type、status、first_seen_at、last_seen_at。
2. 建立 `ad_minis_binding(advertiser_id, ad_key, minis_id, valid_from_utc, valid_to_utc, source, is_current)`；数据库唯一约束保证同一广告在同一生效区间只有一个 Minis，冲突进入人工核验队列。
3. 每次报表行先按 `ad_key + stat_time` 规范化，再 JOIN 生效区间映射；映射缺失的行进入 `UNMAPPED`，不能按名称猜测或静默丢弃。
4. 若广告曾更换 Minis，按生效日期拆分；历史数据不能全部归到当前 Minis。
5. 广告层合计与账户/Campaign 对账存在差异时，保存 reconciliation_status 和差异原因（归因窗口、删除对象、未映射广告、币种、数据延迟）。

Minis 报告中部分转化/付费指标使用 180 天窗口，和非 Minis 指标口径可能不同。不能把所有 Minis 转化或收入相加后替代账户/Campaign 规范日报，也不能假定所有 Native Growth 指标均适用 180 天。

### 4.3 UTC+0 和今日数据

报表入口：GET https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/。

UTC 多账户方式使用 advertiser_ids 和 multi_adv_report_in_utc_time=true；单次最多 5 个账户，属于同一授权用户且 Token 能访问。不同授权用户分别请求，本地汇总；不要跨 Token 拼一个请求。日报窗口最多 30 天，小时窗口最多 1 天，page_size 按允许上限 1000 分页。按实际支持的筛选枚举包含历史删除对象，避免默认过滤漏掉已有消耗。

联调请求的结构示意（查询参数需 URL 编码，不把 JSON body 当 GET body）：

    GET /open_api/v1.3/report/integrated/get/
    Access-Token: <server-side token>

    advertiser_ids=["ACCOUNT_ID"]
    multi_adv_report_in_utc_time=true
    report_type=BASIC
    service_type=AUCTION
    data_level=AUCTION_CAMPAIGN
    dimensions=["campaign_id","stat_time_day"]
    metrics=["spend","impressions","clicks","conversion"]
    start_date=2026-10-01
    end_date=2026-10-01
    page=1
    page_size=1000

必须使用返回中的 dimensions 和 metrics 分别解析，不假设字段都在顶层；校验 HTTP 状态、业务 code、request_id 和 page_info。其他粒度按允许的 data_level/指标组合配置。

UTC 参数说明与部分日期参数的“账户本地日期”表述存在需要联调确认的边界；上线前使用 UTC0、UTC+8、负偏移账户验证返回 00:00/23:00 范围和日小时对账。不能把账户本地日报简单平移成 UTC 日报。

今日规则：

- 时间区间用 UTC，左闭右开；界面可显示 UTC 与用户本地时间提示。
- 当前未结束小时显示“进行中”；未来小时显示空值，不显示 0 消耗。
- API 未返回行不立即解释为 0：区分未完成同步、未确认缺失和已确认无投放。
- 展示覆盖截至时间、最后同步时间、归因未完成提示。
- 普通报表有延迟，不能称为实时账单；高频刷新不能消除平台延迟。

文档说明的常见延迟约 30 分钟，特殊情况可能达到 2 小时以上；每天 UTC12 附近修正的数据需要回补。最终以账户实测与平台实际完成情况为准。

官方依据：[Reporting guide](https://business-api.tiktok.com/portal/docs/reporting-guide/v1.3)、[同步报表](https://business-api.tiktok.com/portal/docs/run-a-synchronous-report/v1.3)。

### 4.4 赔付独立口径

赔付 status 接口的资格状态与 detail 接口的历史记录状态不是同一个枚举，分别保存与解释。历史通常覆盖近 60 天，更新频率为每日；不宣称每小时更新。

record_date 是账户本地记录日期，不保证就是投放发生日期，不可改名为 UTC 日。赔付金额及本地记录汇总独立展示，不能并入 UTC 消耗/收入事实，也不能凭现有接口分配到 Minis 或小时。

### 4.5 Mini Dramas IAA 的用户行为与健康度

需要先区分三类行为：

| 行为 | 可以从广告报表得到什么 | 不能从广告报表直接得到什么 |
| --- | --- | --- |
| TikTok 广告视频观看 | 在支持的广告/视频指标组合中验证 `video_play_actions`、`video_views_p25`、`video_views_p50`、`video_views_p75`、`video_views_p100`、`average_video_play` 等字段；最终以该账户和维度的兼容矩阵为准 | 不能把观看次数当成去重用户数；部分视频指标会因维度限制不可用（例如官方对 `video_material_id` 明确限制 `video_views_p100`） |
| 点击并进入 Minis | clicks、conversion、相关落地/应用事件，以及 Minis 维度下可用的 Native Growth 指标 | 不能由广告报表证明用户实际看完某一集剧集 |
| Mini Drama 内剧集行为 | 需要 Mini 应用自己的埋点/SDK 或服务端事件：进入应用、首屏成功、开始播放、播放 25/50/75/100%、观看时长、下一集、留存、激励广告展示/完成、IAA 收入 | TikTok Reporting API 不提供按用户身份或按剧集集数的完整行为日志 |

建议在 Minis 后台或数据服务增加匿名事件表，使用 `event_id` 去重，不保存不必要的用户身份信息。将广告层 `ad_id -> minis_id` 与应用事件中的 `minis_id`/产品键关联，计算：点击到达率、首屏成功率、播放开始率、25/50/75/100% 完播率、激励广告完成率、IAA eCPM、D0/D7 留存、单用户会话时长。TikTok 报表的 `native_growth_total_ad_impression_event_count/value` 是归因的广告变现事件和价值，不是观看某部剧的独立用户数；`native_growth_ad_revenue_roas` 是归因收入/广告消耗口径，也不能单独证明剧集内容正常。

Mini 健康度看板分为三层：

- 投放层：spend、impressions、clicks、CTR、转化、CPM/CPC、广告视频观看率。
- 产品层：到达、启动、播放开始、25/50/75/100% 完播、激励广告完成、IAA 收入/事件、D0 ROAS。
- 数据质量层：广告未映射 Minis 数、事件延迟、TikTok 与应用收入差异、分母为零、回补覆盖率。

只有接入 Mini 自有事件后，才能回答“观看剧集的用户行为”和“Minis 是否正常”；TikTok 广告层只能回答投放及部分广告素材观看表现。

## 5. 数据库设计

### 5.1 基础原则

所有外部 TikTok ID 用 VARCHAR 字符串，Java 与前端全链路不转换成 JS Number。内部主键可用 BIGINT，但 JSON 输出字符串。金额 DECIMAL，事件计数 BIGINT；未知值为 NULL，未知不是 0。

fact 的稳定粒度由 tenant + advertiser + 维度 + 时间 + metric_profile 决定。profile 固定 report_type、time_basis、归因窗口、指标组和 API 版本；普通日报、Minis 180 天和 D0 指标不能混成相同口径。

### 5.2 维表、关系表与任务表

| 表 | 核心字段/约束 |
| --- | --- |
| platform_workspace | tenant_id、name、status；平台权限边界 |
| legal_entity | tenant_id、entity_id、company_name、registration_ref、source、verified_at |
| tiktok_bc | tenant_id、bc_id、bc_name、bc_legal_entity_id；UNIQUE(tenant_id,bc_id) |
| tiktok_connection | connection_id、tenant_id、tiktok_user_id、token_ciphertext、key_version、status、授权/验证时间 |
| connection_bc | connection_id、bc_id、permission_status、last_seen_at |
| connection_advertiser | connection_id、advertiser_id、permission_status、priority；不依赖单一 BC |
| tiktok_advertiser | tenant_id、advertiser_id、name、currency、account_timezone、enabled；UNIQUE(tenant_id,advertiser_id) |
| bc_advertiser | tenant_id、bc_id、advertiser_id、ownership_type、valid_from/to；有效资产关系 |
| advertiser_assignment | tenant_id、advertiser_id、legal_entity_id、primary_bc_id、valid_from/to；同一时刻只有一个主归属 |
| campaign_dim | tenant_id、advertiser_id、campaign_id、name、status、first/last_seen_at |
| minis_dim | tenant_id、minis_id、minis_name、name_source、first/last_seen_at |
| campaign_minis_map | tenant_id、advertiser_id、campaign_id、minis_id、valid_from/to、mapping_source；不用于自动小时摊分 |
| ad_minis_binding | tenant_id、advertiser_id、ad_key、minis_id、valid_from/to、source、is_current；同一广告同一生效区间只能有一个 Minis |
| mini_event_fact | tenant_id、minis_id、event_date_utc、event_hour_utc、event_name、event_count、unique_user_count、source、data_version；来自 Mini 自有埋点，和 TikTok 事实分开 |
| metric_profile | profile_id、time_basis、attribution_definition、metrics、兼容维度、版本 |
| sync_task / sync_run | 粒度、账户、profile、窗口、连接、重试、lease、generation、页数、request_id、错误 |
| export_task | 用户、权限快照、筛选器、状态、文件地址、行数、过期时间 |
| report_coverage | 账户、profile、时间窗口、完整性、发布版本、最后成功时间 |

关系表建正反向唯一索引，例如 (tenant_id,bc_id,advertiser_id) 与 (tenant_id,advertiser_id,bc_id)。有效期不得重叠，由事务校验。多 BC 过滤使用 EXISTS 或先构造去重账户集合，禁止 JOIN 后直接 SUM 产生重复。

### 5.3 事实表与汇总表

| 表 | 时间与维度 | 说明 |
| --- | --- | --- |
| fact_account_day | UTC日 + tenant + advertiser + profile | 规范账户日报 |
| fact_campaign_day | UTC日 + tenant + advertiser + campaign + profile | 规范系列日报 |
| fact_ad_minis_day | UTC日 + tenant + advertiser + ad + minis + profile | 首选广告层规范事实；广告到 Minis 一对一时可汇总 |
| fact_campaign_minis_day | UTC日 + tenant + advertiser + campaign + minis + profile | 对账或回退粒度，不能与广告层重复相加 |
| fact_account_hour | UTC小时 + tenant + advertiser + profile | 账户分时 |
| fact_campaign_hour | UTC小时 + tenant + advertiser + campaign + profile | 系列分时 |
| fact_ad_hour | UTC小时 + tenant + advertiser + ad + mapping_version + profile | 广告分时；按生效映射得到 derived Minis 小时 |
| fact_bid_protection_record | 账户本地 record_date + tenant + advertiser + data_level + query_id/官方记录键 | 赔付记录，独立币种/状态；唯一键联调确认 |
| agg_scope_day | UTC日 + scope类型/ID + profile + currency + assignment_version | workspace/主体/主BC 日汇总，来自对应规范事实源 |
| agg_minis_day | UTC日 + tenant + minis + profile + currency | Minis 日汇总，只来自 Minis 事实 |

规范账户总计优先来自 account_day；规范 Campaign 总计来自 campaign_day。不要 SUM 所有事实表；小时表、Minis 表和账户表是不同投影。每日回补发布后重算受影响日期的预汇总，统一缓存版本。

Native Growth 的对应收入、事件数独立列存储；请求包含不同口径的收入或消耗时拆 profile。保留官方 ROAS 用于对账，展示汇总 ROAS 仅在确认对应分子和分母可加时计算。去重人数等非加性指标不做日相加。

计算规则：ROAS = 对应归因收入合计 / 消耗合计；CTR = 点击合计 / 展示合计；CPC = 消耗合计 / 点击合计；CPM = 消耗合计 / 展示合计 × 1000。分母为0时返回NULL。收入缺失或覆盖不完整时不得把缺失视为0计算完整ROAS；展示部分数据并标明覆盖范围。多个指标组重复返回的spend只从规范消耗源取一次，不能因请求拆组而重复相加。

### 5.4 核心 DDL 示例

以下为首选事实表 fact_ad_minis_day 的业务骨架；DDL 必须根据已验证指标集生成迁移，其他事实表按各自粒度拆分。ad_key_type 区分 ad_id 与 ad_id_v2，不能把两种 ID 当成同一命名空间：

    CREATE TABLE fact_ad_minis_day (
      stat_date_utc DATE NOT NULL,
      tenant_id BIGINT NOT NULL,
      advertiser_id VARCHAR(64) NOT NULL,
      ad_key_type VARCHAR(16) NOT NULL,
      ad_key VARCHAR(64) NOT NULL,
      minis_key VARCHAR(64) NOT NULL,
      profile_id SMALLINT UNSIGNED NOT NULL,
      currency CHAR(3) NOT NULL,
      spend DECIMAL(24,8) NULL,
      impressions BIGINT UNSIGNED NULL,
      clicks BIGINT UNSIGNED NULL,
      conversion BIGINT UNSIGNED NULL,
      iaa_event_count BIGINT UNSIGNED NULL,
      iaa_revenue DECIMAL(24,8) NULL,
      iaa_d0_event_count BIGINT UNSIGNED NULL,
      iaa_d0_revenue DECIMAL(24,8) NULL,
      source_roas DECIMAL(24,8) NULL,
      fetched_at_utc DATETIME(3) NOT NULL,
      source_request_id VARCHAR(128) NULL,
      data_version BIGINT NOT NULL,
      PRIMARY KEY (
        stat_date_utc, tenant_id, advertiser_id,
        ad_key_type, ad_key, minis_key, profile_id
      ),
      KEY ix_tenant_profile_date (
        tenant_id, profile_id, stat_date_utc, advertiser_id
      ),
      KEY ix_account_profile_date (
        tenant_id, advertiser_id, profile_id, stat_date_utc
      ),
      KEY ix_minis_profile_date (
        tenant_id, minis_key, profile_id, stat_date_utc, advertiser_id
      ),
      KEY ix_ad_profile_date (
        tenant_id, advertiser_id, ad_key_type, ad_key, profile_id, stat_date_utc
      )
    ) ENGINE=InnoDB
    PARTITION BY RANGE COLUMNS(stat_date_utc) (
      PARTITION p_before_202610 VALUES LESS THAN ('2026-10-01'),
      PARTITION p202610 VALUES LESS THAN ('2026-11-01'),
      PARTITION p202611 VALUES LESS THAN ('2026-12-01'),
      PARTITION pmax VALUES LESS THAN (MAXVALUE)
    );

minis_key 使用已核验的 minis_id 或保留命名空间中的“未知”维度键，不能用 NULL 参与唯一约束，也不能与真实 ID 冲突。Campaign/广告组下钻通过有生效期的广告层级维表关联；若原始报表直接返回层级字段，仍保存快照并与元数据核对，不能以广告当前所属系列改写历史归属。小时表使用 stat_date_utc + hour_utc(0..23) 纳入唯一粒度。currency 是账户已验证属性；profile 不可混币种。

MySQL 分区表的每个唯一键都必须包含分区列；分区 InnoDB 事实表不依赖外键，应用负责约束，维表/关系表可以按支持情况使用外键。上线前预建历史与未来月份，滚动 REORGANIZE pmax，不能让所有旧数据长期堆在示例的兜底分区。

索引不是越多越好。上述为候选，依据实际查询和写入成本裁减。不在事实表冗余 bc_id 索引，因为账户归属可变化。

### 5.5 查询范式

账户/BC/主体筛选先转为有权限的去重 advertiser 集合，然后用日期与 profile 约束读取事实：

    SELECT f.stat_date_utc, f.currency,
           SUM(f.spend) AS spend,
           SUM(f.impressions) AS impressions,
           SUM(f.clicks) AS clicks
    FROM fact_account_day f
    WHERE f.tenant_id = :tenant
      AND f.profile_id = :profile
      AND f.stat_date_utc >= :start
      AND f.stat_date_utc < :end_exclusive
      AND EXISTS (
        SELECT 1 FROM authorized_account_scope s
        WHERE s.tenant_id = f.tenant_id
          AND s.advertiser_id = f.advertiser_id
      )
    GROUP BY f.stat_date_utc, f.currency;

authorized_account_scope 是每次请求生成的临时去重集合或等价子查询，需包含服务端权限和业务筛选，不是仅按客户端传入 ID 建表。按历史归属查询时增加日期有效期约束。

## 6. 千万级查询与容量策略

千万行本身不强制使用 ClickHouse，关键是基数、日期范围、扫描量、并发和查询形态。

首版执行步骤：

1. 按账户数 × 活跃系列数 × Minis数 × 天数估算日报；小时表另按 ×24 估算。小时数据不能与日报容量混算。
2. 所有报表默认 7/30 天，限制任意明细大范围查询；月报走日预汇总。
3. 名称搜索先查维表确定 ID；范围查询用日期分区裁剪及 tenant/profile/账户复合索引。
4. 首页和可相加的 BC/主体对比走 agg_scope_day；包含共享账户的任意多 BC 组合使用去重账户事实聚合或集合缓存。
5. 大型排序聚合先生成结果快照，再游标分页；普通固定顺序明细可直接游标分页，避免百万 OFFSET。
6. Redis 缓存 30–120 秒，缓存键包含 tenant、用户权限版本、筛选、profile、币种和数据版本。
7. 全局总览优先预汇总，CSV/Excel 不通过 Web 一次加载全部行。
8. 慢 SQL 使用 EXPLAIN ANALYZE 与 performance_schema；检查实际扫描行、排序临时表、分区、索引命中，不只看耗时。
9. 导出与回补限制并发，避免挤占在线 API 的连接池和内存。
10. 热历史保留期与业务确认后决定；180 天归因回补要求不得被提前归档破坏。

广告层聚合补充：日报/小时先按 `fact_ad_*` 聚合到广告，再通过有效期映射聚合到 Minis、Campaign、账户；禁止同时把 `fact_ad_minis_day`、`fact_campaign_minis_day` 和 `fact_account_day` 相加。账户层规范事实只用于对账和缺口检测。对一广告一 Minis 的约束做每日完整性检查，发现一广告多 Minis、无 Minis 或映射变更时暂停对应 Minis 汇总发布并报警。

容量例子只是规划假设：如果实测每行连索引约 0.5–1KB，则 1000 万行约 5–10GB；不同字段和索引可能明显改变结果。还需独立估算小时数据、索引、备份、binlog、暂存响应和增长余量，不能拿该例子当采购配置。

目标建议：30 天总览 P95 <2秒，系列列表 P95 <3秒。**这是验收目标，没有实际压测结果。**压测至少覆盖 1000 万行、热点账户偏斜、多用户并发、冷热缓存、同步回补与导出同时运行，记录数据库内存/CPU/IO 和扫描量。

如果经过日期限制、预汇总和索引优化，仍存在大范围任意维聚合瓶颈，再接 ClickHouse：MySQL 保留授权与业务关系，事实通过 outbox/CDC 或已发布批次复制到分析库。回补有版本与去重规则，避免将 ClickHouse 当简单追加日志后产生重复统计。

## 7. 同步任务与一致性

### 7.1 任务计划

| 任务 | 建议频率 | 窗口/说明 |
| --- | --- | --- |
| BC、账户、系列元数据 | 每日，授权后立即执行 | 资产分页、权限变化、名称状态 |
| 今日账户/Campaign小时 | 15–30分钟 | 每个请求最多1天；可配置频率并遵守限流 |
| 今日规范日报/Minis日报 | 30–60分钟 | 只请求验证通过的指标组合 |
| 近7天日报回补 | 每日平台修正后 | 处理常见迟到归因；不代表历史已冻结 |
| D8–D32 | 日或周批次 | 对相应归因窗口仍可变化的数据回补 |
| D33–D180 | 分批轮转，每周覆盖一次起步 | 仅适用于官方声明180天且实际启用的 profile，按窗口拆请求 |
| 赔付历史 | 每日 | 近60天，保留账户本地 record_date |
| 长期历史初始化 | 低优先级、限并发 | 与今日任务分离，逐日/窗口检查覆盖 |

32/180 天应根据每个指标的官方口径配置，不能对所有字段盲目统一。Native Growth 未经确认不自动归到 Minis 180 天清单。回补频率按账户数、限流、数据变化实测调整。

### 7.2 完整分页后发布

仅依赖逐页 upsert 不够：第一页成功、第二页失败会形成半份报表；新响应不再出现旧行，单纯 upsert 会留下过期数据。

采用下面的批次协议：

1. sync_task 固定 tenant、账户集合、profile、时间窗口与 generation。
2. 获取租约锁，带 fencing/version，防旧任务结束后覆盖新结果。
3. 全部分页落暂存表/批次区，校验页数、维度与响应成功；记录 request_id。
4. 所有页成功后按单账户/单日等可控窗口，在事务内替换该窗口规范事实，处理新批次未返回的旧行。
5. 原子更新 report_coverage 为已发布版本；失败保持之前完整版本，并暴露同步失败。
6. 重算受影响汇总，清理缓存；前端显示最新完整版本时间。
7. 大窗口拆小窗口发布，避免巨型事务；任何跨窗口筛选显示覆盖与版本，不冒充同一瞬时快照。

数据库网络失败、API 限流按官方 code 分类处理，指数退避加随机抖动；权限错误转入待重新授权，不无限重试。Token 日志脱敏。限流必须按官方应用/接口限制和实测配置，不能仅给每个连接独立配额。

### 7.3 异步报表

首版使用同步报表。出现请求成本、响应时间或窗口大小问题时，再评估 /report/task/create/、/report/task/check/、/report/task/download/ 等官方异步流程并核验当前权限。官方指出部分异步能力可能需要 allowlist，**不作为首版必有能力**。

异步与同步仍使用相同 profile、完整发布协议和去重粒度，不能下载后绕过规范化校验。

## 8. Java 工程、内部接口与前端

### 8.1 独立工程结构

    tiktok-reporting/
      backend/
        report-api             REST、登录、权限、报表查询
        report-core            DTO、profile、领域和口径
        report-tiktok          OAuth、API client、限流、解析
        report-sync            任务编排、分页、回补、发布
        report-export          流式导出、文件存储
        report-worker          独立任务进程
        migrations             Flyway
      frontend/                plus-ui + 自有报表页面
      deploy/                  Compose、反代、环境变量模板
      docs/                    指标字典、接口契约、对账记录

API/Worker 共用领域与数据访问模块，按不同入口启动；初期无需拆 6 个微服务。框架系统模块按官方模块组织保留，仅新增业务边界。

### 8.2 内部 REST API

| 接口 | 用途 |
| --- | --- |
| GET/POST /api/legal-entities | 主体维护与核验 |
| GET /api/tiktok/bcs | 4个BC及权限/状态 |
| POST /api/tiktok/oauth/authorize | 返回授权URL；发起人必须已登录 |
| GET /api/tiktok/oauth/callback | state校验、换Token，返回成功/失败页面 |
| GET /api/tiktok/connections | 授权状态；不返回Token |
| POST /api/tiktok/connections/{id}/discover | 异步发现BC与账户 |
| GET/PATCH /api/tiktok/advertisers | 账户列表、启用、主体和主BC映射 |
| GET /api/reports/overview | 去重总览 |
| GET /api/reports/trend | 日/月，按profile选择规范数据源 |
| GET /api/reports/hourly | UTC账户/Campaign小时 |
| GET /api/reports/campaigns | 系列列表、服务端排序分页 |
| GET /api/reports/campaigns/{id} | 系列趋势、Minis明细 |
| GET /api/reports/minis | Minis日报及月聚合 |
| GET /api/reports/bid-protection | 本地record_date赔付记录 |
| POST /api/exports | 创建导出任务 |
| GET /api/exports/{id} | 状态、行数、短期下载地址 |
| GET /api/sync/runs | 任务、覆盖、request_id、错误 |
| POST /api/sync/backfills | 授权管理员补数、限窗口 |

共用 ReportFilter：entityIds、bcIds、advertiserIds、campaignIds、minisIds、startDate、endDate、granularity、currency、metricProfile、assignmentMode、includeShared、cursor、limit。

示例：GET /api/reports/hourly?date=2026-10-14&bcIds=BC_ID&granularity=hour&metricProfile=delivery_utc。

接口响应至少包含 data、currency、timeBasis、metricProfile、lastSyncedAt、coverage、warnings、nextCursor。服务端从登录用户计算 tenant 和可见账户范围；不信任客户端传入 tenantId/账户列表。所有导出沿用相同权限逻辑；生成与下载时都再次校验权限。

### 8.3 页面规划

- 全局筛选：公司主体 → BC多选 → 广告账户多选，币种、UTC日期、口径。
- 总览：消耗、展示、点击、通用转化，兼容时显示IAA/IAP收入和ROAS；指标卡注明口径。
- BC对比：主归属视图可相加；包含共享账户视图提示共享数量与全局去重。
- 账户列表：主体、BC、ID/名称、币种、账户时区、授权/同步状态。
- Campaign：列表 → 系列详情 → Minis日报。
- Minis：按minis_id分组，名称显示与来源；不同profile禁止混算。
- 分时：24小时轴，当前小时进行中，未来空值，明确没有原生Minis小时。
- 赔付：资格状态、历史记录、金额、币种、本地日期，单独筛选日期口径。
- 管理：主体/归属、授权、任务日志、覆盖、补数、导出中心、角色权限。

图表不请求千万条明细；前端只接聚合点和分页结果。ID 全部字符串，日期不能依赖浏览器默认时区；金额计算在后端，前端仅格式化。

## 9. 导出设计

CSV 小数据允许流式输出；默认创建可追踪任务。Excel 使用 Apache POI SXSSF 等流式方式，限制行数与样式，避免完整加载内存。

导出列：主体公司名称、BC/主归属标识、账户ID/名称、币种、UTC日期/小时、Campaign、Minis、profile、消耗、展示、点击、转化、对应IAA/IAP事件/收入/ROAS、同步时间。赔付导出使用独立本地记录日期字段。

XLSX 单sheet最多1,048,576行；百万级按sheet/文件拆分，千万级推荐多份CSV + ZIP + manifest（筛选、口径、覆盖、总行数、时间与版本）。不生成无限单文件Excel。

CSV 使用 UTF-8 BOM；处理 =、+、-、@ 等公式注入；ID列按文本保存。历史大导出使用结果快照/已发布批次，避免边分页边回补导致重复或漏行；文件私有存储，签名URL短期有效，自动清理。

## 10. 部署与权限

建议独立子域名 reports.azureskys.com；若该子域名尚未配置，需独立完成DNS与HTTPS，不能宣称已可用。候选回调地址：https://reports.azureskys.com/api/tiktok/oauth/callback，需与开发者平台登记完全一致。

沿用服务器既有 Caddy 入口时追加站点配置并先校验，避免占用另一套80/443服务；新服务使用独立Compose项目、网络、数据库和文件卷。API与Worker仅内网暴露，数据库/Redis不直接开放公网。

权限角色：超级管理员、BC负责人、报表查看者、财务赔付查看者。接口、导出、缓存均应用账户数据范围。归属维护与授权操作有审计。OAuth Token AES-256-GCM 加密，密钥独立于数据库并带版本；App Secret放服务器密钥配置，不入Git、不进前端。

备份覆盖数据库、密钥恢复策略、导出策略与任务状态；上线前演练恢复。监控API业务失败、Token失效、窗口缺失、同步延迟、慢SQL、任务积压、导出失败和磁盘容量。服务器规格按实测采购，不承诺同现有项目共机必然满足要求。

## 11. 实施阶段和验证

| 阶段 | 产出 | 验收 |
| --- | --- | --- |
| API验证 | 4BC资产矩阵、字段/口径清单、UTC测试请求 | 确认可访问账户、公司字段来源、Minis和Native Growth兼容矩阵 |
| 工程基础 | 独立仓库、固定框架版本、迁移、权限、授权与关系模型 | 重复授权不重复账户；共享账户全局去重；Token不泄露 |
| 同步与查询 | 账户/Campaign日小时、Minis日、回补、批次发布、预汇总 | 分页失败不污染已发布报表；重跑幂等；消失旧行处理正确 |
| 页面与导出 | 总览、BC对比、下钻、赔付、导出中心 | 权限一致；币种隔离；CSV/Excel正确；未来小时不显示0 |
| 性能与上线 | 1000万行样本、索引计划、压力测试、HTTPS、备份监控 | 达到约定P95；回补/导出并行可用；恢复演练完成 |

UTC对账至少覆盖UTC0、UTC+8和负偏移账户，选择00:00边界、23:00边界、无投放时段、当日进行中、历史已删除系列和不同币种。Minis与规范日报的归因差异必须能解释。

首版实施前仍需真实Token验证：应用权限、4BC资产与共享关系、公司主体字段、minis_name取得方式、Native Growth指标组合、UTC起止边界、赔付记录键。没有这些验证，不把方案中的条件能力当作现成可用结果。

## 12. Ultimate 频控实现

你提供的开发者平台等级为 **Ultimate**。官方频控按**开发者应用全局**计算，不是按 BC、Token 或 Worker 各自拥有一套额度；Ultimate 的全局上限为 **50 QPS、3,000 QPM、4,320,000 QPD**。应用启动时将限额作为配置版本保存，不能在代码中硬编码成每个 BC 各自拥有一套额度。端点级限制若低于全局限制，始终取端点级限制。

实现采用 Redis 全局令牌桶 + 持久任务队列：

1. key 使用 `tiktok:rate:{app_id}:global`，所有 API Worker 共享；另为端点组保留 `tiktok:rate:{app_id}:{endpoint_group}`，有端点级限制时取更小值。
2. 令牌按 QPS 速率补充，QPM/QPD 用 Redis 滑动窗口或计数器；QPD 在 00:00:00 UTC 重置。每次请求在发送前同时检查全局、端点、Token/账户并发预算。
3. 报表分页、元数据、赔付和导出任务进入不同优先级队列；日报/小时刷新不能挤占授权和失败回补队列。批量请求多个账户/对象，避免逐广告单独请求。
4. 并发以应用级上限起步（Ultimate 建议保守配置 12 个报表 Worker，单请求间隔由令牌桶控制），根据实际端点错误率和压测上调；Worker 数不是官方额度。
5. HTTP 429 或业务 code 40100 先按返回信息、请求速率和本地计数判断命中的是 QPS、QPM、QPD 还是端点限额：QPM 按官方要求暂停对应接口 5 分钟，QPD 暂停至下一 UTC 日，QPS/端点限额降低并发并退避；无法判断时先暂停对应接口并告警，禁止立即无限重试。网络 5xx 单独使用有上限的指数退避 + 抖动。
6. 记录 endpoint、app_id、BC、advertiser_id、request_id、HTTP/code、重试次数、等待时长和当前配额估计；前端显示限流等待而不是误报“账户无数据”。

首版建议配置：官方上限记录为 `global_qps=50`、`global_qpm=3000`、`global_qpd=4320000`；实际令牌桶先按 80% 安全预算运行，即 `runtime_qps=40`、`runtime_qpm=2400`、`runtime_qpd=3456000`、`report_concurrency=12`。这组 runtime 值是工程保守值，不是 TikTok 官方上限；稳定运行并确认端点限制后再逐步提高。异步报表的端点级限额独立校验，不能套用同步报表额度。

## 13. 最终推荐

用 RuoYi-Vue-Plus + plus-ui 快速建立独立权限底座；TikTok业务采用稳定账户事实、BC/主体有效期映射、UTC与归因profile隔离、完整批次发布。数据库先用MySQL8.4分区索引和预汇总承载千万级，再依据真实压测决定是否引入ClickHouse。

首版优先完成4BC授权与去重、广告层规范日报/小时、按一广告一 Minis 绑定聚合、账户/Campaign 对账、Minis日报、日期筛选、导出；收入/ROAS与赔付按已验证能力启用，不把原生 Minis 小时、剧集完播用户数和审核赔付转化数作为 TikTok Reporting API 可直接取到的字段。Mini Drama 内行为另接自有埋点后再进入健康度看板。

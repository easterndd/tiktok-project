# TikTok Minis（Mini Dramas）开发者文档本地摘要

> 文档用途：为本项目后续开发、配置、发布和运营 TikTok Mini Drama（TikTok Minis）时提供可检索的本地速查依据。
>
> 来源：TikTok for Developers 官方文档。主流程页最后更新于 **2026-08-04**；其余规则以所链接的官方页为准。本文是准确的工作摘要，不替代官方协议、审核页面或 API Reference。涉及审核、地区准入、费率和结算时，必须重新打开官方页确认实时要求。

## 1. 范围与术语

- **TikTok Minis**：运行在 TikTok App 内 WebView 中的轻量 Web 应用；Mini Drama 是其短剧类产品形态。
- 技术模型应理解为：`Web App + 客户端 JSAPI + CLI 工具链`，而非传统小程序运行时。
- Web 项目包含 `index.html`、前端框架代码和编译产物；TikTok 客户端能力通过全局 `window.TTMinis` 暴露。
- 本文以 Mini Drama 为主。官网中文首页还包含 Mini Games、登录与身份、内容发布、内容展示、研究与洞察、TikTok GO 等产品领域；这些是独立产品线，不能把其 API、审核或发布规则默认套用于 Minis。

## 2. 官方端到端流程

| 阶段 | 必须完成的动作 | 产出/通过条件 |
| --- | --- | --- |
| 账号注册 | 创建组织；在组织下创建 Mini Drama App | 组织和 App 已在 Developer Portal 中建立 |
| 合规审核 | 企业认证；行业资质审核；如在美国上线，申请美国准入 | 组织可作为合规 Mini Drama 发行方上线 |
| App 设置 | 填写并提交基本信息；配置开发环境；可选本地化；可选开通变现 | App 级信息获批，必要配置齐全 |
| 开发与调试 | 本地开发 H5 项目；集成所需 TikTok 能力；本地构建、校验、打包并调试 | 可上传的、通过扫描要求的 ZIP 包 |
| 发布 | 上传预览版本；TikTok 内预览；提交审核；生产或灰度发布 | 用户可访问的线上版本 |
| 发布后 | 管理结算报表；确认结算；提交发票；跟踪打款 | 收入和发票流程完成 |

官方主流程：<https://developers.tiktok.com/docs/en/tiktok-minis-integration-workflow>

## 3. 账号与组织

### 3.1 创建组织

1. 注册 TikTok for Developers 账号，进入 **Developer Portal**。
2. 进入 **My organizations**，选择 **Create organization**。
3. 用企业法人实体的全称命名组织。该名称会展示给 TikTok 用户，**创建后不能修改**。
4. 在 **Members** 添加成员：
   - `Member`：可访问组织的 App 与资源，但不能管理组织或成员。
   - `Admin`：可管理成员、App 与资源；组织创建者自动为 Admin。

### 3.2 创建 App

1. 进入 **Manage apps**，点击 **Connect an app**。
2. 选择所属组织，填写 App name，并选择 Mini App 对应类型。
3. 此 App 是后续填写资料、配置安全项、上传代码、发布和运营的承载单元。

官方页：<https://developers.tiktok.com/docs/en/perpare-your-developer-account>

## 4. 合规与地区准入

### 4.1 企业认证（发布和变现的前置条件）

企业认证对发布 Mini Games / Mini Dramas，以及使用变现能力均为必需。仅组织 Admin 可操作。

提交的主体信息必须与合同中的法人实体一致，否则可能影响后续结算。需要电子化材料，至少准备：

- 企业营业执照、公司注册证明或同等商业登记文件。
- 主要负责人或法定代表人的政府签发带照片身份证件。
- 负责人有权代表企业的授权证明。

企业登记材料须能对应以下信息：中英文法定企业名、注册号、地址、法定代表人姓名。若单个文件信息不全，官方允许合并多个证明文件为一个 PDF。

官方页：<https://developers.tiktok.com/docs/en/verify-your-business>

### 4.2 行业资质审核（一次性组织审核）

行业资质审核用于确认组织是合法 Mini Drama / Mini Game 发行商，前提是已完成企业认证。Mini Drama 需提交：

- 公司介绍：成立时间、主营业务、人员构成、官网及补充材料等。
- 代表性短剧在其他应用平台的可播放链接。
- 若短剧链接的权利主体与已认证企业主体不同，提交两者主体一致/关联的身份证明。
- 如已对接 TikTok for Business Customer Manager，可提供其邮箱。

材料越完整越利于审核；获批后组织才具备启动应用上线的资质。

官方页：<https://developers.tiktok.com/docs/en/industry-qualification-review>

### 4.3 地区规则

- 首次发布和后续发布均应检查目标地区要求。
- **美国上线需要 TikTok 批准**；不能因 App 已通过一般审核而假设可在美国发布。
- 官方主流程引用的是美国数据访问合规说明；站点导航另有美国及 EU/UK 上线审批页。实际投放地区前应以实时页面为准。

官方页：<https://developers.tiktok.com/docs/en/data-access-compliance-requirements>

## 5. App 基本信息与审核素材

发布前，Developer Portal 的 **Basic information** 必须提交并获批。缺失或不完整的基本资料可造成登录和授权错误。

### 5.1 必填信息及硬性限制

| 字段 | 官方要求 |
| --- | --- |
| App icon | PNG/JPEG/JPG/BMP；`600 x 600 px`；不超过 `6 MB`；不得有圆角、水印、二维码、侵权或违法内容；图像需清晰，不得含敏感/不当内容，不得与知名品牌图标混淆，且应与名称或品牌一致。 |
| App name | 不超过 `50` 字符；不得包含敏感词或成人、赌博、暴力、毒品、恐怖主义等有害内容；不得仿冒知名 App（包括 TikTok 的变体）；应与描述一致。 |
| Description | 面向用户说明短剧用途和工作方式；不超过 `500` 字符；须符合 Community Guidelines 和 Developer Terms of Service。 |
| Terms of Service URL | 对用户展示在 Mini Drama 加载页的官方服务条款链接。 |
| Privacy Policy URL | 对用户展示在加载页的隐私政策链接。 |
| Service domains | 从上述条款与隐私政策 URL 中提取、并填写平台拥有的域名。 |
| 最低 SDK 版本 | 在 Portal 中选择要使用的 TikTok Minis SDK 版本。 |
| 发布地区 | 按实际可发布区域配置，并服从地区准入审核。 |

还应按页面要求补充版权/内容及开发者信息。基本信息审核重点包括安全基线、品牌一致性、知识产权和社区规范。

官方页：<https://developers.tiktok.com/docs/en/tiktok-minis-basic-information-specifications>

## 6. 开发环境与安全配置

在 App 的 **Development configuration** 中配置：可信域名、安全限制、Webhook 和 URL 所有权验证。

### 6.1 受信任域名（必须）

- 运行时仅允许向已登记的可信域名发起网络请求；未登记域名会被 TikTok 客户端拦截。
- 必须覆盖 App 实际会访问的全部网络域名。
- 域名必须以 `https://` 开头，**不能**包含通配符或路径。
- 最多可添加 `20` 个域名。
- Portal 路径：Development configuration -> **Security** -> Add domain -> Save changes。

### 6.2 Webhook

- 在 **Webhooks** 中填回调 URL，用于接收 TikTok 事件，例如支付交易事件。
- 点击 **Test URL** 后，TikTok 会在点击发送时向该回调地址发起 POST 测试请求。
- 必须先确认服务正确接收测试请求，再保存配置。

### 6.3 URL 所有权验证

所有放入 App 配置的 URL 都要验证；Link Sharing、Content Posting API 等功能可能先要求 URL 已验证。

1. Development configuration -> Webhooks -> **Verify properties**。
2. 选择 **Domain**（域名/子域名）或 **URL prefix**（完整 URL）验证方式。
3. 下载 Portal 提供的签名文件并上传到待验证 URL 指定位置，完成验证。

官方页：<https://developers.tiktok.com/docs/en/set-up-development-configuration>

## 7. 本地开发、调试与能力接入

### 7.1 运行和构建模型

- 开发基于 H5/Web 技术，业务页面、Playground 调试页和 TikTok 手机端构成相互关联的本地调试层。
- 客户端能力由 `window.TTMinis` 接入；业务 Web 代码本身不直接实现这些客户端能力。
- 先独立构建 Web 项目，再运行 `minis build` 对产物执行平台校验和打包，然后上传 Developer Portal。
- 将已有其他平台小程序的概念直接迁移过来容易出错；以 Web App 的方式组织工程、CORS、域名、打包和客户端 JSAPI。

### 7.2 接入前配置清单

- Basic information 中的必填项目、Privacy Policy URL、Terms of Service URL 均已填写。
- 所有业务请求域名均在 Portal allowlist 中，否则客户端会拦截跨域请求。
- 若使用变现，先完成变现开通、签署所需协议并获得 TikTok 批准，再在项目中接入相关 API。

### 7.3 认证与服务端能力

- 发布代码扫描要求实现 **TikTok Login API**。
- 详细客户端 API 以 TikTok Minis SDK 为准；服务端能力另有 Minis Server APIs，包括 OAuth、用户数据、支付、订阅和错误码等。
- API 需求应采用最小权限原则；不要把通用 TikTok 产品的 scope 或 API 假定为 Minis 可用。

官方页：<https://developers.tiktok.com/docs/en/tiktok-minis-develop-your-mini-app>  
SDK：<https://developers.tiktok.com/docs/en/minis-sdk-get-started>  
服务端 API：<https://developers.tiktok.com/docs/en/minis-server-apis-overview>

## 8. 变现与收款账户

### 8.1 开通流程

1. 企业必须先通过验证；仅组织的注册 Admin 可完成变现设置。
2. 到组织级 **Monetization** 页面，在 Overview 的 **Feature enablement** 中选择需要的功能。
3. Mini Drama 可选两种能力：
   - `IAP`：应用内购买。
   - `IAA`：应用内广告。
4. 审阅并签署该能力的协议，随后才可接入对应变现 API。
5. 一次只能开通一种变现能力；平台审核通常需要 `1-2` 天，并通过邮件与 Portal 通知结果。
6. 已开通能力适用于该组织下的全部 Mini Apps。

### 8.2 Payout setup

至少开通一项变现能力后，提交企业、税务、银行信息来建立收款账户。未完成前，收入会保留在余额中而不会支付。所需信息随企业注册国家或地区不同而变化。

官方页：<https://developers.tiktok.com/docs/en/enable-monetization-features>  
概览：<https://developers.tiktok.com/docs/en/monetization-overview>

## 9. 发布操作与硬性校验

### 9.1 提交审核前置条件

- 组织已完成企业认证。
- 组织已通过行业资质审核。
- App 基本信息已提交并获批。
- 已接入全部必需能力。

### 9.2 上传代码包

- 上传文件必须是 **ZIP**，最大 **200 MB**。
- 必须包含目录中的全部文件，且不能有 `0 byte` 空文件。
- 必须实现 TikTok Login API。
- 动态导入脚本来源必须受限，不能借此绕过平台审核或任意更新代码。
- 运行时 API 请求来源必须受限；只有本地配置文件中声明的域名可成为有效请求目标。
- 上传入口：App -> **Code version** -> **Upload code asset**。可添加仅供内部识别的备注。
- 上传后成为 Preview 版本；最多保留 **30 个 Preview 版本**。

### 9.3 在 TikTok 中预览

1. 先添加测试用户。
2. 在版本卡片点击 **Preview**，获取预览二维码。
3. 用测试用户对应的 TikTok 账号扫描二维码。

### 9.4 提交版本审核

- 在代码版本卡片点击 **Submit for review**。
- 选择审核通过后的发布方式：
  - **Release manually**：审批后由开发者选择发布时间和发布类型。
  - **Automatically release after approval**：批准后立即自动发布。
- 选择发布类型：
  - **Push to production**：向全部 TikTok 用户发布；首次发布只能选生产发布。
  - **Gray release**：向一定比例用户发布；必须已有生产版本，且新灰度比例必须大于当前发布比例。
- 提交后版本进入 **In-review**。审核会交叉核对 App Basic Information，且 App 必须兼容英语才能通过审核。

### 9.5 审批后发布与灰度规则

- 审批通过后状态为 **Ready For Release**。
- 手动发布模式需点击 **Release**；自动模式会直接发布。
- 最多同时有两个已发布版本：一个生产版本和一个灰度版本。
- 生产版本必须保持在线，才能让 App 持续可访问；首次上线只能发布到生产环境。
- 最多一个灰度版本在线，并与生产版本共享流量。
- 灰度流量变化会自动调整生产版本流量，二者总和始终为 `100%`。

官方页：<https://developers.tiktok.com/docs/en/tiktok-minis-release-your-mini-app>

## 10. 收入结算、发票和打款

### 10.1 结算报表

前提：至少启用并配置一项变现功能，且已提供企业、税务和银行信息建立 Payout account。

路径：**My organizations** -> 组织 -> **Monetization** -> **Revenue**。可查看、下载或就报表申诉，并按付款状态、交易周期和收入流筛选。收入流包含：

- IAP 订阅。
- IAP 非订阅。
- IAA。

| 收入类型 | 结算频率 | 报表提供时间 | 付款条件 |
| --- | --- | --- | --- |
| IAA | 每半月 | 交易期结束后第 5 天；交易期为每月 1 日和 15 日截止 | TikTok 收到有效发票后 15 日内支付 |
| IAP | 每月 | 每月 15 日 | TikTok 收到有效发票后 15 日内支付 |

Revenue 页的 **Total settled revenue** 是已处理、可审核确认的总额，以 USD 显示，仅反映线上版本产生的收入。

官方页：<https://developers.tiktok.com/docs/en/manage-revenue-settlement>

### 10.2 发票与付款

前提：已启用变现、设立收款账户、审阅并确认结算报表。

路径：组织 -> **Monetization** -> **Payouts** -> **To be invoiced**。

1. 选择未支付且未申诉的结算报告。发票最低金额为 **100 USD**。
2. 上传发票并填写唯一发票号。
3. 发票必须满足：
   - 发票金额等于所选结算报表合计金额。
   - 发票上的组织名与合同中的组织名相同。
   - 发票日期晚于结算完成日期。
   - PDF，且小于 **10 MB**。
   - 发票号码在该收款账户全部历史记录中唯一。
4. 提交后进入内部审核；从提交到付款通常约 **15 天**，具体到账可能再受银行和地区影响，额外需 `3-5` 个工作日。

官方页：<https://developers.tiktok.com/docs/en/process-invoices-and-payouts>

## 11. 工程执行检查清单

- [ ] 已创建不可更名的组织，组织名与企业法人实体一致。
- [ ] 已建立 App，管理员与成员权限分配正确。
- [ ] 企业认证材料、合同主体、收款主体一致。
- [ ] 行业资质审核已通过，代表性短剧链接和主体证明可追溯。
- [ ] 所有 Basic information 均已提交并获批；图标、名称、描述、条款和隐私链接符合限制。
- [ ] App 实际网络请求域名已全部登记，且均为 HTTPS、无路径/通配符、总数不超过 20。
- [ ] Webhook 能接收 Portal 的 POST 测试事件；需验证的 URL Property 已完成验证。
- [ ] 前端通过 `window.TTMinis` 集成所需客户端能力；服务端按 Minis 专用文档接入。
- [ ] 已通过 `minis build` 完成产物校验和打包。
- [ ] ZIP 不大于 200 MB、没有空文件、实现登录 API、动态脚本和运行时请求来源均受限。
- [ ] 测试用户已添加，已用测试账号扫描预览 QR 并完成端内验证。
- [ ] 首发选择生产发布；后续灰度遵守已有生产版本、比例递增和总流量 100% 规则。
- [ ] 若变现，功能审批、协议、收款账户、结算确认和发票规则均已完成。

## 12. 官方入口地图

- 中文开发者文档首页：<https://developers.tiktok.com/docs/zh-Hans/welcome>
- Mini Dramas 主入口：<https://developers.tiktok.com/docs/zh-Hans/mini-dramas-landing>
- 集成主流程（英文，当前引用的完整流程页）：<https://developers.tiktok.com/docs/en/tiktok-minis-integration-workflow>
- SDK：<https://developers.tiktok.com/docs/en/minis-sdk-get-started>
- 服务端 API：<https://developers.tiktok.com/docs/en/minis-server-apis-overview>
- Developer Portal：<https://developers.tiktok.com/portal>

## 13. 维护建议

对本地项目而言，应把本文件当作“流程与约束索引”，而非把时效性强的外部规则硬编码进业务逻辑。以下内容最容易更新，开发前或发布前应回查官方页面：SDK 最低版本、审核准入地区、可用变现功能、协议文本、API 参数/错误码、结算日期、费率、发票和税务要求。

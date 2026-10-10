# TikTok 广告报表网站完整实现方案

## 1. 目标与范围

建设一个与当前短剧项目完全独立的 Web 应用，只接入 TikTok API for Business 的 Reporting API，完成：

- OAuth 授权一个或多个 TikTok 广告账户；
- 每日消耗、展示、点击、转化趋势；
- 按广告系列下钻查看日报数据；
- 日期筛选；
- CSV 导出；
- 定时同步、手动补数、同步失败重试和同步日志。

首版不接入当前项目的用户、广告收入、短剧、素材或现有后台数据库。项目应有独立代码仓库、独立数据库、独立部署地址和独立环境变量。

## 2. 官方 API 依据

### 2.1 授权

使用 TikTok Marketing API OAuth：

1. 用户在网站点击“连接 TikTok 广告账户”；
2. 后端生成 TikTok 授权地址，并带上 `app_id`、回调地址和所需权限；
3. TikTok 回调 `code` 到网站；
4. 后端服务端调用：

```http
POST https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/
Content-Type: application/json
```

请求体包含 `app_id`、`secret`、`auth_code`。`app_id` 和 `secret` 只放在后端环境变量中，不能放入前端代码。

授权完成后保存 TikTok 返回的 `access_token`、用户标识和广告账户列表。Access Token 需要加密保存，并提供“断开账户”和“重新授权”能力。权限不足、用户撤销授权、接口返回无权限时，前端应显示重新授权入口。

官方文档：[Marketing API Authentication](https://business-api.tiktok.com/portal/docs/marketing-api-authentication/v1.3)

### 2.2 获取可授权的广告账户

授权成功后调用官方的 advertiser 查询接口获取用户可以访问的广告账户，并让用户勾选需要纳入报表的账户。数据库中只保存选择结果，后续同步只针对已启用账户。

建议保存：`advertiser_id`、账户名称、账户时区、币种、账户状态和最近同步时间。

### 2.3 同步报表

首版使用同步报表接口：

```http
GET https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/
Access-Token: {access_token}
```

每日趋势和广告系列下钻使用 `report_type=BASIC`、`service_type=AUCTION`。推荐的日报请求如下：

```
advertiser_id={ADVERTISER_ID}
service_type=AUCTION
report_type=BASIC
data_level=AUCTION_CAMPAIGN
dimensions=["campaign_id","stat_time_day"]
metrics=["campaign_name","spend","impressions","clicks","conversion"]
start_date=2026-01-01
end_date=2026-01-30
page=1
page_size=1000
```

实际可用的转化指标取决于账户目标、事件和 Reporting API 报表类型。后端应把指标列表做成配置，并在上线前依据官方 Basic Report 的 metrics 列表确认 `conversion`；不能把 TikTok Ads Manager 中自定义列名直接当成 API 字段。

官方文档：[Reporting Guide](https://business-api.tiktok.com/portal/docs/reporting-guide/v1.3) | [Run a synchronous report](https://business-api.tiktok.com/portal/docs/run-a-synchronous-report/v1.3)

## 3. 系统架构

```
浏览器
  │ HTTPS / Cookie 或 HttpOnly Session
  ▼
独立前端（Next.js + TypeScript）
  │ REST API
  ▼
独立后端（NestJS/Fastify + TypeScript）
  ├─ OAuth 服务
  ├─ TikTok API Client
  ├─ 报表查询服务
  ├─ 同步任务服务
  ├─ CSV 导出服务
  └─ 权限与审计服务
  │
  ├─ PostgreSQL：业务数据和报表事实表
  ├─ Redis：任务队列、分布式锁、短期缓存
  └─ 对象存储（可选）：大 CSV 文件和导出记录
```

推荐首版技术栈：

- 前端：Next.js、TypeScript、TanStack Query、Ant Design 或 shadcn/ui、ECharts；
- 后端：NestJS 或 Fastify、TypeScript、Zod、稳定的 HTTP 客户端；
- 数据库：PostgreSQL 15+、Prisma 或 Drizzle；
- 队列：Redis + BullMQ；
- 部署：Docker Compose 起步，生产环境使用托管 PostgreSQL、Redis 和 HTTPS 反向代理。

前后端可以放在同一个独立仓库，但不要复用当前短剧项目的应用包、数据库 schema、登录态或 API 路由。

## 4. 数据库设计

### 4.1 用户和授权

```sql
create table app_users (
  id uuid primary key,
  email text not null unique,
  password_hash text,
  created_at timestamptz not null default now()
);

create table tiktok_connections (
  id uuid primary key,
  user_id uuid not null references app_users(id),
  tiktok_user_id text,
  access_token_encrypted text not null,
  scopes jsonb not null default '[]',
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table advertiser_accounts (
  id uuid primary key,
  connection_id uuid not null references tiktok_connections(id),
  advertiser_id text not null,
  advertiser_name text not null,
  currency text,
  timezone text,
  status text,
  enabled boolean not null default true,
  last_synced_at timestamptz,
  unique(connection_id, advertiser_id)
);
```

### 4.2 报表事实表

把 TikTok 返回的字符串指标转换成数据库数值类型，同时保留原始响应，方便排查字段变化。

```sql
create table campaign_daily_reports (
  id bigserial primary key,
  advertiser_account_id uuid not null references advertiser_accounts(id),
  campaign_id text not null,
  stat_date date not null,
  campaign_name text,
  currency text,
  timezone text,
  spend numeric(20,6) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions numeric(20,6) not null default 0,
  raw_metrics jsonb not null default '{}',
  source_request_id text,
  synced_at timestamptz not null default now(),
  unique(advertiser_account_id, campaign_id, stat_date)
);

create index campaign_daily_reports_date_idx
  on campaign_daily_reports(advertiser_account_id, stat_date);

create table report_sync_runs (
  id uuid primary key,
  advertiser_account_id uuid not null references advertiser_accounts(id),
  start_date date not null,
  end_date date not null,
  status text not null,
  page_count integer not null default 0,
  row_count integer not null default 0,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
```

如果未来需要广告组和广告级下钻，再新增 `adgroup_daily_reports`、`ad_daily_reports`，不要改变首版 campaign 表的唯一键。

## 5. 后端 API 设计

所有网站 API 使用网站自己的会话认证；浏览器永远不直接调用 TikTok API。

### 授权

```text
GET  /api/auth/tiktok/start
GET  /api/auth/tiktok/callback
POST /api/auth/tiktok/disconnect/:connectionId
GET  /api/tiktok/advertisers
PUT  /api/tiktok/advertisers/enabled
```

`/start` 生成并保存 OAuth `state`，`/callback` 校验 `state` 后交换 token。授权回调不能接受缺少或不匹配的 `state`。

### 报表和同步

```text
POST /api/reporting/sync
GET  /api/reporting/sync-runs
GET  /api/reporting/summary?advertiserIds=&startDate=&endDate=
GET  /api/reporting/trend?advertiserIds=&startDate=&endDate=
GET  /api/reporting/campaigns?advertiserId=&startDate=&endDate=&page=&pageSize=&sort=
GET  /api/reporting/campaigns/:campaignId?advertiserId=&startDate=&endDate=
GET  /api/reporting/export.csv?advertiserIds=&startDate=&endDate=&scope=campaign
```

推荐返回结构：

```json
{
  "data": [
    {
      "date": "2026-01-30",
      "spend": "123.45",
      "impressions": 100000,
      "clicks": 2300,
      "conversions": 180,
      "currency": "USD"
    }
  ],
  "meta": {
    "startDate": "2026-01-01",
    "endDate": "2026-01-30",
    "lastSyncedAt": "2026-01-31T02:10:00Z"
  }
}
```

金额返回字符串或 decimal 序列化值，避免 JavaScript 浮点误差。跨账户汇总时，如果币种不同，默认分币种展示，不自动换算；如果确实需要统一币种，另建汇率表并明确汇率日期。

## 6. 同步服务实现

### 6.1 单账户同步流程

1. 从启用的 `advertiser_accounts` 取账户时区和币种；
2. 根据账户时区计算待同步的日期窗口；
3. 每次请求最多拉取 30 天的 `stat_time_day` 数据；
4. 使用 `page_size=1000`，根据 `page_info.total_page` 遍历所有页；
5. 将 `dimensions.campaign_id`、`dimensions.stat_time_day` 和 `metrics` 规范化；
6. 使用唯一键 upsert，允许重复同步同一天；
7. 记录 TikTok `request_id`、响应码、耗时和同步行数；
8. 失败时指数退避重试，最终失败写入 `report_sync_runs`。

伪代码：

```ts
async function syncCampaignDaily(account: AdvertiserAccount, from: string, to: string) {
  let page = 1;
  do {
    const response = await tiktok.get('/open_api/v1.3/report/integrated/get/', {
      headers: { 'Access-Token': decrypt(account.connection.accessTokenEncrypted) },
      params: {
        advertiser_id: account.advertiserId,
        service_type: 'AUCTION',
        report_type: 'BASIC',
        data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
        metrics: JSON.stringify(['campaign_name', 'spend', 'impressions', 'clicks', 'conversion']),
        start_date: from,
        end_date: to,
        page,
        page_size: 1000,
      },
    });

    assertTikTokSuccess(response);
    await upsertCampaignDailyRows(account.id, response.data.list);
    page += 1;
  } while (page <= response.data.page_info.total_page);
}
```

### 6.2 多账户和大数据量

Reporting API 的 `advertiser_ids` 一次最多 5 个，并且账户必须属于同一个 TikTok for Business 用户。首版建议按广告账户逐个同步，便于处理时区、币种和失败重试；账户数量增加后再对同一用户下的账户做 5 个一批的优化。

同步接口对单次请求最多返回 20,000 个广告的数据。如果以后改成广告级报表，必须按 `campaign_ids`、`adgroup_ids` 或 `ad_ids` 每批最多 100 个进行分批，不能只依赖分页。

### 6.3 回补和数据新鲜度

不要只同步昨天。定时任务每天同步最近 3 天或 7 天，并提供自定义日期补数。TikTok 报表存在延迟，页面显示“数据截至时间”和“最后同步时间”，不能把尚未完成的当天数据标记为最终值。

建议任务：

- 每小时：同步最近 3 天；
- 每天凌晨：同步最近 30 天；
- 用户手动补数：限制为最多 30 天一个任务；
- 失败重试：1 分钟、5 分钟、15 分钟、1 小时。

## 7. 前端页面

### 7.1 页面结构

```text
/login
/settings/tiktok                 连接和选择广告账户
/dashboard                       总览和趋势
/reports/campaigns               广告系列日报
/reports/campaigns/:campaignId  单个广告系列趋势
/sync-runs                       同步任务和错误日志
```

### 7.2 首屏总览

顶部提供：广告账户多选、日期范围、币种筛选、刷新按钮、导出 CSV 按钮。

指标卡：

- 总消耗；
- 总展示；
- 总点击；
- 总转化；
- CTR = 点击 / 展示；
- CPA = 消耗 / 转化（转化为 0 时显示 `-`）。

趋势图按日期展示消耗、展示、点击、转化。金额和数量使用不同 Y 轴或分图，避免数量级差异导致小指标看不见。

### 7.3 广告系列页

表格字段：广告系列名称、广告系列 ID、消耗、展示、点击、转化、CTR、CPA、币种、最后同步时间。点击行进入 `/reports/campaigns/:campaignId`，展示该广告系列的每日趋势和选定日期范围的明细。

表格支持服务端分页、排序和搜索。不要在浏览器加载全量历史数据后再分页。

### 7.4 CSV 导出

导出接口复用数据库查询条件，不重新调用 TikTok。CSV 必须包含 UTF-8 BOM、表头、账户 ID、币种、时区、日期、广告系列 ID、广告系列名称、消耗、展示、点击、转化。大于约 50,000 行时转为后台任务，将文件写入对象存储并返回短期下载地址。

## 8. 权限、安全和可靠性

- `app_id`、`secret`、Access Token、数据库密码只放服务端密钥管理或环境变量；
- Access Token 数据库加密，日志中脱敏；
- OAuth 使用一次性 `state`，校验回调来源和 state；
- 每个用户只能访问自己连接的账户和报表；
- 所有查询都带 `user_id` 过滤，防止越权；
- 对日期范围、账户 ID、排序字段和分页参数做 Zod 校验；
- 对 TikTok 返回的 HTML、名称等文本做前端转义，CSV 导出防止公式注入；
- 对 TikTok API 增加超时、限流、重试和熔断；
- 保存 `request_id`，便于与 TikTok 支持排查；
- 记录授权、账户启用、手动同步、导出等审计事件。

## 9. 同步报表与异步报表的边界

首版使用同步接口，因为查询窗口短、实现简单、能满足每日数据和广告系列下钻。同步接口在带 `stat_time_day` 时最多查询 30 天，分页上限为 1000，且有 20,000 广告限制。

出现以下情况时再评估异步报表：

- 用户需要一次导出数月或数年的广告级数据；
- 单账户广告数量接近或超过 20,000；
- 同步请求经常超时或触发限流；
- 需要与 Ads Manager 下载报表做大规模对账。

异步方案新增：创建任务、轮询任务状态、下载结果、保存文件、清理过期文件。官方文档注明异步报表可能需要 allowlist，因此应先确认账户是否已开通，不要在首版默认依赖。

## 10. 开发目录建议

```text
tiktok-reporting-web/
├─ apps/
│  ├─ web/                         # Next.js 前端
│  └─ api/                         # NestJS/Fastify 后端
├─ packages/
│  ├─ contracts/                   # Zod schema 和 API 类型
│  ├─ tiktok-client/               # OAuth、Reporting API client
│  └─ ui/                          # 可复用前端组件
├─ prisma/
│  └─ schema.prisma
├─ infra/
│  ├─ docker-compose.yml
│  └─ nginx/
├─ .env.example
└─ README.md
```

环境变量最少包括：

```text
APP_URL=
TIKTOK_APP_ID=
TIKTOK_APP_SECRET=
TIKTOK_REDIRECT_URI=
TOKEN_ENCRYPTION_KEY=
DATABASE_URL=
REDIS_URL=
SESSION_SECRET=
```

## 11. 分阶段交付

### 第 1 阶段：基础骨架

- 初始化独立仓库和 Docker 开发环境；
- 完成用户登录、数据库迁移和会话；
- 完成 TikTok OAuth 回调和 token 加密保存；
- 展示可访问广告账户并允许启用／停用。

### 第 2 阶段：报表同步

- 完成 Basic Campaign Daily 请求；
- 完成分页、重试、幂等 upsert 和同步日志；
- 定时同步最近 3 天；
- 提供手动补数。

### 第 3 阶段：报表前端

- 完成总览指标卡和每日趋势图；
- 完成广告系列表格、搜索、排序、日期筛选；
- 完成广告系列详情页；
- 完成 CSV 导出。

### 第 4 阶段：上线加固

- 多账户、时区、币种测试；
- OAuth 撤销和权限不足测试；
- TikTok 限流和超时测试；
- 数据与 Ads Manager 小范围人工对账；
- 配置 HTTPS、备份、监控和错误告警。

## 12. 验收标准

- 新用户可以完成 TikTok 授权并选择至少一个广告账户；
- 选择日期范围后，页面能展示消耗、展示、点击和转化日报；
- 广告系列合计与日报趋势合计一致；
- 重复同步不会产生重复行；
- 账户时区决定报表日期边界；
- 不同币种不会被静默相加；
- CSV 和页面筛选条件一致；
- TikTok API 错误时页面能看到可读的同步失败原因和最后成功时间；
- Access Token、App Secret 和用户数据不会出现在浏览器、前端 bundle 或普通日志中。


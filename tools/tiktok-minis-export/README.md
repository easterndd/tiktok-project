# TikTok Mini 广告报表 Excel 导出

此目录是独立的本机导出工具，不连接现有短剧后台或数据库。它调用 TikTok Marketing API v1.3 同步 Basic Report，按 `minis_id`、`advertiser_id`、`stat_time_day` 获取数据，并从 `/advertiser/info/` 获取账户名称。

## 前提

- 已创建 TikTok API for Business 应用并取得覆盖目标广告账户的有效 Marketing API `access_token`。
- 已知获授权的广告账户 ID。多个不同 TikTok for Business 用户授权后，只有同一 Token 实际有权访问的账户才能用一次命令导出；其他账户需用对应授权的 Token 分批运行。
- 本机 Node.js 20+，以及可用的 `@oai/artifact-tool` 依赖。本工作区 Codex 运行环境已包含该依赖。

## 运行

先在此目录创建到 Codex bundled `node_modules` 的本机目录联接（只需一次）：

```powershell
$deps = 'C:\Users\xy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
if (-not (Test-Path '.\node_modules')) { New-Item -ItemType Junction -Path '.\node_modules' -Target $deps }
```

在当前 PowerShell 会话配置 Token（不要写入仓库，也不要发到聊天）：

```powershell
$env:TIKTOK_BUSINESS_ACCESS_TOKEN = '<你的 Marketing API Access Token>'
node .\export.mjs --advertiser-ids 123456789,987654321 --start-date 2026-10-01 --end-date 2026-10-07 --output .\output\minis.xlsx
```

日期范围每次最多 30 天。脚本依次查询账户信息和报表分页，只有全部成功才保存 Excel。输出包含账户 ID、账户名称、币种、Mini ID、Mini 名称、日期、消耗、展示、点击、转化。账户 ID 与 Mini ID 在 Excel 中为文本，避免大整数精度丢失。不同币种的消耗不做合计。

若 TikTok 对目标账户不支持 `minis_name` 或某指标组合，脚本会显示原始 API 错误并停止，不会生成缺字段的表。请用已授权账户先做 1 天试调，再扩大日期范围。

官方依据：[Basic report supported dimensions](https://business-api.tiktok.com/portal/docs/basic-reports-supported-dimensions/v1.3)、[Basic report supported metrics](https://business-api.tiktok.com/portal/docs/basic-reports-supported-metrics/v1.3)、[Run a synchronous report](https://business-api.tiktok.com/portal/docs/run-a-synchronous-report/v1.3)、[TikTok SDK advertiser info](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AccountManagementApi.md)。

# CrownRush / SugarReel / CrimsonShorts 部署手册

> 本手册中的品牌专属法律页步骤已由 [10 个 Breeze 小程序部署步骤](./十个Breeze小程序部署步骤.md) 取代。三个应用现在与新增七个应用共用无品牌名的 `https://xuyins.com/static/privacy-policy.html` 和 `https://xuyins.com/static/terms-of-service.html`；以下旧 URL 表仅供历史核对，不可用于新审核。

本批应用复用 `apps/mini-web/src`、API/Worker 和管理后台，但各有独立的 TikTok App ID、Client Key/Secret、API 路由、PostgreSQL schema 和管理员。对照 [17 个应用手册](./17个TikTok小程序完整部署手册.md) 的备份、迁移、验收和回退流程执行；不要直接对现网运行本文件中的示例命令。

| Portal 名称 | key / schema | API 路径 | 环境前缀 | Mini 目录 |
| --- | --- | --- | --- | --- |
| CrownRush | `crownrush` | `/api/crownrush/v1` | `CROWNRUSH` | `apps/crownrush` |
| SugarReel | `sugarreel` | `/api/sugarreel/v1` | `SUGARREEL` | `apps/sugarreel` |
| CrimsonShorts | `crimsonshorts` | `/api/crimsonshorts/v1` | `CRIMSONSHORTS` | `apps/crimsonshorts` |

## 1. 法律页和域名

参考页是 [TriumphSeries 隐私政策](https://cjpcdn.xinghewanglu.com/static/triumphseries-privacy-policy.html) 与 [服务条款](https://cjpcdn.xinghewanglu.com/static/triumphseries-terms-of-service.html)。三个新品牌的内置页和静态导出采用参考页中的 `Breeze and Azure Sky Culture Limited`、香港注册地址和 `caijiarong@xuyins.com`，其余数据处理/托管描述沿用此仓库现有 Mini 的服务模型；**这不是法律审核，也不是对参考页多地区附录的完整复制**。参考页声明阿里云新加坡托管和部分香港/中国内地远程访问；本批生成页目前声明腾讯云美国硅谷托管，两者不能同时当作已核实事实。发布前由业务/法务依据实际部署核对并修改运营主体、邮箱、托管地区、远程访问、数据处理、面向市场和本地语言要求，再重新导出六页并重建三个 Mini。不要把旧 17 个应用的 SAGATHIYA 条款用于本批应用。

计划在 `xuyins.com` 的 HTTPS 静态站点部署 `deploy/website/static/` 下六个文件。Portal 各自填写：

| 应用 | Privacy policy URL | Terms of Service URL |
| --- | --- | --- |
| CrownRush | `https://xuyins.com/static/crownrush-privacy-policy.html` | `https://xuyins.com/static/crownrush-terms-of-service.html` |
| SugarReel | `https://xuyins.com/static/sugarreel-privacy-policy.html` | `https://xuyins.com/static/sugarreel-terms-of-service.html` |
| CrimsonShorts | `https://xuyins.com/static/crimsonshorts-privacy-policy.html` | `https://xuyins.com/static/crimsonshorts-terms-of-service.html` |

三者的 **Domain of your service** 计划填写 `https://xuyins.com`。`cjpcdn.xinghewanglu.com` 只是参考页来源，不是新应用的服务域名。Mini API 目前仍计划使用仓库已有的 `https://api.evergreenprosper.com/api/<key>/v1`，故 Portal **Trusted Domains** 需另列 `https://api.evergreenprosper.com`，不要用服务域名代替 API 域名。若要将 API 也迁移到 `xuyins.com` 子域名，必须先配置 DNS、TLS、反向代理、CORS 及对应 `.env`，再更换 Mini 和后台 URL。

当前 `xuyins.com` 无法从开发机解析；DNS 记录、TLS 和静态站点还未验收。先在腾讯云 DNS 控制台配置指向实际静态站点的记录，确保站点以 `/static/` 原样提供文件、不返回 SPA fallback，然后逐条检查 HTTP 200、`text/html`、正确品牌/主体且无需登录。**未通过前不要在 Portal 填写这些 URL 并提交审核。**

```powershell
$apps = 'crownrush','sugarreel','crimsonshorts'
foreach ($key in $apps) { pnpm --filter $key export:legal }
foreach ($key in $apps) {
  curl.exe -fIL "https://xuyins.com/static/$key-privacy-policy.html"
  curl.exe -fIL "https://xuyins.com/static/$key-terms-of-service.html"
}
```

## 2. 凭据与本地构建

三个 `minis.config.json` 的 `appId` 留空，**必须**从各自 Portal 填入真实数字并逐项核对；这不是可直接上传的发布包。为每个目录从 `.env.example` 复制 `.env`，填该应用的 Client Key。Client Secret 只能放服务器环境文件，不能放前端。广告位未创建时保持未设置，内容端不启用广告解锁。

单独运行 `pnpm --filter <key> build` 且没有 `.env` 时，Vite 会编入 `http://localhost:3000/api/<key>/v1` 默认值；这种本地构建仅用于代码检查，不可上传。发布构建必须用下方的 `build:minis:release`，并核对构建包里的 HTTPS API 地址、应用品牌和对应 Client Key。

```powershell
foreach ($key in $apps) {
  if (-not (Test-Path "apps/$key/.env")) { Copy-Item "apps/$key/.env.example" "apps/$key/.env" }
}
pnpm install --frozen-lockfile
pnpm -r lint
pnpm --filter api test
```

准备服务器时先核对现有 `/opt/quickreels`、Compose 类型、分支和工作树；只发布经审查的完整提交，不上传未提交文件。备份生产数据库及环境文件，检查现有 schema 是否已含数据，**不要删除/覆盖已有 schema 或运行生产 seed**。在 `.env.production` 为每个 key 写入各自 `*_DATABASE_URL`（同一数据库必须指定不同 schema）、`*_TIKTOK_CLIENT_KEY`、`*_TIKTOK_CLIENT_SECRET`、`*_TIKTOK_APP_ID`，以及 `VITE_*_API_BASE_URL`；示例变量名见 `.env.production.self-hosted.example`。只有配置数据库 URL 后对应路由才注册。用 `docker compose ... config --quiet` 校验，不打印 Secret。

随后按 17 应用手册第 5 至 9 节：备份、创建三个独立 schema、构建 API/Worker/Admin 镜像、逐个 `prisma migrate deploy`、逐个 bootstrap OWNER，再重建容器。验证 `/ready` 和三个 `/api/<key>/v1/albums` 均返回 200。每个 schema 初始内容为空，需按授权和上架流程分别验收播放。管理后台应能分别选择三个品牌且管理员 token 不能跨应用使用。

确认 API 已上线且有真实 App ID/Client Key 后，清除 PowerShell 会话中旧的 `VITE_API_BASE_URL`、`VITE_TIKTOK_CLIENT_KEY` 覆盖值，逐个执行：

```powershell
Remove-Item Env:VITE_API_BASE_URL, Env:VITE_TIKTOK_CLIENT_KEY -ErrorAction SilentlyContinue
foreach ($key in $apps) {
  pnpm --filter $key build:minis:release
  if ($LASTEXITCODE -ne 0) { throw "$key 构建失败" }
}
```

每个 `apps/<key>/dist/minis.config.zip` 只上传到同名 Portal Preview；真机检查首页、匿名会话、搜索、免费剧集、收藏/续播、内置法律页与外链，完成审核后才发布。服务器部署、腾讯云 DNS/静态站点与 TikTok Portal 操作均需有对应权限和真实凭据；本仓库的本地构建本身不等于线上部署。

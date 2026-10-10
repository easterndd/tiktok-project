# 10 个 Breeze 小程序部署步骤

适用于 CrownRush、SugarReel、CrimsonShorts、SweetReel、DramaBlaze、HeartReel、DramaHit、CrownReel、LuxeReel、EliteDrama。前三个目录已有实现，本次统一法律页；后七个为新增目录。不要改动现有 TaleTV 等其他运营主体的法律配置。

## 1. 通用法律页

这十个应用在 Portal 中使用相同的值：

| 字段 | 值 |
| --- | --- |
| Privacy policy URL | `https://xuyins.com/static/privacy-policy.html` |
| Terms of Service URL | `https://xuyins.com/static/terms-of-service.html` |
| Domain of your service | `https://xuyins.com` |

法律页运营主体是 `Breeze and Azure Sky Culture Limited`，联系邮箱是 `caijiarong@xuyins.com`。源码位于 `apps/mini-web/src/pages/legal-docs.ts`，导出脚本位于 `apps/mini-web/scripts/export-legal-pages.mjs`。生成文件为 `deploy/website/static/privacy-policy.html` 和 `deploy/website/static/terms-of-service.html`；各应用还生成内置页 `deploy/website/<key>/privacy/index.html` 和 `terms/index.html`。本页参考 ThroneReel 页面中的公司与邮箱，但没有复制其尚未核实的托管地区、多地区翻译承诺或业务功能声明。上线前应按实际数据流和目标市场完成法律审核。

前三个应用的六个旧品牌专属 URL 文件仍会导出为相同的通用正文，供已有链接访问；新审核统一填写表中不带品牌名的两个 URL。

`xuyins.com` 必须配置 DNS、HTTPS 和静态站点，将上述两个文件部署到 `/static/`。域名控制台地址不是法律页 URL。当前项目 API 仍为 `https://api.evergreenprosper.com`，在 Portal Trusted Domains 中另行配置；不要把法律页域名当成 API 域名。

截至 2026-10-08，本开发机无法解析 `xuyins.com`，线上发布与 TLS 尚未验收。配置 DNS 和站点后执行：

```powershell
curl.exe -fIL https://xuyins.com/static/privacy-policy.html
curl.exe -fIL https://xuyins.com/static/terms-of-service.html
```

确认两页返回 `200` 和 HTML 正文后，才能在 Portal 使用这些 URL。

本地导出并核对：

```powershell
cd 'D:\my project\tiktok-project'
$apps = @('crownrush','sugarreel','crimsonshorts','sweetreel','dramablaze','heartreel','dramahit','crownreel','luxereel','elitedrama')
foreach ($key in $apps) { pnpm --filter $key export:legal; if ($LASTEXITCODE -ne 0) { throw "$key 法律页导出失败" } }
pnpm --filter mini-web test
```

站点部署后检查两页均返回 `200`、`text/html` 且内容不是站点的 SPA 兜底页；再填写 Portal。旧的品牌专属静态页文件不能代替这两个新 URL。

## 2. 本地与服务器变量

每个应用从 `apps/<key>/.env.example` 建立本地 `.env`，只写公开的 `VITE_API_BASE_URL` 和该应用的 `VITE_TIKTOK_CLIENT_KEY`。`minis.config.json` 的 `appId` 目前为空，必须填入各自真实 App ID。不要把 Client Secret、数据库 URL 或管理员密码放到小程序目录。

服务器 `/opt/quickreels/.env.production` 为每个应用填独立的 `<PREFIX>_DATABASE_URL`、`<PREFIX>_TIKTOK_CLIENT_KEY`、`<PREFIX>_TIKTOK_CLIENT_SECRET`、`<PREFIX>_TIKTOK_APP_ID`、`VITE_<PREFIX>_API_BASE_URL`。变量名示例在 `.env.production.self-hosted.example`。各应用必须使用不同 PostgreSQL schema；激励广告位可在取得真实 ID 后填写，入口广告位可保持空并关闭策略。

服务器上线前先确认 Git 提交、Compose 类型和现有容器状态，备份数据库及环境文件；不要执行 `docker compose down -v`、`prisma migrate dev` 或生产 seed。对新 schema 逐个创建并运行 `prisma migrate deploy`，已有三个应用如已迁移则先用 `prisma migrate status` 核对，绝不清空现有数据。完成 OWNER 初始化后构建并更新 `api worker admin`，核对 `/ready` 和所有十条 `/api/<key>/v1/albums` 返回 `200`；还要复查旧应用 API。

## 3. 正式构建与发布

在取得真实 App ID 和 Client Key、API 上线且法律页可访问后执行：

```powershell
cd 'D:\my project\tiktok-project'
Remove-Item Env:VITE_API_BASE_URL, Env:VITE_TIKTOK_CLIENT_KEY -ErrorAction SilentlyContinue
foreach ($key in $apps) {
  $zip = "apps/$key/dist/minis.config.zip"
  pnpm --filter $key build:minis:release
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $zip)) { throw "$key 发布包构建失败" }
}
```

将每个 `apps/<key>/dist/minis.config.zip` 只上传到同名 TikTok Portal Preview。真机检查首页、匿名会话、播放、续播、激励广告、内置法律页及外链，再提交审核。没有真实凭据时只能验证本地代码构建，不能生成可发布 ZIP；本地文件变更也不会自动部署到服务器或腾讯云静态站点。

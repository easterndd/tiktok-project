# TaleTV（内部标识 taletv）：Developer Portal 信息与法律页部署

## Description

在 TikTok Developer Portal 的 Description 输入以下英文文案（少于 500 字符）：

> TaleTV is a TikTok Minis short-drama app featuring bite-sized series in romance, family, suspense, and more. Viewers can discover stories, watch available free episodes, resume viewing from their history, and unlock selected episodes through rewarded ads where available. Content availability varies by region.

中文对照，仅供核对和需要中文描述的场合使用：

> TaleTV 是一款 TikTok Minis 短剧应用，提供爱情、家庭、悬疑等类型的短篇剧集。用户可以发现新故事、观看可免费观看的剧集、从观看历史继续播放，并在可用时通过观看激励广告解锁部分剧集。具体内容因地区而异。

`apps/taletv/minis.config.json` 的 `dev.desc` 同步使用英文描述。Developer Portal 的 Description 仍需在网页表单中单独填写。

## Portal URL

法律页面上线并确认返回 200 后，填写：

| Portal 字段 | 值 |
| --- | --- |
| Terms of Service URL | `https://www.yya.ai/capy/termsofservice.html` |
| Privacy policy URL | `https://www.yya.ai/capy/privacypolicy.html` |
| Domain of your service | `https://www.yya.ai` |

法律页使用 `www.yya.ai/capy/` 下的正式页面，业务 API 仍使用内部路径 `/api/taletv/v1`。两条法律页 URL 必须在不登录的浏览器中直接打开，最终响应为 200，不能跳转到别的域名或首页。

## 生成静态页面

在本项目根目录运行：

```powershell
pnpm --filter taletv export:legal
```

生成文件：

```text
deploy/website/taletv/privacy/index.html
deploy/website/taletv/terms/index.html
```

这两页由 TaleTV 的应用内法律文案生成，主体为 `SAGATHIYA TECHSOLUTIONS PRIVATE LIMITED`。正式提交前须核实实际数据处理、服务器位置、联系方式、生效日期及法律适用条款。生成文件只是待发布的静态页面；当前 `www.yya.ai/capy/*.html` 在线内容不会因本地导出而自动更新。

## 发布与复核

将 `deploy/website/taletv/privacy/index.html` 发布为 `https://www.yya.ai/capy/privacypolicy.html`，将 `deploy/website/taletv/terms/index.html` 发布为 `https://www.yya.ai/capy/termsofservice.html`。发布位置和方法由 `www.yya.ai` 的网站部署配置决定；此仓库没有该站点的服务器配置。发布后从公网逐页核对标题、主体名称、邮箱链接、交叉链接和 HTTP 200。

在 TikTok Developer Portal 中按上表分别填写隐私政策、服务条款和服务域名。另在 Trusted Domains 登记生产 API 主机 `https://api.evergreenprosper.com`；服务域名字段不能代替 API Trusted Domain。上传重新构建的 TaleTV ZIP 后，用真实 TikTok Preview 验证首次打开、重试、首页和播放。若仍显示 `SESSION_BOOTSTRAP_FAILED`，查看实际请求 URL、Origin、HTTP 状态及 API 的 Mini bootstrap 日志。

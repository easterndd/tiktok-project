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
| Terms of Service URL | `https://evergreenprosper.com/taletv/terms` |
| Privacy policy URL | `https://evergreenprosper.com/taletv/privacy` |
| Domain of your service | `https://evergreenprosper.com` |

不要使用 QuicK ReeLS 的 `/quickreels/...` 页面；它们仍属于原小程序。TaleTV 法律页使用 `/taletv/...`，业务 API 仍使用内部路径 `/api/taletv/v1`。两条法律页 URL 必须在不登录的浏览器中直接打开，最终响应为 200，不能跳转到别的域名或首页。

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

这两页复用原项目的隐私与服务条款内容，产品名称显示为 TaleTV，页面互链及 canonical URL 使用 `/taletv/...`。运营主体、联系邮箱、服务器位置、数据处理和生效日期仍采用现有文本；正式提交前须按 TaleTV 实际情况复核这些事实。

## 部署到现有服务器

先把包含 `deploy/website/taletv/` 的代码版本同步到服务器。在服务器的项目目录执行；以下静态根目录是当前部署手册使用的 `/opt/evergreenprosper-website`，实际操作前先核对现有 Caddyfile 的 `root`：

```bash
cd /opt/quickreels
sudo install -d -m 755 /opt/evergreenprosper-website/taletv
sudo cp -a deploy/website/taletv/. /opt/evergreenprosper-website/taletv/
```

检查 `evergreenprosper.com` 站点块是否已有 `deploy/website/Caddyfile.quickreels-snippet` 中的 `taletv` 路径重写规则；没有才添加到最终 `file_server` 之前，已有则保留，不要删除。修改 Caddyfile 前先备份，再校验和重载：

```bash
export CADDY_CONTAINER=evergreenprosper-website-web-1
sudo cp /opt/evergreenprosper-website/Caddyfile \
  /opt/evergreenprosper-website/Caddyfile.bak.$(date +%F-%H%M%S)
sudo docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

只复制静态 HTML 且 Caddyfile 未变时，无需重载 Caddy。最后从公网验证：

```bash
curl -IL https://evergreenprosper.com/taletv/privacy
curl -IL https://evergreenprosper.com/taletv/terms
```

两条 URL 都返回 200、页面标题为 `TaleTV` 后再填写 Portal。保留服务器静态根目录中的 `/taletv/privacy` 与 `/taletv/terms` 文件供 Portal 使用。小程序 ZIP 由 TikTok 托管；这些法律页由现有官网服务器托管。

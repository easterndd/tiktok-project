# Mini 启动网络故障排查

## 2026-09-27 已确认的问题

CineReels、TaleReels 手机端显示 `Unable to continue` / `Failed to fetch`。截图中的 Trusted Domains 仅登记 `https://evergreenprosper.com`，没有实际请求主机 `https://api.evergreenprosper.com`；需要在两个小程序的 Portal 分别补上 API 主机并保存，不能使用带 `/api/...` 路径的地址。

服务端记录的匿名会话 OPTIONS 请求返回 404，且没有后续 POST。线上及本地测试复现：CORS 允许的 Origin 返回 204 和对应 `Access-Control-Allow-Origin`；未允许的 Origin（含字符串 `null`）会跳过 CORS 处理，最终返回 OPTIONS 路由不存在的 404。不要为此另加通用 OPTIONS 路由或允许所有来源，这不会正确修复源站限制。

旧启动诊断只覆盖 `/api/v1`，并且注册在 CORS 后面，无法完整记录其他 Mini 的预检。已修正为覆盖 main、TaleTV、CineReels、TaleReels 两个启动接口，在 CORS 前记录 `origin`、`corsAllowed`、路径及预检方法，在响应时记录状态和允许来源。专用诊断不记录 token、请求体、Authorization 值或 Referer / URL 查询参数。Fastify 原有请求日志仍可能包含请求 URL，不要向外提供含凭据的 URL。

## 获取实际来源

更新 api 后执行：

```bash
cd /opt/quickreels
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml \
  logs -f --tail=0 api | grep --line-buffered 'Mini bootstrap'
```

再分别在手机点击 Try again。保存 `Mini bootstrap request`、`Mini bootstrap response` 两行。`corsAllowed=false` 时，核实实际 Origin 是该 Mini 的合法 HTTPS 运行来源，再将该准确来源追加到 `.env.production` 的 `API_CORS_ORIGIN`，保留原配置并重建 / 重建容器使环境变量生效。

`API_CORS_ORIGIN` 匹配的是发出请求的网页来源，不是访问的 API 主机；不要把 API 主机加进去就认为修复，也不要直接允许 `*`、所有 `null` 来源或没有依据的大范围域名。字符串 `"null"` 和无 Origin 的 JSON `null` 是不同情况，需要分别检查实际运行包和平台运行环境。

允许来源后的预期过程为 OPTIONS 204，随后 POST 返回成功会话。不带有效参数的空 POST 测试应返回 400，只能验证路由可达，不能代表真实会话及数据库写入已经验收。真正验收必须使用手机 Mini 完成启动、首页和播放。

Portal 域名许可、服务端 CORS、打包 API 地址是三项独立配置，媒资授权不会自动配置这些项目。当前现有本机构建包地址和线上列表可达，但没有实际手机 Origin 时，不能确定具体缺失的 CORS 条目，也不能宣称端到端已恢复。

## 实际 Origin 已确认后的修复

后续真机日志确认：`/api/taletv/v1/auth/anonymous/session` 的 Origin 是 `https://minis-mnph4s4euzsjk6w6-3hr0tnbqgepq9-3.tiktokminis.us`，`corsAllowed=false`，OPTIONS 404。根因是配置缺少无连字符的 `https://*.tiktokminis.us`；此前测试使用了带连字符的 `*.tiktok-minis.us` 模拟来源，不能代表这个真实来源。

生产环境立即修复，不需要构建镜像、迁移数据库、打包 Mini 或重复授权：

```bash
cd /opt/quickreels
sudo cp -p .env.production ".env.production.before-cors.$(date +%Y%m%d-%H%M%S)"
sudo nano .env.production
```

在现有 `API_CORS_ORIGIN=` 的逗号分隔值中追加 `https://*.tiktokminis.us`，保留原合法来源。值若被引号包裹，要追加在引号里面；不要把 Markdown 链接语法写入环境文件。示例：

```dotenv
API_CORS_ORIGIN=https://admin.evergreenprosper.com,https://tiktok.com,https://*.tiktok.com,https://*.tiktokminis.us,https://*.tiktok-minis.us
```

保存后执行：

```bash
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml \
  up -d --no-deps --force-recreate api
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml exec -T api \
  node -e 'console.log("API_CORS_ORIGIN:", process.env.API_CORS_ORIGIN)'
```

打印的运行配置必须含 `https://*.tiktokminis.us`。继续观察启动日志，分别验证 TaleTV、CineReels、TaleReels；预期 corsAllowed=true、OPTIONS 204、POST 200。现有示例配置和部署手册已修正，但 git 更新不会修改服务器未跟踪的真实 `.env.production`。其他应用必须根据自己的实际日志验收，不能把一条 TaleTV 日志当作三个应用都已恢复。

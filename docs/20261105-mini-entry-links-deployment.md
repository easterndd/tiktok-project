# TikTok Minis 入口登记与运行版本识别：生产部署记录

日期：2026-11-05（北京时间）

## 上线范围

- 管理后台增加“TikTok 入口”：按小程序登记预览/正式平台短链，支持粘贴或本地二维码识别，展示新包上报的构建号及 WebView 基址。
- 保留“投放剧集链接”生成入口；选取已上线的免费分集后，可复制完整链接和 `album_id`/`episode_id` 参数片段。
- API 增加 `GET /admin/mini-entry-links` 和 `PUT /admin/mini-entry-links/:environment`；启动记录接收 `releaseId` 与 `webviewBase`。
- 在共享库 `public` schema 应用 `20261105090000_mini_app_entry_links` 迁移，新增 `MiniAppEntryLink` 表。其他待应用迁移未包含在本次执行中。

## 生产发布

- API 镜像：`quickreels-api-mini-entry-links-20261105:2`；运行容器：`quickreels-api-mini-entry-links-20261105-v2`。
- 后台镜像：`quickreels-admin-mini-entry-links-20261105:1`；运行容器：`quickreels-admin-mini-entry-links-20261105`。
- Caddy 将所有小程序的 `/admin/mini-entry-links` 与 `/auth/launch-context` 请求转发到新 API 候选实例；普通业务 API、Worker 与原投放链接路由保持原上游。
- `admin.evergreenprosper.com` 默认转发到新后台容器。新容器均启用 `unless-stopped` 自动重启。
- 切换前 Caddyfile 保存在服务器 `/opt/quickreels/backups/mini-entry-links-20261105/Caddyfile`；灰度配置保存在同目录的 `Caddyfile-canary`。原 API/后台镜像与容器仍保留用于回退。

## 验收

- 灰度观察：北京时间约 23:26–23:31，5 分钟；全量后观察：约 23:33–23:38，5 分钟。两阶段中 `/ready`、后台首页及抽查的 BloomReel、StoryHub、RiftSaga 首页持续返回 HTTP 200；新 API/后台无重启，候选 API 采样日志无新增 5xx。
- 通过公网域名对 BloomReel、StoryHub、HeartReel、RiftSaga、QuartzPlay 测试了管理员读取和启动字段写入；`releaseId`、`webviewBase` 均正确保存。测试产生的临时启动记录已删除。
- 新接口对无效 TikTok 链接返回 HTTP 400；TikTok Minis Origin 的跨域预检返回 HTTP 204。
- 新后台产物包含“TikTok 入口基址”和“投放剧集链接”两个功能；旧 API 与 Worker 容器在最终检查时保持运行。

## 边界与后续

本次只部署服务器 API 与管理后台。TikTok 开发者平台上的小程序 ZIP 尚未重新上传或发布，因此旧包仍可运行，但不会自动上报本次新增的 `releaseId` 和 `webviewBase`。TikTok 平台入口短链需要从对应小程序的平台链接或二维码登记；WebView 基址本身不能替代平台短链。

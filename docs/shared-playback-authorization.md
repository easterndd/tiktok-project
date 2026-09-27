# 已审核剧目授权播放

## 平台依据

`TikTok小程序短剧媒资库接入文档.docx` 第 8 节“剧集授权”用于小程序 A 上传送审剧目、在小程序 B 内播放的场景。

本流程由主小程序调用 `POST /v2/sg/shortdrama/album/authorize/`，发送同一个 `album_id`、`operate_type=1` 和目标 `client_key`。每个目标的 `auth_status` 和错误必须单独核对。目标不调用视频登记、视频上传、版本创建或送审接口。

## 操作步骤

1. 在主小程序确认剧目有已审核通过的线上版本，且平台已经上架。必要时先使用普通发布链路的“对账”。
2. 在“剧集与解锁”中的“已审核剧目授权播放”选择主剧目，勾选目标小程序，点击“授权播放”。
3. 系统查询 TikTok 线上版本，并与本地不可变版本快照核对分集 ID、集号及 VID。当前版本正在审核时，仍使用已通过的线上旧版本，不共享当前草稿。
4. 系统自动创建目标本地剧目和完整分集映射，不需要填写目标本地 ID。新目标在授权及映射完成前保持不可播放。
5. 等待目标显示“已授权”和“授权与本地映射完成”，确认映射集数完整，再到该目标小程序的真实运行环境验证播放、封面和广告解锁。
6. “对账”核实主剧目线上状态并修复已确认授权的本地映射。后台 worker 约每 10 分钟为已有目标授权的主剧目对账；主剧目下架后目标副本也停止本地播放。

平台授权成功不等于目标运行环境已经实测播放成功。开发测试不替代真实 TikTok 小程序验收。

## 权限和配置

- 主小程序操作者必须是 ACTIVE OWNER。
- 每个目标需要自己的数据库和 TikTok 配置，且使用同一配置的 BytePlus 账号、空间、地区。
- 同邮箱的目标 ACTIVE OWNER 可以操作。不同邮箱时，在同一浏览器标签页分别登录目标小程序 OWNER，再切回主小程序；服务器校验目标会话的 appKey、角色、状态和 tokenVersion。
- 新目标沿用主剧目的免费集数和解锁次数，但使用目标自己的广告位；已有目标的广告与访问策略不覆盖。目标未配置所需广告位时，明确拒绝准备，不借用其他小程序广告位。
- 勾选仅控制本次操作对象，取消勾选不会撤销已存在的 TikTok 授权。

## 数据保护

共用 TikTok 剧目 ID、分集 ID 和 BytePlus VID。授权流程不上传原视频、不申请新 VID，因此不会因为新增目标而制造重复的视频媒资。已有重复上传的文件、VID、上传记录不会自动删除。

旧独立发布目标若只是未同步平台的匹配草稿，可复用本地结构。若已有独立 TikTok 剧目、不同 VID 或冲突分集，拒绝自动覆盖，要求人工核实。目标授权副本不能通过普通发布按钮再改主剧目的版本、送审或上下架，也不能重绑视频或追加分集；主小程序管理平台内容。

平台明确拒绝授权时任务为 FAILED。平台请求超时、执行中断而结果未知时任务为 CONFLICT，不自动重放授权 POST。已保存的平台成功证明包含目标 Client Key；本地映射失败时保留证明，恢复只重做映射。Client Key 变化会使旧成功证明失效。

## 授权结果未知的排查

后台返回的 `items[].accepted=false` 和“上次授权结果未知”是本地防重复提交的保护，不是 TikTok 的原始返回，不能用它判断平台是否已授权。`error.code=ok` 也不能替代文档要求的逐目标结果。

新代码在授权返回缺少目标结果、格式不完整或被平台拒绝时，将脱敏响应保存在任务 `providerResponse.providerEnvelope`，同时记录 HTTP 状态和 TikTok 请求 ID。不会猜测其他字段名、伪造授权成功或自动重新上传视频。旧代码已经丢弃的原响应无法通过更新代码恢复，应先凭原请求 ID 向 TikTok 核实。

先执行只读诊断（不提交授权，不修改任务或数据库）：

```bash
cd /opt/quickreels
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml exec -T api \
  node dist/scripts/inspect-shared-authorization.js 2026092716233501C488377D002D3BBB21
```

输出 `originalResponseSaved=false` 表示没有已保存的平台响应。将 `response.providerEnvelope` 提供给维护人员；不要提供 token、Secret、Authorization 请求头或完整环境文件。

确需重新发出一次授权请求获取最新结果时，维护工具要求显式确认，并且一次只处理原请求对应的目标。以下 `TARGET_APP_KEY` 必须替换为只读输出的 `targetMiniAppKey`，不能猜测或同时重试所有目标：

```bash
sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml exec -T api \
  node dist/scripts/inspect-shared-authorization.js 2026092716233501C488377D002D3BBB21 \
  --retry-target TARGET_APP_KEY --confirm REAUTHORIZE_ONE_TARGET
```

该命令可能重新调用平台授权接口，并非只读对账。它重新检查目标 OWNER、当前凭据及源剧目线上版本，创建独立审计任务并保留原 CONFLICT 记录。每个原任务最多创建一次维护任务，数据库唯一键阻止并发重复执行；新返回仍无法确认时继续标为 CONFLICT，保存新响应，不自动重复调用、不开放目标播放。已有匹配的成功证明时只恢复本地映射。更新部署本身不会解除旧 CONFLICT。

## 部署

本次使用已有共享平台表，无数据库结构变更。更新代码后重建并重启 api、worker、admin，worker 必须更新以执行新的授权和周期对账逻辑。上线前核实所有配置库已经有既有共享平台表。

旧“多小程序独立发布”页面、批量服务和新上传入口已经移除，旧批量 API 返回 410。历史 URL 独立上传任务停止自动执行，但保留 provider job_id、VID 和错误；已在平台受理的任务需要人工核实，不会自动删除或重复上传。

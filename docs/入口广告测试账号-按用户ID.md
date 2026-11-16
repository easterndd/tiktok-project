# 入口广告测试账号（按用户 ID）

## 用途与身份

测试人员在管理后台“进入广告 → 入口广告测试账号”中，选择小程序并填入该小程序的用户 ID。名单键为 `miniAppKey + userId`，与 VPN 出口 IP 无关；同一人测试两个小程序时，需分别登记两个小程序的用户 ID。账号默认有效 7 天，可选 30 或 90 天，可停用及重新启用。仅 OWNER 可在后台管理。

## 入口判定顺序

1. 核验本次启动的 `launchRef`、用户、发布号和真实启动归因。
2. 全局 IP 豁免优先：命中时不强弹，即使用户在测试账号名单内。IP 查询故障时，归因链路保持不强弹。
3. 已归因用户按原入口策略执行。未归因用户只有在该小程序和用户 ID 的测试账号记录处于启用且未到期时，才按已归因入口策略执行；无效归因信号或广告 ID 冲突不能由测试账号放行。
4. 发布号入口策略关闭、用户广告豁免、平台广告位规则仍可使本次入口不强弹。服务端展示次数与计数模式仍按该发布号策略。

真实 `MiniAppLaunch.localAttributionStatus` 不会被改写。测试放行的入口决策记录 `reason=TEST_ACCOUNT_OVERRIDE`，真实归因仍记录 `attributionStatus=UNATTRIBUTED`。同一次启动已有决策保持幂等，名单调整从下一次启动起生效。

## 数据与接口

共享数据库新增 `EntryAdTestAccount`，主键为 `(miniAppKey,userId)`；保存启用状态、备注、到期时间、创建/更新管理员及时间。后台操作同时写目标小程序审计日志。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/admin/shared/entry-ad-test-accounts?miniAppKey=...` | 列出该小程序测试账号。 |
| POST | `/admin/shared/entry-ad-test-accounts` | 登记或续期，参数 `miniAppKey/userId/note?/expiresAt?`；校验该小程序中确有此用户。 |
| PATCH | `/admin/shared/entry-ad-test-accounts/:userId` | 停用或启用，参数 `miniAppKey/enabled/note?/expiresAt?`；过期账号启用时续期 7 天。 |

上线顺序：备份共享数据库，先对**实际共享数据库**应用 `20261116090000_entry_ad_test_accounts` 迁移，再灰度启动新 API，验证管理接口和入口决策，最后更新管理后台静态资源。旧小程序包不需要重打；它们未提供归因协议时不会因测试账号名单而改变入口行为。

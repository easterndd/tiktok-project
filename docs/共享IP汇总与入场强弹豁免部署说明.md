# 共享 IP 汇总与入场强弹豁免

## 数据位置与规则

IP 汇总表和入场强弹豁免表位于共享平台数据库，不属于任何一个小程序的独立数据库。各小程序的 `AppSession` 不保存 IP；入口会话接口把一次启动记录写入共享注册表，并按小程序和 `launchId` 去重。

- `SharedIpAddress` 汇总 IP、访问次数和最近访问信息。
- `SharedIpVisit` 保存跨小程序的访问历史。
- `SharedEntryAdIpExemption` 单独保存需要跳过入场强弹的 IP。
- 配置豁免的 IP 在所有小程序跳过入场强弹检查，剧集解锁广告照常执行。
- 累计访问达到 3 次的 IP 原文及访问历史持续保留。
- 少于 3 次且未豁免的 IP，在最后访问满 30 天后清除原始 IP 和过期访问明细；匿名化汇总行仍保留。
- 豁免 IP 持续保存，直到 OWNER 在后台移除豁免。

后台 OWNER 可在“广告配置”页查看全小程序 IP 汇总、按 IP 搜索、查看访问历史以及添加或移除入场强弹豁免。

## 数据库配置

所有 API 实例和 worker 必须使用同一个 `SHARED_PLATFORM_DATABASE_URL`。若未设置该变量，服务会把 `DATABASE_URL` 作为共享数据库；这适用于主数据库本身就是共享库的部署。`JWT_SECRET` 也必须在这些实例间保持一致，因为 IP 汇总使用它生成稳定的 HMAC 标识。

共享表结构只需在共享数据库执行一次，不要在每个小程序的独立数据库执行：

```bash
psql "$SHARED_PLATFORM_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f apps/api/prisma/shared-migrations/20261021_shared_ip_registry.sql
```

如果使用 `DATABASE_URL` 作为共享库且没有设置 `SHARED_PLATFORM_DATABASE_URL`，将命令中的变量替换为 `DATABASE_URL`。常规 Prisma migrations 仍需按部署手册应用到各小程序数据库；其中的 `User` 和 `AppSession.countryCode` 变更不创建 IP 存储表。

迁移成功后重启 API 和 worker。worker 会定期清理过期记录；API 和 worker 的共享数据库配置必须相同。后台管理请求应使用 OWNER 账号。

## 上线检查

1. 确认所有 API 实例和 worker 的共享数据库地址一致，且 `JWT_SECRET` 一致。
2. 对共享数据库执行一次 `20261021_shared_ip_registry.sql`，不要对各小程序库重复执行。
3. 部署并重启 API、worker 和管理后台。
4. 在后台添加测试 IP 豁免，确认“广告配置”页能显示豁免记录。
5. 用该 IP 访问任一小程序，确认入场强弹跳过；再确认剧集解锁广告仍按原策略运行。

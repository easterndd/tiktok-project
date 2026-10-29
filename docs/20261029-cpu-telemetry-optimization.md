# 2026-10-29 API CPU 与遥测写入优化

## 线上依据

只读采样显示 API 与 PostgreSQL 的峰值与 HeartReel、SweetReel 的入口广告事件量同步：两个小程序最近 5 分钟各有约 1,700 个入口会话和 10,000 级广告事件。`SHOWN` 计数模式下，每次广告关闭还会额外写一条 `CLOSED_INCOMPLETE`，同时大量相同的 `ENTRY_GATE_SLOW`、SDK 错误和网络错误重复写入 `MiniAppRuntimeError`。

## 本次修改

- `runtime-errors` 对同一小程序、发布版本、错误类型、阶段、消息、路径和状态码的重复诊断在 30 秒内只保留一条样本；接口仍返回 202，重复请求返回 `deduplicated: true`。这只影响诊断留存，不影响入口策略、广告计数或用户权限。
- `SHOWN` 模式的入口广告已经由 `/app-entry-ad-sessions/:id/shown` 推进服务器计数。后续 `CLOSED_INCOMPLETE` 不参与奖励或门禁校验，因此 API 保持鉴权和会话检查后直接确认，不再为每次关闭写 `AdEvent`。
- 入口上下文保存时，如果合并后的 URL、SDK 回调和查询参数没有变化，不再更新 `AudienceActivityEvent.metadata`，避免匿名启动和鉴权补报造成重复写热点。
- `COMPLETED` 模式、`SHOWN` 模式的服务器计数、入口广告策略和奖励完成校验均保留。

## 验收

- API TypeScript lint：通过。
- API 全套测试：218 通过，0 失败。
- Mini Web TypeScript lint：通过。
- Mini Web 广告相关测试：20 通过，0 失败。
- Mini Web 全套测试：一次并行运行中 `player-autoplay` 定时断言出现 1 次时序抖动；该文件单独重跑 3/3 通过。该测试未涉及本次 API 修改。

## 部署说明

只需重建并滚动替换 API 镜像；Worker、管理后台、PostgreSQL、PgBouncer 和生产 `.env` 不需要修改。部署前应保留旧 API 镜像标签，健康检查通过后再删除旧镜像。

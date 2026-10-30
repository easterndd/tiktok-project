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

## 2026-10-29 后续 CPU 排查与改进

### 观测结果

- 数据库 60 秒增量样本中，HeartReel 和 SweetReel 的 `AdEvent` 没有发生全表扫描，但分别新增约 957 和 1,986 条事件；两库请求量仍有明显写入压力。
- 查询计划确认管理后台 `/admin/analytics/health` 的失败计数与最近失败事件查询会并行扫描 HeartReel 的约 929 万行 `AdEvent`；Worker 的每日汇总对近两天事件也会扫描大型 `AdEvent` 表。
- API 成功响应日志为 1% 抽样。三分钟内采集到 573 条 Mini 响应日志，其中 375 条 HTTP 200 和 81 条 HTTP 204；据此估算请求至少约 150 次/秒。API 容器多次在约 129%–166% CPU，PostgreSQL 约 98%–145% 峰值；网站容器也约 38%–47%。这些是不同采样时点，说明主机同时承载多个 CPU 热点，不能单独归因于 API 查询。
- 60 秒数据库样本未观察到锁等待；请求日志样本未见 5xx。成功接口的数据库耗时多数为低毫秒级，但高请求量仍会造成持续 CPU 消耗。

### 本次改进

- 管理后台异常概览改为缓存 60 秒，并合并同一缓存键上的并发读取，避免每个后台窗口的 30 秒刷新都重复扫描大型事件表。
- Worker 的每日汇总刷新周期从 5 分钟延长到 15 分钟，降低重复读取近两天事件数据的频率。入口广告策略、计数、广告完成校验和播放流程均不变。
- 本地 API TypeScript 检查通过；新增异常概览缓存并发测试。部署后仍需用同一流量窗口复测主机、API、PostgreSQL 和外部网站的 CPU，确认净变化。

### 限制

本次改动减少可控的周期性数据库读负载，但每秒 150 次以上的 Mini 请求和独立网站容器负载仍会占用 CPU。若部署后 API 持续高于单核、主机长期高于 85%，应按路由采样继续定位高频客户端行为，再评估不影响旧包的 API 缓存、写入聚合或扩容。不能通过收紧广告策略或共享 IP 限制来掩盖该负载。

### 部署与复测结果

- 2026-10-29 05:33 UTC 构建并替换了 API、Worker 镜像；第一次构建尝试因 Docker 不支持 `--cpus` 参数自动回滚，随后移除该参数重新部署成功。
- API 镜像为 `sha256:f4cd66077fcd67a8ee4c9abc72729e734ecea60eaa4fd724d34872db1be0dd3c`，API 健康，API/Worker 重启数均为 0。旧 API 镜像保留为 `quickreels-api:before-cpu-focused-20261029T053307Z`，旧 Worker 镜像保留为 `quickreels-worker:before-cpu-focused-20261029T053307Z`。
- `/ready`、主应用、HeartReel、SweetReel、StoryFlicks、DramaFlicks 首页均 HTTP 200。管理后台、PostgreSQL、PgBouncer 容器没有被重建；HeartReel、SweetReel 入口策略哈希不变。
- 部署后 60 秒数据库增量：HeartReel/SweetReel `AdEvent` 与 `AppEntryAdSession` 均为 `seq_scans=0`，即本窗口未发生全表扫描。API 三次采样约 97.6%、80.7%、91.8%；PostgreSQL 约 34.2%、19.1%、24.5%；Worker 约 0%。
- 部署后 90 秒 API 日志抽样没有 5xx；HTTP 401/409 主要是无授权、过期 JWT 和不可用的旧入口会话。API CPU 仍偏高，表明剩余压力来自持续的小程序请求量及同机网站容器，需继续按路由和客户端版本治理，不能把本次改动当作扩容替代品。

## 2026-10-29 后端写入与连接压力优化（本地已完成，待受控部署）

- Shared IP 访问记录不再先 `SELECT` 再 `INSERT`；使用现有 `idempotencyKey` 主键的 `INSERT ... ON CONFLICT DO NOTHING`，只有真正新增的访问才更新地址和计数。
- Shared IP 队列增加按 Prisma 实例隔离的 5 分钟短期完成缓存，吸收同一客户端会话的重复重试；数据库主键仍是跨 API 实例和重启后的最终幂等保障。
- `SHOWN` 入口广告正常路径移除一次重复的完成记录查询；顺序冲突、重复广告序号和权限校验仍走原有数据库校验。
- 当 `PERSIST_CLIENT_AD_DIAGNOSTICS` 未启用时，合法的 `FAILED` 广告事件跳过 JWT 校验并直接返回兼容响应；奖励完成、入口计数和会话权限不受影响。
- 管理后台统计缓存默认 TTL 从 15 秒延长到 60 秒，并继续合并相同缓存键的并发查询；健康概览保持 60 秒缓存。

本地验收：API lint、API build、API 全量测试均通过（226 通过、0 失败、1 个 PostgreSQL 专项测试跳过）。本节修改尚未部署到生产，部署时只替换 API 镜像并保留旧镜像回滚点；不修改前端包、生产策略、Worker、管理后台、PostgreSQL 或 PgBouncer。

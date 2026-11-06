# 2026-11-02 CPU 与 API 稳定性修复记录

## 本次处理范围

本次针对美国生产服务器 CPU 持续偏高、API 交互事务获取超时、健康检查抖动和大量 503 实施修复。先备份数据库、配置和广告策略，再进行单应用灰度及全量切换。小程序已有接口及广告计数规则继续兼容；本次服务端部署不要求重新打包小程序。

完整排查证据见 `output/cpu-investigation-20261102.md`。本记录中的性能数字均为注明时间的短时采样，不能当成全天均值或下一次业务高峰的保证。

## 已确认的问题

1. 原 API 容器短时占用约 9.2—9.8 个 CPU 核，16 个 `tokio-runtime-w` 线程存在大量上下文切换。整机每秒上下文切换约 45 万—65 万。函数采样中，内核 `try_to_wake_up` 约占 20.55%，另有调度锁开销。这支持“引擎线程唤醒及调度开销显著”的判断，不能据此断言某个 Prisma 版本存在已知缺陷。
2. 入口广告完成接口出现大量 `P2028: Unable to start a transaction in the given time`。此前该错误进入通用 500 处理。
3. Caddy 只有一个业务上游，原健康检查在繁忙时频繁摘除整个上游，出现 `no upstreams available`。诊断接口的 OPTIONS 预检仍到达业务 API，放大故障流量。
4. 第一轮每应用并发上限为 2，容量偏小，造成新的 503。该配置已替换，不能将该轮结果计作最终验收通过。
5. 当前共享 IP 表的全表扫描增量为 0；过去累计扫描量不能用来解释本次 CPU 异常。Worker 和管理后台也不是此次主要 CPU 消耗源。

## 已实施的修改

### API 并发与数据库连接

- 增加全局及每应用的有限并发和队列，隔离热门应用的突发流量。
- 为匿名登录、入口广告确认及奖励完成保留处理容量；健康探针不进入业务队列，也不使用业务限流配额。
- 排队超时或容量耗尽时返回 `503 SERVER_BUSY` 和 `Retry-After: 2`。保护措施仍存在；最终稳定窗口没有触发拒绝，不意味着未来无限流量下不会拒绝。
- 等待中的客户端断开时清理排队项，处理结束或异常后释放额度。
- API、Worker 分开配置每应用数据库连接预算，迁移使用的直连 URL 不改写。

### 入口广告事务

- 合并同一个完成事件的并发请求，按入口会话串行处理不同事件。
- 对已经完成的事件、已经消费的广告序号进行幂等检查；无需再次执行写事务的请求提前返回。
- 写事务使用 `READ COMMITTED`，并先锁定所属用户的入口会话行。计数判断在锁内重新检查，覆盖多个 API 实例同时操作同一会话的情况。
- 保留完整观看计数、展示计数、提前关闭及旧版本 `/complete` 响应语义。
- 事务连接获取等待为 1 秒，执行超时为 3 秒；数据库忙碌错误转换为可重试响应，并采样记录错误类别。

### 引擎线程、探针与代理

- 生产 API 和 Worker 都设置 `TOKIO_WORKER_THREADS=2`；Dockerfile 同步加入该启动默认值。
- 现场验证线程分布及 CPU 确实发生变化。进程内还有其他线程或运行时，因此该值不是整个进程的总线程数上限。
- `/ready` 使用独立的单连接探针客户端，合并同时到达的探针，限制探测等待，避免被业务连接池排队拖住。
- Caddy 探测改为每 5 秒一次、3 秒超时，连续 3 次失败后摘除、连续 2 次成功后恢复。
- 对当前已停止持久化的 `runtime-errors` 诊断流量，同时在 Caddy 处理合法来源的 OPTIONS 和 POST；合法预检返回 204，POST 返回 202，非法来源返回 403。该路径仍然丢弃诊断内容，不应将“请求返回 202”解释成“已存入异常数据库”。广告业务确认接口继续到 API。
- API 的合法 CORS 预检缓存 600 秒。
- 新 API、Worker 容器配置 Docker 日志轮转：每文件 50 MB，保留 3 个；Caddy 运行日志也配置轮转。

## 最终生产参数

| 参数 | 生产值 |
|---|---:|
| `TOKIO_WORKER_THREADS` | 2 |
| `API_DB_CONCURRENCY` | 96 |
| `API_DB_CONCURRENCY_PER_APP` | 24 |
| `API_DB_QUEUE_LIMIT` | 512 |
| `API_DB_QUEUE_LIMIT_PER_APP` | 128 |
| `API_DB_RESERVED` | 24 |
| `API_DB_QUEUE_WAIT_MS` | 1000 |
| `API_DATABASE_CONNECTION_LIMIT` | 6 |
| `WORKER_DATABASE_CONNECTION_LIMIT` | 1 |

代码和示例文件中的 API 连接数默认仍为 2，作为更保守的部署默认；当前生产 v6 明确设置为 6，候选 v8 使用 2。数据库连接数与 HTTP 处理并发数是不同的参数。

PgBouncer 当前 `max_client_conn=300`、`max_user_connections=60`。后续滚动发布须计算 API、Worker、探针及其他任务的总连接预算。以 47 个应用全部占满连接为例，旧 API 3 + 候选 API 2 + Worker 1 约为 282 个连接，另需计入探针等开销；两套 API 同时各 3 个则理论超过 300，不能直接照搬配置启动第二套满容量实例。

## 部署和策略边界

- 基础 Git 提交为 `13f85b2`，本次通过隔离 CPU 修复构建产物覆盖部署。运行镜像为 `quickreels-api:cpu-fix-20261102-v2`，最终 API 和 Worker 容器名均带 `cpu-fix-20261102-v3`。容器版本与镜像标签的区别来自后续线程、容量环境参数调整。
- 最终 API：`quickreels-api-cpu-fix-20261102-v3`。
- 最终 Worker：`quickreels-worker-cpu-fix-20261102-v3`。
- Caddy 指向 `api-cpu-fix-v3:3000`。管理后台沿用原容器。
- API、Worker 均设置 `unless-stopped`；服务器 `.env.production` 已保存最终参数，Caddy 的磁盘文件与容器读取文件校验一致。
- 发布目录：`/opt/quickreels/releases/cpu-fix-20261102/`。其中 `backup-directory` 记录安全备份目录，`active-api`、`active-worker` 记录当前活跃容器，原始构建包及配置快照保存在该目录或对应备份目录。
- 本次未自动关闭 HeartReel、SweetReel 或其他入口广告策略。核对期间发现 6 个应用策略与最初备份不同；管理审计日志显示这些更新有后台管理员操作记录，已保留这些业务调整，没有用旧备份覆盖。
- 本地原有的预览策略、Mini 前端及其他应用改动未混入本次 CPU 修复产物。
- 后续发布先核对实际活跃容器与 Caddy 上游；不能把已退出的 `quickreels-api-1` 当成当前业务 API。回退也必须同步调整代理上游，保留备份中的镜像、配置及源代码对应关系。

## 测试和生产验收

- 本地完整 API 类型检查通过；API 测试共 245 项，其中 244 项通过、1 项跳过、0 项失败。用于生产的隔离源码另运行 244 项，其中 243 项通过、1 项跳过、0 项失败。跳过项为需要单独 PostgreSQL 环境的测试，不能按通过计算。
- 新增队列容量、排队取消、额度释放、关键请求优先、跨应用隔离及会话串行处理测试。
- 独立 PostgreSQL 临时容器验收通过：两个独立 API/Prisma 实例同时完成同一事件只计一次；不同事件竞争同一广告序号只计一次；完整观看模式提前关闭不计数；旧展示计数模式可正常推进；过载返回重试指引后再次提交不重复计数。测试数据库独立于生产数据库，结束后删除。
- 生产 47 个已配置应用的首页/公开列表接口全部返回 200。
- `/live`、`/ready`、管理后台公开页面返回 200。API、Worker 无重启循环，数据库和 PgBouncer 健康。

北京时间 10:49—10:50 左右的短时样本：

| 指标 | 修复前排查样本 | 全量切换后的稳定样本 |
|---|---:|---:|
| 整机 CPU（user + system） | 约 66%—98%，采样窗口不同 | 约 33%—39% |
| API CPU | 约 9.2—9.8 核 | 约 2.27 核 |
| 每秒上下文切换 | 约 45 万—65 万 | 约 10.8 万—11.4 万 |
| 最近 120 秒日志中的 503、500、P2028 | 此前大量出现 | 该稳定窗口未观察到 |
| 入口广告完成成功样本 P95 | 未取得同口径基线 | 约 139 ms |
| 首页成功样本 P95 | 未取得同口径基线 | 约 77 ms |

随后一个 20 秒的准入计数差分：放行 9290 次，约 464 次/秒，拒绝增量为 0。这个数字是经过准入控制的请求速率，排除了 OPTIONS 和部分直接忽略的诊断事件，不是网站完整 HTTP QPS。

生产成功请求日志采用抽样，错误日志也有合并计数；不能用这些日志条数直接计算全量成功率。切换初期曾出现短暂拒绝，容器累计拒绝数不为零。

## 仍需单独跟进的现象

CPU 下降不代表所有终端网络问题都已消失。同一时段通过服务器本机 TLS 入口请求首页约 24—30 ms，API `Server-Timing` 约 0.3—0.4 ms；经公网请求总耗时出现约 0.46—1.83 秒波动，部分耗时出现在 TLS 建连或响应传输阶段。此前也采到更长的公网总耗时。尚未核实云带宽上限，不能直接认定带宽饱和，更不能将这种差异归咎于数据库。

仍有少量 401、入口广告未确认/会话冲突的 409，以及客户端断开连接记录。最近一次五分钟代理错误样本中的一条 502 明确为 `client disconnected`，未发现新的 `no upstreams available`。这些与之前大批数据库获取超时、整站摘除不是同一种证据，后续应按各自字段排查。

本次验收覆盖服务端、数据库并发与接口兼容性，没有完成 TikTok 真机广告展示的端到端验收，也不能证明 SDK 的环境检查错误已被修复。后续应继续核对真实高峰窗口的 CPU、拒绝率和端到端延迟。

## 证据文件与复验入口

- `output/cpu-fix-runtime-stable-20261102.txt`
- `output/cpu-fix-final-delta-20261102.txt`
- `output/cpu-fix-postgres-acceptance-20261102.txt`
- `apps/api/scripts/cpu-postgres-acceptance.cjs`，先构建 API 后使用 `pnpm --filter api test:cpu:postgres`；入口强制校验隔离测试数据库主机，禁止指向生产库。
- 本次线程参数依据：[Tokio Builder 官方说明](https://docs.rs/tokio/latest/tokio/runtime/struct.Builder.html)。具体收益以上述生产采样为依据。

## 2026-11-02 后续热点分流修复

上一版 v6 在高峰仍出现准入队列超时，日志集中在 `sugarreel` 和 `dramablaze` 的 `/home`，同时入口广告完成、匿名会话和广告事件占用主要并发槽。直接把第二 API 实例扩大到连接池 6 会触发 PgBouncer `max_client_conn`，因此没有采用全量双实例。

本轮在 API 首页路由增加了已完成公开首页缓存的快速路径：未登录、公开首页缓存命中时不占用数据库准入槽；缓存仍按小程序、语言和地区隔离，个性化首页和其他接口保持原准入与广告事务保护。对应测试覆盖了缓存命中、个性化请求和准入满载场景。

生产当前保留 v6 作为默认 API，并让 v8 候选实例以 `API_DATABASE_CONNECTION_LIMIT=2` 只承接 `/api/sugarreel/v1/*`、`/api/dramablaze/v1/*`。Caddy 配置已校验且宿主机与容器哈希一致；`/live`、`/ready`、两个热点首页以及 HeartReel、StoryHub、主路由均返回 200。入口广告策略未关闭，Worker 和管理后台未重启。

60 秒热点灰度窗口中 v8：放行 14,263 个准入请求、拒绝 0，队列归零；抽样日志无 5xx，首页成功 P95 约 85 ms（SugarReel）和 13 ms（DramaBlaze）。随后继续观察时仅出现极少量首页 503，且没有数据库 `max_client_conn` 错误。v6 及 PostgreSQL 仍承担其他应用流量，整机 CPU 不能据此宣称已恢复到低位；当前主要 CPU 来源仍是 API 与 PostgreSQL 的高并发业务查询，Worker 和后台不是主要来源。

生产持久化记录：`/opt/quickreels/releases/cpu-fix-home-cache-20261102/`。`.env.production` 中的运行参数已与 v6 实际参数对齐，非目标配置保持不变；`active-api`、`active-worker` 及热点候选标记已更新。若继续扩大分流，必须先按实际 PgBouncer 客户端连接上限计算两套 API、Worker、探针和迁移任务的总连接数，不能直接把热点实例切到全部 47 个应用。

## 2026-11-02 连接上限修复

热点分流后的现场复核发现，PgBouncer 的 `max_client_conn=300` 已被当前连接预算完全占满：v6 API 246 条、Worker 47 条、v9 热点 API 7 条，共 300 条。PgBouncer 日志持续出现 `no more connections allowed (max_client_conn)`，这是新连接被拒绝的直接原因；PostgreSQL 当时仍可接受连接，不能把该现象归因于 PostgreSQL `max_connections`。

本轮将 PgBouncer 生成配置的客户端上限从 300 提高到 500，并在文件句柄上限为 1,048,576 的前提下热加载运行配置。生产容器未重启，原有 API、Worker、PostgreSQL 和管理后台未停止；修改前配置和容器文件备份在 `/opt/quickreels/releases/cpu-followup-20261102/pgbouncer-capacity-*/`。同时构建了 `quickreels-pgbouncer:cpu-followup-20261102` 并重新标记默认镜像，保证后续按现有 Compose 重建时使用 500 上限。

热加载后验证：运行容器健康、重启次数不变，运行配置显示 `max_client_conn = 500`，35 秒窗口内 PgBouncer 上限错误为 0，已建立客户端连接约 299；`/ready`、SugarReel、DramaBlaze、HeartReel、StoryHub 首页均返回 200。PgBouncer 的 `LOG stats` 仍显示约 1,300 xacts/s，说明数据库业务负载仍然较高；本次只修复连接入口耗尽，不宣称数据库 CPU 已完全解决。

本地验证：`deploy/pgbouncer/config.test.mjs` 2 项通过，API TypeScript 检查通过，mini-web 测试 64 项通过。SugarReel 和 DramaBlaze 也用当前前端代码重新生成发布包，旧包已备份到 `output/cpu-followup-packages-20261102/`。两包尚未上传 TikTok Portal，真机广告链路仍需实际版本验证。

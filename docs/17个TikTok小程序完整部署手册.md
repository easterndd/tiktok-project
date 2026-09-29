# 17 个 TikTok Mini 小程序完整部署手册

适用范围：StoryLand、DramaCloud、DailyReel、DramaOne、DramaUp、DramaVault、TaleHub、TaleBox、StoryWorld、StoryHub、DramaRoom、DramaZone、TaleFlick、DramaShort、StoryShort、StoryFlicks、DramaFlicks。本文只处理这 17 个新应用；CineReels、TaleReels 的旧手册不能直接照抄来部署本批应用。

本手册以仓库当前实现为准：17 个 Mini 共用 `apps/mini-web/src`、API/Worker 进程和可选的 BytePlus 媒资；每个应用有独立的目录、App ID、Client Key/Secret、API 路径、PostgreSQL schema 和管理员记录。**目前仓库只提供代码、数字 App ID 和配置模板，不包含这 17 个应用的真实 Client Key/Secret，也不表示服务器已建库或 Portal 已发布。**

## 0. 执行原则与停步条件

1. 在本地 Windows PowerShell、服务器 SSH Bash 和 TikTok Developer Portal 三处操作；每段命令只在标注的环境执行。
2. 开始前确认服务器项目确实在 `/opt/quickreels`，运行 `compose.production.self-hosted.yml`，数据库确实是该 Compose 的 `postgres` 服务。若实际部署方式不同，先按现网配置调整，不要盲跑。
3. 必须先拿到**每个应用各自**的 Client Key 和 Client Secret，核对 App ID。只有 App ID 不能制作可发布 Mini 包或完成真实 TikTok API 集成。广告位 ID 暂时没有也可以部署免费剧集，但不要启用广告解锁或入口广告。
4. 执行任何 `git add`/推送前检查工作树。本仓库可能有其他未提交工作；不要使用 `git add .`、`git reset --hard`、`git checkout --` 或 `docker compose down -v`。
5. 每个 PostgreSQL schema 必须独立。发现同名 schema 已存在时，先确认是否为已有数据，**不要删除、重建、覆盖或执行 seed**。
6. 下面的批量循环可以分批执行（建议每批 3-5 个应用）。只有设置某应用的 `*_DATABASE_URL` 后，该应用的 API 路由才会注册；先完成本批迁移和测试，再启用下一批。

## 1. 应用对照表

内部 key 全部小写，服务端环境变量前缀全部大写。文字中偶见的 `DDramaCloud`、`DallyReel`、`过StoryShort` 是笔误，以 Portal 截图名称和下表为准。

| Portal 名称 | 内部 key / schema | 环境变量前缀 | App ID |
| --- | --- | --- | --- |
| StoryLand | `storyland` | `STORYLAND` | `7688943418164168712` |
| DramaCloud | `dramacloud` | `DRAMACLOUD` | `7688943418164152328` |
| DailyReel | `dailyreel` | `DAILYREEL` | `7688950749593913351` |
| DramaOne | `dramaone` | `DRAMAONE` | `7688966971530790930` |
| DramaUp | `dramaup` | `DRAMAUP` | `7688988654946224135` |
| DramaVault | `dramavault` | `DRAMAVAULT` | `7688951405058476039` |
| TaleHub | `talehub` | `TALEHUB` | `7688950116430546962` |
| TaleBox | `talebox` | `TALEBOX` | `7688988654946174983` |
| StoryWorld | `storyworld` | `STORYWORLD` | `7688988654946158599` |
| StoryHub | `storyhub` | `STORYHUB` | `7688967178649192456` |
| DramaRoom | `dramaroom` | `DRAMAROOM` | `7688967178649176072` |
| DramaZone | `dramazone` | `DRAMAZONE` | `7688948113436035080` |
| TaleFlick | `taleflick` | `TALEFLICK` | `7688947791741175816` |
| DramaShort | `dramashort` | `DRAMASHORT` | `7689003242769467410` |
| StoryShort | `storyshort` | `STORYSHORT` | `7688988654946076679` |
| StoryFlicks | `storyflicks` | `STORYFLICKS` | `7688966971530758162` |
| DramaFlicks | `dramaflicks` | `DRAMAFLICKS` | `7688943418164119560` |

每个前端目录是 `apps/<key>`，API 是 `https://api.evergreenprosper.com/api/<key>/v1`。App ID 已写在各自 `minis.config.json`，但正式构建前仍须与 Portal 逐项复核。`VITE_APP_KEY` 是内部 key，由各目录 `vite.config.ts` 固定，**不是 Portal 提供的第四个凭据**，不需要填到 `.env`。

## 2. Portal 与法律页前置核对

对 17 个应用分别确认在 TikTok Developer Portal 中有 App ID、Client Key、Client Secret，并记录在你自己的安全凭据管理位置。不要把 Secret 发到聊天、提交到 Git 或放进前端 `.env`。

以下三个字段对 17 个应用相同：

| Portal 字段 | 填写值 |
| --- | --- |
| Privacy policy URL | `https://www.yya.ai/capy/privacypolicy.html` |
| Terms of Service URL | `https://www.yya.ai/capy/termsofservice.html` |
| Domain of your service | `https://www.yya.ai` |

**Trusted Domains 另加** `https://api.evergreenprosper.com`，它是 Mini 实际请求的 API 主机；不要把 `/api/<key>/v1` 路径或 `https://www.yya.ai` 当作 API Trusted Domain 的替代。Portal 字段与 Trusted Domains 是两组配置，逐个应用保存、复查。

在可联网的终端检查公共法律页最终 HTTP 状态为 200、无需登录，内容确实显示 `SAGATHIYA TECHSOLUTIONS PRIVATE LIMITED`，并由业务/法务确认主体、联系邮箱、地址、数据处理和适用法律与实际情况一致：

```powershell
curl.exe -IL https://www.yya.ai/capy/privacypolicy.html
curl.exe -IL https://www.yya.ai/capy/termsofservice.html
```

Mini 内置 Profile 的 Privacy Policy / Terms of Service 是代码随包构建的，不会因 Portal 修改外链自动更新。当前代码为这 17 个品牌生成 SAGATHIYA 主体、各自品牌名以及 `caijiarong2@xuyins.com` 联系邮箱。`deploy/website/<key>/` 下的静态导出文件只是可选产物；使用上面统一的 `www.yya.ai/capy/*.html` Portal URL **不需要**把 17 组静态文件部署到 evergreenprosper.com，也不需要修改其 Caddy 站点。

## 3. 本地填写 17 个前端 `.env`（Windows PowerShell）

打开仓库并确认依赖和 Git 状态：

```powershell
Set-Location 'D:\my project\tiktok-project'
git status --short
pnpm install --frozen-lockfile
pnpm -r lint
pnpm --filter api test
```

为本批应用创建 `.env`，已有文件不覆盖：

```powershell
$apps = @(
  'storyland','dramacloud','dailyreel','dramaone','dramaup','dramavault',
  'talehub','talebox','storyworld','storyhub','dramaroom','dramazone',
  'taleflick','dramashort','storyshort','storyflicks','dramaflicks'
)
foreach ($key in $apps) {
  $target = "apps/$key/.env"
  if (-not (Test-Path -LiteralPath $target)) {
    Copy-Item -LiteralPath "apps/$key/.env.example" -Destination $target
  }
}
```

逐个编辑。例如 `notepad apps/storyland/.env`；只替换 Client Key，其他行沿用模板：

```env
VITE_API_BASE_URL=https://api.evergreenprosper.com/api/storyland/v1
VITE_TIKTOK_CLIENT_KEY=<StoryLand 的真实 Client Key>
VITE_DEMO_MODE=false
VITE_USE_MOCK_API=false
VITE_ENABLE_MOCK_FALLBACK=false
```

其他应用把路径中的 `storyland` 和 Client Key 换成自己的值。每个 `.env` 的 API 路径必须与目录 key 一致；不要添加 Client Secret、数据库密码、BytePlus AK/SK 或广告位占位符。`.env` 已被 `.gitignore` 忽略。保存后逐项复查，不要把实际 Key 输出到终端或截图：

```powershell
foreach ($key in $apps) {
  $content = Get-Content -Raw "apps/$key/.env"
  if ($content -notmatch [regex]::Escape("VITE_API_BASE_URL=https://api.evergreenprosper.com/api/$key/v1") -or
      $content -match 'REPLACE_WITH|<.*>|VITE_DEMO_MODE=true|VITE_USE_MOCK_API=true') {
    throw "请检查 apps/$key/.env 的 API 地址、Client Key 和生产开关"
  }
}
```

## 4. 提交完整代码，不遗漏新目录

**先确认要发布的是哪个 Git 分支和提交，不要机械地推送 `main`。** 当前工作树可能混有其他任务的改动，尤其共享 API、管理后台和 `pnpm-lock.yaml`。不要为了部署而清除它们。完整发布至少需要 17 个 `apps/<key>/`、`apps/mini-web/src/lib/app-catalog.ts`、共享法律页/品牌代码、API 注册与校验代码、管理后台代码、两个 Compose 文件、环境示例和锁文件。CineReels/TaleReels 若仍是未跟踪目录，且当前共享代码或构建依赖它们，也须一并纳入经过审核的发布提交。

先只暂存本批新增目录和本手册（`git add` 会遵守 `.gitignore`，不会纳入 `.env`、`dist`、`node_modules`）：

```powershell
git add -- docs/17个TikTok小程序完整部署手册.md
foreach ($key in $apps) {
  git add -- "apps/$key" "deploy/website/$key"
}
```

再逐个查看并暂存所需的共享文件，特别注意其中可能混有其他工作；可用 `git add -p -- <file>` 分块暂存，不要直接 `git add .`。应检查的核心路径包括：`apps/api/src/app.ts`、`apps/api/src/config/{env,mini-apps}.ts`、`apps/api/src/{lib/content-access.ts,plugins/auth.ts,services/shared-platform.service.ts,modules/admin/routes.ts,multi-app.test.ts}`、`apps/mini-web/src/{lib/app-catalog.ts,lib/app-brand.ts,pages/legal-docs.ts,pages/LegalPage.tsx}`、`apps/mini-web/scripts/export-legal-pages.mjs`、`apps/admin-web/src/main.tsx`、`apps/admin-web/Dockerfile`、两个 Compose 文件、两个生产 `.env` 示例和 `pnpm-lock.yaml`。如果 `apps/admin-web/src/main.tsx` 仍导入 `drama-materials`，发布提交还必须包含被导入的 `apps/admin-web/src/drama-materials.tsx` 及其 CSS，或确认它们已在目标提交中；否则服务器构建后台会失败。

```powershell
git diff -- apps/api/src/config/mini-apps.ts apps/api/src/config/env.ts apps/api/src/app.ts
git diff -- apps/mini-web/src/pages/legal-docs.ts apps/admin-web/src/main.tsx
git status --short
git diff --cached --name-status
git diff --cached --check
git diff --cached -- apps/admin-web/src/main.tsx apps/api/src/config/mini-apps.ts
```

把确定属于本次发布的共享改动逐块暂存。`git add -p` 会逐块询问，输入 `y` 暂存、`n` 跳过；不确定的块先跳过，继续检查依赖后再处理：

```powershell
git add -- apps/mini-web/src/lib/app-catalog.ts
$sharedPaths = @(
  'apps/api/src/app.ts', 'apps/api/src/config/env.ts',
  'apps/api/src/config/mini-apps.ts', 'apps/api/src/lib/content-access.ts',
  'apps/api/src/modules/admin/routes.ts', 'apps/api/src/multi-app.test.ts',
  'apps/api/src/plugins/auth.ts', 'apps/api/src/services/shared-platform.service.ts',
  'apps/mini-web/src/lib/app-brand.ts', 'apps/mini-web/src/pages/LegalPage.tsx',
  'apps/mini-web/src/pages/legal-docs.ts',
  'apps/mini-web/scripts/export-legal-pages.mjs',
  'apps/admin-web/src/main.tsx', 'apps/admin-web/Dockerfile',
  'apps/admin-web/.env.example', '.env.production.example',
  '.env.production.self-hosted.example',
  'compose.production.yml', 'compose.production.self-hosted.yml',
  'pnpm-lock.yaml'
)
foreach ($path in $sharedPaths) { git add -p -- $path }
git diff --cached --check
git diff --cached --name-status
```

`git add -p` 不会暂存其他新建文件；若当前 `main.tsx` 依赖尚未跟踪的 `drama-materials.tsx`/CSS，先审查，再用 `git add -- apps/admin-web/src/drama-materials.tsx apps/admin-web/src/drama-materials.css` 纳入。其它缺失的基础文件同理处理。只有法律页导出文件、没有后端/管理后台/锁文件的提交，不能用于本次部署。

在提交前确保共享修改、CineReels/TaleReels 的必要基础文件、17 个目录和锁文件都已纳入；无关改动未纳入。运行构建/测试，并用 `git diff --cached` 审阅最终提交内容。只有在发布提交完整且服务器能从该提交构建时才执行：

```powershell
git branch --show-current
git diff --cached --stat
git commit -m "feat: add 17 TikTok Mini apps"
git push origin HEAD
git rev-parse HEAD
```

记录完整提交号和分支名。**未提交/未推送的本地文件不会出现在服务器**。若 `git commit` 提示没有暂存文件，或 `git diff --cached` 中缺少关键共享文件，停止部署并先补全提交。

## 5. SSH 登录服务器、核对环境并备份

在本地 PowerShell 登录实际服务器（地址以当前运维记录为准）：

```powershell
ssh ubuntu@<server-ip-or-host>
```

以下命令在服务器 Bash 执行。先核对部署目录、当前提交、工作树、磁盘和容器；有未提交改动时先查明，不要覆盖：

```bash
cd /opt/quickreels
git status --short
git rev-parse HEAD
df -h .
export ENV_FILE=/opt/quickreels/.env.production
export COMPOSE_FILE=compose.production.self-hosted.yml
test -f "$ENV_FILE" || { echo '生产环境文件不存在'; exit 1; }
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
```

确认目标分支与本地推送一致、工作树适合快进后拉取。把 `<deployment-branch>` 换成第 4 节确认的分支名，**不要把占位符原样执行**：

```bash
git fetch origin <deployment-branch>
git merge --ff-only FETCH_HEAD
git rev-parse HEAD
git status --short
```

服务器 HEAD 必须等于本地记录的提交号。若快进失败、工作树不干净、Compose 文件不同或缺少 17 个目录，停止；不要强制覆盖或继续迁移。

迁移前备份整个现有 PostgreSQL 数据库，备份文件留在服务器受限目录，确认大小非零且有足够空间：

```bash
umask 077
mkdir -p "$HOME/quickreels-backups"
BACKUP_FILE="$HOME/quickreels-backups/before-17-minis-$(date +%Y%m%d-%H%M%S).dump"
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP_FILE"
test -s "$BACKUP_FILE" || { echo '备份失败，停止部署'; exit 1; }
ls -lh "$BACKUP_FILE"
```

如果 `SHARED_PLATFORM_DATABASE_URL` 指向另一数据库，应按其现有备份方案另做备份。不要把数据库备份、生产 `.env` 或凭据提交到 Git。

## 6. 服务器填写 `.env.production`

先备份环境文件，保留原有 `DATABASE_URL`、BytePlus、CORS、JWT 和其他应用配置，**只追加/修改本批应用所需变量**：

```bash
sudo cp -a "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
sudo nano "$ENV_FILE"
```

每个应用填写一组。以 StoryLand 为例，尖括号内必须替换为真实值；数据库用户/密码/主机/库名沿用现有 PostgreSQL 配置，密码包含 URL 特殊字符时需 URL 编码：

```env
STORYLAND_DATABASE_URL=postgresql://quickreels:<URL编码后的数据库密码>@postgres:5432/quickreels?schema=storyland&connection_limit=1
STORYLAND_TIKTOK_CLIENT_KEY=<StoryLand Client Key>
STORYLAND_TIKTOK_CLIENT_SECRET=<StoryLand Client Secret>
STORYLAND_TIKTOK_APP_ID=7688943418164168712
VITE_STORYLAND_API_BASE_URL=https://api.evergreenprosper.com/api/storyland/v1
```

对表中其余 16 个应用，依次填写 `<PREFIX>_DATABASE_URL`、`<PREFIX>_TIKTOK_CLIENT_KEY`、`<PREFIX>_TIKTOK_CLIENT_SECRET`、`<PREFIX>_TIKTOK_APP_ID` 和 `VITE_<PREFIX>_API_BASE_URL`。schema、API 路径是对应小写 key，App ID 是表中的数字。仓库的 `.env.production.self-hosted.example` 已列出全部变量名和 App ID；不要把示例的 `<...>` 留在生产环境文件中。`connection_limit=1` 是为同时启用 17 个 API/Worker 上下文控制 PostgreSQL 连接数的起步值，后续按实际负载与数据库容量调整。**不要在 Bash 里 `source`/`.` 这个 Docker `.env` 文件**，含 `&` 的 URL 和特殊密码可能被 Shell 错误解析。

可选广告变量仅在对应广告位已经创建、确认类型后填写：

```env
# STORYLAND_REWARDED_PLACEMENT_ID=<真实的 StoryLand 激励广告位 ID>
# STORYLAND_APP_ENTRY_PLACEMENT_ID=<真实的 StoryLand 入口广告位 ID>
# VITE_STORYLAND_REWARDED_PLACEMENT_ID=<同一个激励广告位 ID>
# VITE_STORYLAND_APP_ENTRY_PLACEMENT_ID=<同一个入口广告位 ID>
```

没有广告位时保持未设置，在后台创建内容时关闭激励广告解锁，不要借用其他应用的广告位。`BYTEPLUS_*` 继续沿用现有配置；内容授权和共享媒资不等于自动复制剧集，见第 11 节。

用 Compose 只做配置解析检查，`--quiet` 不会打印含 Secret 的解析结果；不要执行不带 `--quiet` 的 `config` 并把输出贴到聊天或日志：

```bash
export QUICKREELS_ENV_FILE="$ENV_FILE"
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
```

## 7. 建立 17 个 schema、构建镜像并迁移

以下数组是本批全部应用。分批部署时只把本批 key 留在数组中，后续批次重复本节及之后步骤：

```bash
APP_KEYS=(
  storyland dramacloud dailyreel dramaone dramaup dramavault
  talehub talebox storyworld storyhub dramaroom dramazone
  taleflick dramashort storyshort storyflicks dramaflicks
)
```

先列出已有 schema 并与上面 17 个 key 对照；如果同名 schema 已存在，核查表和数据、确认是否属于这次应用，禁止直接覆盖：

```bash
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dn"'
```

核对完成后创建不存在的 schema。下方 key 只来自上面的固定清单：

```bash
for key in "${APP_KEYS[@]}"; do
  sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -c "CREATE SCHEMA IF NOT EXISTS \"$1\" AUTHORIZATION \"$POSTGRES_USER\";"' sh "$key" \
    || { echo "创建 $key schema 失败，停止"; exit 1; }
done
```

先构建新镜像，**暂不重启现网服务**：

```bash
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build api worker admin
```

逐个用对应 `*_DATABASE_URL` 执行生产迁移。变量名作为参数传入容器，在容器里用 `printenv` 读取 URL，避免把 `.env.production` 当 Shell 脚本执行或把数据库密码写到命令行：

```bash
for key in "${APP_KEYS[@]}"; do
  prefix="${key^^}"
  echo "Migrating schema: $key"
  sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm --no-deps -T \
    -e APP_DB_ENV="${prefix}_DATABASE_URL" api sh -ec '
      db_url="$(printenv "$APP_DB_ENV")"
      test -n "$db_url" || { echo "Missing $APP_DB_ENV"; exit 1; }
      export DATABASE_URL="$db_url"
      exec npx --no-install prisma migrate deploy
    ' || { echo "$key 迁移失败，停止"; exit 1; }
done
```

每个 schema 的迁移必须成功；失败时停止，不要执行下一节或 `prisma migrate dev`、`db:seed`、`docker compose down -v`。需要确认迁移状态时，对单个 key 用相同的 `APP_DB_ENV` 方式执行 `npx --no-install prisma migrate status`。生产内容不会由迁移自动复制。

## 8. 创建各自的 OWNER 管理员

每个 schema 都要独立创建管理员。可使用已确认属于这些应用的邮箱（例如 `caijiarong2@xuyins.com`），但每个应用建议设置独立强密码；同一邮箱在不同 schema 中是不同账号。不要把管理员密码写入 `.env.production`。

对每个 key 输入密码。下方使用标准输入传给容器，避免在 `docker -e NAME=value` 的命令行参数里出现密码；密码不会回显。已有账号时 bootstrap 不会重置密码，需走现有管理员密码恢复流程：

```bash
read -r -p '管理员邮箱: ' ADMIN_EMAIL
for key in "${APP_KEYS[@]}"; do
  prefix="${key^^}"
  read -r -s -p "$key 管理员密码（至少 12 位）: " ADMIN_PASSWORD
  printf '\n'
  printf '%s\n' "$ADMIN_PASSWORD" | sudo docker compose --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" run --rm --no-deps -T -i \
    -e APP_DB_ENV="${prefix}_DATABASE_URL" \
    -e ADMIN_BOOTSTRAP_EMAIL="$ADMIN_EMAIL" api sh -ec '
      IFS= read -r ADMIN_BOOTSTRAP_PASSWORD
      export ADMIN_BOOTSTRAP_PASSWORD
      db_url="$(printenv "$APP_DB_ENV")"
      test -n "$db_url" || { echo "Missing $APP_DB_ENV"; exit 1; }
      export DATABASE_URL="$db_url"
      exec node dist/scripts/bootstrap-admin.js
    ' || { echo "$key 管理员初始化失败，停止"; exit 1; }
  unset ADMIN_PASSWORD
done
unset ADMIN_EMAIL ADMIN_PASSWORD
```

每次应看到 `Administrator created.` 或 `Administrator already exists; no changes were made.`。如果输入出错、中途失败，先查明该 schema 是否已建管理员，再继续。

## 9. 启动容器与 API 验收

数据库迁移及管理员均完成后，更新 API、Worker 和管理后台；Postgres 不需要重建：

```bash
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps --force-recreate api worker admin
sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
curl -fsS https://api.evergreenprosper.com/ready
```

`/ready` 只证明主数据库可用，**不能代替逐应用检查**。逐应用请求公开剧目列表，迁移完成后即使列表为空也应返回 200。`404` 表示该 key 未注册、数据库 URL 没进入新容器或 API 仍是旧镜像；`5xx` 要查看对应 schema 的迁移和 API 日志：

```bash
for key in "${APP_KEYS[@]}"; do
  printf '%s: ' "$key"
  curl -sS -o /dev/null -w '%{http_code}\n' \
    "https://api.evergreenprosper.com/api/$key/v1/albums"
done
```

另选一两个应用用空登录请求抽查管理路由，预期 `400 VALIDATION_ERROR`。管理员登录接口限流为 15 分钟 10 次，不要连续对 17 个应用批量 POST；若返回 `429`，按限流时间等待，不要误判为路由 404：

```bash
curl -i -X POST https://api.evergreenprosper.com/api/storyland/v1/admin/auth/login \
  -H 'content-type: application/json' -d '{}'
```

再核对容器环境变量**只显示是否存在，不打印 Secret**：

```bash
for key in "${APP_KEYS[@]}"; do
  prefix="${key^^}"
  sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T \
    -e APP_DB_ENV="${prefix}_DATABASE_URL" api sh -c \
    'test -n "$(printenv "$APP_DB_ENV")" && echo "$APP_DB_ENV configured"'
done
```

到管理后台切换各品牌分别登录，检查每个应用的内容、广告位默认值和权限互不串用。新后台即使列出未配置的应用，也不代表该应用 API 已启用；以对应 API 和登录验证为准。排查时查看 `docker compose logs --tail=100 api worker admin`，注意不要把含凭据的日志发到公开渠道。

## 10. 本地构建 17 个 Mini ZIP 并逐个上传

**回到 Windows PowerShell。** 确认各 `.env` 真实 Client Key、对应 API 路径和 App ID，且服务器 API 已通过第 9 节。先安装仓库锁定依赖，再逐个构建：

```powershell
Set-Location 'D:\my project\tiktok-project'
pnpm install --frozen-lockfile
# 防止当前 PowerShell 会话中的旧应用值覆盖各目录 .env。
Remove-Item Env:VITE_API_BASE_URL, Env:VITE_TIKTOK_CLIENT_KEY -ErrorAction SilentlyContinue
$apps = @(
  'storyland','dramacloud','dailyreel','dramaone','dramaup','dramavault',
  'talehub','talebox','storyworld','storyhub','dramaroom','dramazone',
  'taleflick','dramashort','storyshort','storyflicks','dramaflicks'
)
foreach ($key in $apps) {
  pnpm --filter $key build:minis:release
  if ($LASTEXITCODE -ne 0) { throw "$key 正式构建失败，停止上传" }
  if (-not (Test-Path -LiteralPath "apps/$key/dist/minis.config.zip")) {
    throw "$key 缺少发布 ZIP"
  }
}
```

`build:minis:release` 会执行 Vite 构建、`ttdx minis build --prod`、`ttdx minis check --output`、`check-release.mjs` 并打包。此前只运行 `pnpm --filter <key> build` 得到的 `dist` **不是**可上传的 Mini ZIP；检查失败时不能拿旧 ZIP 继续上传。不要在 Mini 包中放 Client Secret 或生产数据库 URL。

逐个在对应 Portal 的 Preview 上传 `apps/<key>/dist/minis.config.zip`；每次对照 Portal 名称、App ID 与表中行，不能交叉上传。先 Preview 真机验证，通过后再按 Portal 审核/发布流程提交；后台 API 发布不等于 Mini 代码包自动发布。

## 11. 真机、内容和广告验收

每个应用至少验证：首次打开与匿名会话、首页加载、搜索、免费集播放、续播进度、收藏/历史、Profile 内置 Privacy Policy 和 Terms of Service。内置页应显示当前品牌、`SAGATHIYA TECHSOLUTIONS PRIVATE LIMITED`，并且不显示 `evergreenprosper` 为该应用的运营主体。

新 schema 迁移后只有表结构，**不会自动出现主应用或其他 Mini 的剧目**。按业务方案在该应用后台创建内容，或使用现有“共享剧目/授权播放”流程：源剧目需满足平台审核与上架条件，目标 Mini 需要真实 Client Key、独立管理员权限和平台授权成功。BytePlus VID 可以复用，但仍需确认每个目标应用确实有本地映射、可见且能播放；不要仅凭 API 200 判断授权完成。

没有该应用自己的广告位 ID 时，内容访问策略关闭激励广告解锁和入口广告。以后新增广告位，再按各应用前缀填写服务器 `*_REWARDED_PLACEMENT_ID` / `*_APP_ENTRY_PLACEMENT_ID` 和可选 `VITE_*`，重建 API、Worker、Admin 及需要变更广告配置的 Mini 包，并验证只使用该应用自己的广告位。

若真机提示网络或匿名会话失败，依次检查：对应 Mini `.env` 的 HTTPS API 路径、Portal 的 `https://api.evergreenprosper.com` Trusted Domain、服务器 `API_CORS_ORIGIN` 是否包含实际 TikTok Mini Origin（现有配置应保留 `https://*.tiktokminis.us` 与 `https://*.tiktok-minis.us`）、`OPTIONS`/`POST` 返回码和 API 的 `Mini bootstrap request/response` 日志。不要把 `Domain of your service` 与 API Trusted Domain 混淆。

## 12. 故障停步与回退

| 现象 | 先检查 |
| --- | --- |
| `pnpm --filter <key> build:minis:release` 失败 | `.env` Client Key 是否仍是占位符；API URL 是否为生产 HTTPS；App ID 与 `minis.config.json` 是否一致；CLI 检查输出 |
| `/api/<key>/v1/admin/auth/login` 返回 404 | 服务器提交/镜像是否包含新注册表；`<PREFIX>_DATABASE_URL` 是否传入 API；容器是否已重建 |
| 迁移失败 | 对应 URL/schema 是否正确；该 schema 是否已有表；数据库权限与迁移日志。不要改用 `migrate dev` |
| 后台登录失败 | 是否选中正确应用；该 schema 的 OWNER 是否创建；输入的是对应密码；API 路由是否为本应用 |
| Mini 内置法律页仍显示旧主体 | 重新构建并上传**本应用** ZIP，在最新 Preview/发布版本中复查；改 Portal 外链不会更新内置页 |
| 首页空白或不能播放 | 该 schema 是否有内容、是否已授权/上架、地区可见性、BytePlus VID 与播放授权状态 |

发布前记录旧提交 SHA、新提交 SHA、备份文件路径和各 Portal 当前上线版本。出现问题时暂停继续上传和授权，保留日志与数据库备份。代码/镜像回退应根据记录的旧提交制作经过审查的回退发布；**迁移后的 schema 不要自动删除或用整库备份覆盖现网数据**，因为这会丢失部署后写入的内容。涉及数据库恢复时，先停写、核对恢复范围及时间点，再按正式备份恢复流程执行。

## 13. 最终核对清单

- [ ] 17 个 Portal 名称与 App ID 逐项匹配表格，Client Key/Secret 分别属于对应应用。
- [ ] 17 个前端 `.env` 只含公开值，生产服务器 `.env.production` 的 Secret 未进入 Git/Mini 包。
- [ ] 发布提交包含 17 个目录及所需共享代码/锁文件，服务器 HEAD 与本地记录一致。
- [ ] 已备份生产库；17 个独立 schema 均按当前迁移版本完成，未运行生产 seed。
- [ ] 每个 schema 独立有 OWNER，API/Worker/Admin 容器健康，17 个 `/albums` 均为 200；少量空登录抽查为 400 而非 404。
- [ ] 每个 Portal 均填写两条 `www.yya.ai/capy/*.html` 法律页、服务域名 `https://www.yya.ai` 及 API Trusted Domain。
- [ ] 17 个正式 ZIP 均通过发布检查，按 App ID 上传到对应 Portal；Preview 真机验证内置法律页、登录会话和免费播放。
- [ ] 内容授权、地区可见性、广告位及实际播放按应用逐个验收；正式审核/上线状态已记录。

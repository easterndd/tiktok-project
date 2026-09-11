# Local runbook

1. Copy `apps/api/.env.example` to `apps/api/.env` and `apps/mini-web/.env.example` to `apps/mini-web/.env`. Set `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` in the API environment when creating the first operations account.
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Run `pnpm install`, then `pnpm db:generate`, `pnpm db:migrate`, and `pnpm db:seed`.
4. Start the API with `pnpm dev:api` and the Mini H5 with `pnpm dev:mini`.
5. Before TikTok Preview, configure HTTPS, Trusted domains, current SDK fields, and real platform credentials.

Docker Desktop is required for step 2. It is not currently installed in this development environment.

公开 Mini 端语言仅保留去重后的语言码：`en`、`pt`、`fr`、`id`、`ja`、`es`、`ko`、`th`；投放国家作为内容地区元数据维护，运营后台固定为中文。

CMS 上线后请在后台检查每部剧的 `freeEpisodeCount`、`rewardedAdEnabled`、`rewardedPlacementId`，以及首页区块和页面组件开关。配置由 API 实时返回，修改后不需要重新构建 Mini。

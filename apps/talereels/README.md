# TaleReels

This TikTok Mini app reuses `apps/mini-web/src`. Copy `.env.example` to `.env`, fill its public Client Key, and replace `minis.config.json.appId` with the numeric App ID from the TaleReels Developer Portal account. The server uses `TALEREELS_DATABASE_URL` and `TALEREELS_TIKTOK_*` in `.env.production`.

Run `pnpm --filter talereels build:minis:release` after completing the server and portal configuration. See `docs/新增TikTok小程序执行手册.md` for the full workflow.

# CineReels

This TikTok Mini app reuses `apps/mini-web/src`. Copy `.env.example` to `.env`, fill its public Client Key, and replace `minis.config.json.appId` with the numeric App ID from the CineReels Developer Portal account. The server uses `CINEREELS_DATABASE_URL` and `CINEREELS_TIKTOK_*` in `.env.production`.

`VITE_MINI_RELEASE_ID` is the immutable key for this build (`cinereels-release-20261008`). In the admin console, select CineReels and load this key to keep its entry-ad gate separate from older builds; leave it disabled during review and enable it after approval. Use a new key for a later release.

Run `pnpm --filter cinereels build:minis:release` after completing the server and portal configuration. See `docs/新增TikTok小程序执行手册.md` for the full workflow.

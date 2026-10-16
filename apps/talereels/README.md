# TaleReels

This TikTok Mini app reuses `apps/mini-web/src`. Copy `.env.example` to `.env`, fill its public Client Key, and replace `minis.config.json.appId` with the numeric App ID from the TaleReels Developer Portal account. The server uses `TALEREELS_DATABASE_URL` and `TALEREELS_TIKTOK_*` in `.env.production`.

`build:minis:release` generates a unique code version for each ZIP, overriding any old `VITE_MINI_RELEASE_ID` in `.env`. It writes the version to `dist/minis.release.json` with the ZIP's SHA-256 hash. After a signed-in preview or launch, the package sends that version to the API, which automatically registers a disabled entry-ad policy. Refresh the TaleReels admin console after opening the package to configure its policy. Releasing the same reviewed package does not change its code version or policy.

Run `pnpm --filter talereels build:minis:release` after completing the server and portal configuration. See `docs/新增TikTok小程序执行手册.md` for the full workflow.

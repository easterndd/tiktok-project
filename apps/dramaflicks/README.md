# DramaFlicks

This TikTok Mini app reuses `apps/mini-web/src`. Copy `.env.example` to `.env` and fill its public Client Key. The numeric App ID is already set in `minis.config.json`; verify it against the DramaFlicks Developer Portal account. The server uses `DRAMAFLICKS_DATABASE_URL` and `DRAMAFLICKS_TIKTOK_*` in `.env.production`.

Run `pnpm --filter dramaflicks build:minis:release` after completing the server and portal configuration. Privacy Policy and Terms of Service use the SAGATHIYA entity; Portal links are `https://www.yya.ai/capy/privacypolicy.html` and `https://www.yya.ai/capy/termsofservice.html`.

In Developer Portal set Domain of your service to `https://www.yya.ai`; separately add `https://api.evergreenprosper.com` to Trusted Domains for API calls. Create a dedicated PostgreSQL schema named `dramaflicks`, migrate it, and provide the real Client Key/Secret before building a release ZIP.

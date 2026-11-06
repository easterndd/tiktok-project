# StoryLand

This TikTok Mini app reuses `apps/mini-web/src`. Copy `.env.example` to `.env` and fill its public Client Key. The numeric App ID is already set in `minis.config.json`; verify it against the StoryLand Developer Portal account. The server uses `STORYLAND_DATABASE_URL` and `STORYLAND_TIKTOK_*` in `.env.production`.

Run `pnpm --filter storyland build:minis:release` after completing the server and portal configuration. Privacy Policy and Terms of Service use the SAGATHIYA entity; Portal links are `https://www.yya.ai/capy/privacypolicy.html` and `https://www.yya.ai/capy/termsofservice.html`.

In Developer Portal set Domain of your service to `https://www.yya.ai`; separately add `https://api.evergreenprosper.com` to Trusted Domains for API calls. Create a dedicated PostgreSQL schema named `storyland`, migrate it, and provide the real Client Key/Secret before building a release ZIP.

Entry ad behavior: StoryLand uses the shared `EntryAdGate` and loads the entry
policy for the exact Mini release ID. The admin can configure either
`REWARDED_GATED` or `INTERSTITIAL`, the required count mode and count, placement,
and policy status. No `ad_entry=1` query parameter is required. The configured
policy still applies only when the server considers the visitor eligible; server
attribution and exemption rules, as well as TikTok ad availability, can make a
session ineligible or prevent an ad from showing. After uploading a new release,
open it once so the API can register that release, then enable/configure that
release in the admin. Policy settings are release-specific.

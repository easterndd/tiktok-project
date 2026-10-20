# StoryLand

This TikTok Mini app reuses `apps/mini-web/src`. Copy `.env.example` to `.env` and fill its public Client Key. The numeric App ID is already set in `minis.config.json`; verify it against the StoryLand Developer Portal account. The server uses `STORYLAND_DATABASE_URL` and `STORYLAND_TIKTOK_*` in `.env.production`.

Run `pnpm --filter storyland build:minis:release` after completing the server and portal configuration. Privacy Policy and Terms of Service use the SAGATHIYA entity; Portal links are `https://www.yya.ai/capy/privacypolicy.html` and `https://www.yya.ai/capy/termsofservice.html`.

In Developer Portal set Domain of your service to `https://www.yya.ai`; separately add `https://api.evergreenprosper.com` to Trusted Domains for API calls. Create a dedicated PostgreSQL schema named `storyland`, migrate it, and provide the real Client Key/Secret before building a release ZIP.

Entry ad behavior: StoryLand does not block app content on startup. The paid
campaign landing path must be `/?ad_entry=1` for the optional interstitial to
be considered. It runs at most once per launch after the home catalog loads
and remains visible for 30 seconds. Unmarked previews, direct visits, legal pages, and episode deep links do
not request an entry ad. The admin entry policy must be enabled with
`INTERSTITIAL`, one required impression, and this app's placement ID; `REWARDED_GATED` is not used for
the StoryLand entry. Verify that the TikTok campaign destination preserves the
query string before expecting any paid-entry impressions. The `ad_entry=1`
parameter is a campaign configuration switch, not proof of a TikTok ad click;
do not use it for billing, attribution, or access control.

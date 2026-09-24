# TaleTV Mini App (internal key: xu03)

This project reuses the shared implementation in `apps/mini-web/src` while building a separate TikTok Mini app.

Before building a release, set these values in `apps/xu03/.env` and `apps/xu03/minis.config.json`:

- `VITE_API_BASE_URL`: the shared API URL with the `/api/xu03/v1` path.
- `VITE_TIKTOK_CLIENT_KEY`: the TaleTV TikTok Client Key.
- ad placement IDs created for TaleTV.
- `minis.config.json.appId`: the numeric App ID issued by TikTok for TaleTV.

Commands:

```powershell
pnpm --filter xu03 dev
pnpm --filter xu03 build
pnpm --filter xu03 build:minis:release
pnpm --filter xu03 export:legal
```

The API uses the same server process as the original app. Set `XU03_DATABASE_URL` to a separate PostgreSQL schema or database and set `XU03_TIKTOK_CLIENT_KEY` and `XU03_TIKTOK_CLIENT_SECRET` on the server. BytePlus credentials can remain shared when both TikTok apps are bound to the same BytePlus account and VOD space.

Before TikTok review, verify the privacy policy and terms in `apps/mini-web/src/pages/legal-docs.ts` against the actual operator, contact details, hosting, and governing law for TaleTV. The displayed product name is changed to TaleTV by this build; the legal facts are not changed automatically.

The TikTok Developer Portal Description and legal URLs are documented in `docs/xu03-portal-and-legal-deployment.md`. The Description is entered in the Portal separately; changing `minis.config.json` does not submit the Basic information form.

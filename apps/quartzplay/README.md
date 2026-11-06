# QuartzPlay

QuartzPlay shares the current Mini client with QuicK ReeLS and uses its own App ID, public Client Key, API route, and isolated PostgreSQL schema. Both Minis use the evergreenprosper privacy and terms pages at `/privacy` and `/terms`.

The local `.env` is ignored by Git. Keep the TikTok Client Secret, database credentials, and admin passwords in the server's protected environment only. Before publishing, configure the QuartzPlay backend schema, TikTok credentials, and admin workspace, then verify the API route and test a release in the TikTok client.

Build a release from this folder with `pnpm build:minis:release`. The output ZIP and release metadata are under `dist/`.

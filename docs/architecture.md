# BreezeReels architecture

```text
TikTok App WebView
  └── apps/mini-web (ZIP code asset)
        ├── TTMinis: init, login, IAA, VePlayer
        └── HTTPS -> apps/api (/api/v1)
                         ├── PostgreSQL via Prisma
                         ├── asynchronous UploadJob worker
                         └── TikTok Short Drama / BytePlus adapter

apps/admin-web (separate deployment)
  └── protected admin routes -> apps/api (/api/v1/admin)
```

## Trust boundaries

- `apps/mini-web` can contain only public client identifiers. It never receives TikTok Client Secret, BytePlus AK/SK, raw HLS/MP4 URLs, or provider upload details.
- `apps/api` owns OAuth exchange, business authorization, progress, unlock records, content publication state, and provider calls.
- `apps/admin-web` is not part of the TikTok code ZIP and will use a distinct administrator token.
- PostgreSQL stores metadata and state, not media files. BytePlus stores the media.

## Status boundaries

The public API only queries `Album.status = ONLINE` and `Episode.status = ONLINE`. The player route also requires platform `albumId`, `episodeId`, and `vid`; it never falls back to a raw media URL.

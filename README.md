# BreezeReels

BreezeReels is a TikTok Mini Drama monorepo. It starts the project at M0/M1 from the implementation document: a TikTok Mini H5, a Fastify API, PostgreSQL schema, worker boundary, separate operations console, and production deployment templates.

## Workspace

| Path | Responsibility |
| --- | --- |
| `apps/mini-web` | TikTok-uploaded H5 asset: React UI, TTMinis entrypoints, safe API calls |
| `apps/api` | Fastify API, Prisma schema, user authorization, service adapters, worker |
| `apps/admin-web` | Separate internal operations surface, never placed in the Mini ZIP |
| `packages/shared-types` | DTOs used across browser and API code |
| `infra` | Nginx and production Compose templates |
| `docs` | Architecture and local runbook |

## Start locally

```powershell
pnpm install
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/mini-web/.env.example apps/mini-web/.env
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate -- --name init
pnpm db:seed
pnpm dev:api
pnpm dev:mini
```

The Mini app is available at `http://localhost:5173`; the API health endpoint is `http://localhost:3000/health`. TikTok-only functions intentionally display a browser-safe fallback until the app runs inside TikTok Preview.

## Important implementation boundary

The project deliberately does not make speculative TikTok Short Drama or BytePlus management calls. Wire the `TikTokShortDramaService` to the current official API reference after Portal/region credentials are available. No raw media URL, BytePlus secret, or TikTok Client Secret belongs in `apps/mini-web` or the TikTok ZIP.

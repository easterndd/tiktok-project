# QuicK ReeLS
QuicK ReeLS is a TikTok Mini Drama monorepo. It starts the project at M0/M1 from the implementation document: a TikTok Mini H5, a Fastify API, PostgreSQL schema, worker boundary, separate operations console, and production deployment templates.
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
The operations console is available at `http://localhost:5174`. Mini development defaults to `VITE_DEMO_MODE=true`, which uses the same REST-shaped mock contract as the real API so the full home -> detail -> rewarded unlock -> watch -> profile flow can be previewed without PostgreSQL. Set `VITE_DEMO_MODE=false` before connecting a deployed API.
The current API contract is documented in [`docs/api-openapi.yaml`](docs/api-openapi.yaml). The default local ports are Mini `5173`, Admin `5174`, API `3000`, and PostgreSQL `5432`.
For a real API setup, copy `apps/api/.env.example`, configure PostgreSQL, run `pnpm db:migrate` and `pnpm db:seed`, then start `pnpm dev:api`. The first administrator is created only when both `ADMIN_BOOTSTRAP_EMAIL` and a 12-character-or-longer `ADMIN_BOOTSTRAP_PASSWORD` are set.
## Important implementation boundary
The project deliberately does not make speculative TikTok Short Drama or BytePlus management calls. Wire the `TikTokShortDramaService` to the current official API reference after Portal/region credentials are available. No raw media URL, BytePlus secret, or TikTok Client Secret belongs in `apps/mini-web` or the TikTok ZIP.

# Local runbook

1. Copy `apps/api/.env.example` to `apps/api/.env` and `apps/mini-web/.env.example` to `apps/mini-web/.env`.
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Run `pnpm install`, then `pnpm db:generate`, `pnpm db:migrate -- --name init`, and `pnpm db:seed`.
4. Start the API with `pnpm dev:api` and the Mini H5 with `pnpm dev:mini`.
5. Before TikTok Preview, configure HTTPS, Trusted domains, current SDK fields, and real platform credentials.

Docker Desktop is required for step 2. It is not currently installed in this development environment.

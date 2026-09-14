# QuickReels: Tencent Cloud CVM self-hosted PostgreSQL

This deployment mode is for Preview, real-device testing, and early operations. It runs PostgreSQL inside Docker on the existing CVM without exposing port 5432 to the public internet.

## 1. Prerequisites

- The Caddy container and external `quickreels-proxy` network already exist.
- Do not open TCP 5432 in the Tencent Cloud security group or UFW.
- Confirm the server has at least 2 vCPU, 4 GB RAM, and sufficient disk for the database and backups.
- Pull a QuickReels revision that contains `compose.production.self-hosted.yml`.

## 2. Create the production environment file

```bash
cd /opt/quickreels
git pull --ff-only origin main
cp .env.production.self-hosted.example .env.production
chmod 600 .env.production
```

Generate two different values. Keep both values out of chat, Git, screenshots, and shell history.

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Edit the file:

```bash
nano .env.production
```

Use the first value for both `POSTGRES_PASSWORD` and the password segment of `DATABASE_URL`. The second value is `JWT_SECRET`. The `DATABASE_URL` host must remain `postgres`:

```ini
POSTGRES_DB=quickreels
POSTGRES_USER=quickreels
POSTGRES_PASSWORD=<first-generated-value>
DATABASE_URL=postgresql://quickreels:<first-generated-value>@postgres:5432/quickreels?schema=public
JWT_SECRET=<second-generated-value>
```

Fill the real TikTok and BytePlus identifiers. Leave BytePlus access and secret keys commented only when VOD upload/playback is intentionally disabled.

## 3. Validate and start PostgreSQL

All self-hosted production commands use the dedicated Compose file:

```bash
sudo docker compose --env-file .env.production \
  -f compose.production.self-hosted.yml config

sudo docker compose --env-file .env.production \
  -f compose.production.self-hosted.yml build

sudo docker compose --env-file .env.production \
  -f compose.production.self-hosted.yml up -d postgres
```

Confirm the database is healthy and has no published host port:

```bash
sudo docker compose --env-file .env.production \
  -f compose.production.self-hosted.yml ps
```

`postgres` must show `healthy`; it must not show a `0.0.0.0:5432` mapping.

## 4. Migrate and start QuickReels

```bash
sudo docker compose --env-file .env.production \
  -f compose.production.self-hosted.yml \
  run --rm api ./node_modules/.bin/prisma migrate deploy

sudo docker compose --env-file .env.production \
  -f compose.production.self-hosted.yml up -d
```

The Caddy container reaches only `api` and `admin` through `quickreels-proxy`. PostgreSQL is isolated in `quickreels-internal` and is reachable only by the API and worker containers.

## 5. Create the first administrator

Do not run the demo seed in production. Temporarily add both values to `.env.production`:

```ini
ADMIN_BOOTSTRAP_EMAIL=<your-admin-email>
ADMIN_BOOTSTRAP_PASSWORD=<a-unique-password-of-at-least-12-characters>
```

Run the one-time bootstrap command:

```bash
sudo docker compose --env-file .env.production \
  -f compose.production.self-hosted.yml \
  run --rm api node dist/scripts/bootstrap-admin.js
```

After it reports success, remove `ADMIN_BOOTSTRAP_PASSWORD` from `.env.production`. The command is idempotent: an existing administrator is never modified.

## 6. Back up the database

Create a backup directory and make a compressed logical backup before migrations and at least daily:

```bash
sudo install -d -m 700 /opt/quickreels/backups
sudo docker compose --env-file .env.production \
  -f compose.production.self-hosted.yml \
  exec -T postgres pg_dump -U quickreels -d quickreels \
  | gzip > /opt/quickreels/backups/quickreels-$(date +%F-%H%M%S).sql.gz
```

Copy backups to Tencent Cloud COS or another machine. A backup that remains only on the same CVM does not protect against disk loss.

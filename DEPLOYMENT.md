# Deploying FuelFlow

FuelFlow is one Node.js server. It serves the API and the web app, backed by PostgreSQL. There are two ways to run it:

- **A. Docker (recommended):** `docker compose` runs PostgreSQL, the app, and nginx with HTTPS.
- **B. Plain Node.js:** a Linux or Windows server, with a hosted database such as Neon or Supabase.

## Requirements
- **Node.js 20** or newer (B only; the Docker image includes it).
- **PostgreSQL 14+ in UTF-8.** The server refuses to start on a database that isn't UTF-8.
- **A domain name with HTTPS.** Production requires `https://` and secure cookies.

## 1. Configure

```bash
cp backend/.env.production.example backend/.env.production
```

Fill in `APP_URL`, `DATABASE_URL`, `DIRECT_URL`, `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (12 or more characters). **The server will not start in production if:**
- `COOKIE_SECURE` is not `true`
- `APP_URL` is not `https://`
- `PAYMENT_MODE=sandbox`
- the database is not UTF-8

## 2A. Docker

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
```

1. Put `fullchain.pem` and `privkey.pem` in `deploy/certs/` (for example from Let's Encrypt).
2. Set `server_name` in `deploy/nginx.conf`.
3. In `backend/.env.production`, set `DIRECT_URL` to the `fuelflow_owner` user with the password from `.env`.
4. Start the stack:
   ```bash
   docker compose up -d --build
   ```
   Migrations run automatically.
5. Seed the roles and the first admin:
   ```bash
   docker compose exec app npm run db:seed
   ```
6. Create the limited app role (see section 3), then set `DATABASE_URL` to `fuelflow_app` and restart:
   ```bash
   docker compose restart app
   ```

## 2B. Plain Node.js

```bash
cd backend
npm ci
npx prisma generate
```

```bash
cp .env.production .env
```

```bash
npm run db:deploy
```

```bash
npm run db:seed
```

```bash
NODE_ENV=production node src/server.js
```

- **Keep it running** with a process manager: `pm2 start src/server.js --name fuelflow` on Linux, or NSSM as a Windows service.
- **Put nginx in front** (`deploy/nginx.conf`, changing `proxy_pass` to `http://127.0.0.1:4000`), or another HTTPS reverse proxy.
- **Run only one instance.** The payment sweep and daily alerts run inside the process. Running several instances needs a shared scheduler first.

## 3. Least-privilege database role (do this)

The app should not connect as the database owner. Run this once after migrating, and again after each new migration:

```bash
psql "$DIRECT_URL" -v app_password=LONG-RANDOM-PASSWORD -f deploy/db-roles.sql
```

Then point `DATABASE_URL` at `fuelflow_app` and keep `DIRECT_URL` (the owner) for migrations only. The `fuelflow_app` role:
- **Can** read and write business data.
- **Cannot:**
  - delete or edit the audit log, stock ledger or payment log
  - change the schema
  - touch the migration history

This was verified against PostgreSQL 18.

## 4. First sign-in checklist
1. Sign in as `SEED_ADMIN_EMAIL` and **change the password** (Settings → Change Password).
2. Under **Settings → Business & Billing**, set the business name, address, phone, tax number, logo, currency, tax rate, credit terms and invoice footer.
3. Under **Stations & Pumps → Stations**, create your station(s).
4. Under **Inventory**, add fuel products with prices, then tanks (with their current stock as opening stock).
5. Under **Stations & Pumps**, add pumps and nozzles, and enter each nozzle's current meter reading.
6. Under **User Management**, create staff accounts with the right roles and stations. Use **Employees** for HR records.
7. Add **Suppliers** and **Customers**, and grant credit only where agreed.
8. Check **Settings → Payment Providers**. ZAAD, eDAHAB and Mastercard stay unavailable until their live adapters are built and configured (`backend/PAYMENTS.md`). Cash, bank transfer and credit accounts work from day one.

## 5. Backups
- **Hosted databases** (Neon, Supabase) include automatic backups and point-in-time recovery. Confirm the retention period on your plan.
- **Self-hosted:** schedule `deploy/backup.sh` daily and copy the files off the server:
  ```bash
  DIRECT_URL=... ./deploy/backup.sh /var/backups/fuelflow 30
  ```
  - With Docker: `docker compose exec -T db pg_dump -U fuelflow_owner -Fc fuelflow > fuelflow.dump`
- **Test a restore** into an empty database every month (`deploy/restore.sh`), sign in, and check today's sales and tank levels.

## 6. Monitoring and logs
- **Health check:** `GET /api/health` returns 200 when the database is reachable and 503 when it isn't. The Docker image already uses it.
- **Logs:** each request is one line (time, method, path, status, duration, request ID). Errors include the request ID, which users also see in error messages, so you can match a complaint to the log.
- **Watch for** `[integrity]`, `[payments]`, `[alerts]` and `[uncaughtException]` lines.

## 7. Updating

```bash
git pull
docker compose up -d --build
```

Without Docker, the equivalent is `npm ci`, `npm run db:deploy`, then restart. Migrations run before the server starts. **Back up first.**

**After changing CSS classes in the frontend,** rebuild the stylesheets and commit `frontend/css/tailwind-*.css`. Docker builds them automatically.

```bash
cd frontend && npm ci && npm run build:css
```

## Known limitations
- **Live ZAAD, eDAHAB and Mastercard** need provider documents and credentials (`backend/PAYMENTS.md`).
- **Inline click handlers:** the pages still use them, so the security policy allows inline scripts (third-party scripts are blocked).
- **Single instance:** run one app instance (see 2B).
- **Backup scripts:** `deploy/backup.sh` and `restore.sh` follow standard `pg_dump`/`pg_restore` usage but were not run in development, because no `pg_dump` was available. Test them on your server.
- **Docker files:** the Dockerfile and compose file have not been built or run here, because Docker isn't installed on the development machine.

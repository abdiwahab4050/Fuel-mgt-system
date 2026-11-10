# FuelFlow ERP — Backend API

Express 5 + Prisma 6 + PostgreSQL. It also serves the existing `../frontend` app on the same origin, so session cookies work without CORS.

## Setup

1. **Create a PostgreSQL database.** Use a free hosted one, such as [Neon](https://neon.tech) or [Supabase](https://supabase.com). Copy two connection strings:
   - the **pooled** one, for `DATABASE_URL`
   - the **direct** one, for `DIRECT_URL`

2. **Configure the environment:**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env`. Set `DATABASE_URL`, `DIRECT_URL` and `SEED_ADMIN_PASSWORD`.

3. **Install, migrate and seed:**
   ```bash
   npm install
   npm run db:migrate
   npm run db:seed
   ```
   - `db:migrate` creates the tables from `prisma/schema.prisma`.
   - `db:seed` creates the roles, permissions, settings and admin user, plus demo data if enabled.

4. **Run the server:**
   ```bash
   npm run dev
   ```
   Then open <http://localhost:4000>.

5. **Run the tests:**
   ```bash
   npm test
   ```
   There are 111 tests. The integration tests need a migrated and seeded database (`SEED_DEMO_DATA=true`, with `SEED_ADMIN_PASSWORD` set). Without a database they are skipped.

   **The database must use UTF-8.** Neon and Supabase do by default. A self-installed PostgreSQL on Windows may default to WIN1252, which would reject Somali or Arabic text. The server refuses to start on a non-UTF-8 database.

## Demo accounts

These are created when `SEED_DEMO_DATA=true`. Demo data is never created in production.

| Role | Email | Password |
|---|---|---|
| Super Administrator | value of `SEED_ADMIN_EMAIL` | value of `SEED_ADMIN_PASSWORD` |
| Station Manager | manager@fuelflow.com | manager123 |
| Station Manager (was "Fleet Manager") | fleet@fuelflow.com | fleet123 |
| Cashier | cashier@fuelflow.com | cashier123 |
| Fuel Attendant | attendant@fuelflow.com | attendant123 |
| Accountant | accountant@fuelflow.com | accountant123 |
| Customer | customer@fuelflow.com | customer123 |

## Layout

```
backend/
├── prisma/
│   ├── schema.prisma      # all entities, relations and indexes
│   ├── migrations/        # generated SQL migrations (commit these)
│   └── seed.js            # idempotent seed
├── src/
│   ├── server.js          # process entry point
│   ├── app.js             # Express app: security headers, /api, static frontend
│   ├── db.js              # Prisma client
│   ├── config/env.js      # validated environment variables
│   ├── auth/permissions.js# role → permission matrix (single source of truth)
│   ├── lib/               # errors, atomic document numbering
│   └── middleware/        # error handler
└── tests/                 # node:test + supertest
```

## Data-integrity rules

- **Money and liters** are stored as `Decimal`, never as floating-point numbers.
- **Every stock change** writes a `StockMovement` row. It is written in the same database transaction as the tank level update, so the tank level always equals the sum of its ledger.
- **Customer and supplier balances** are calculated from invoices and payments. They are never stored, so they cannot drift.
- **Document numbers** (`SAL-2026-000001`, `INV-…`, `PAY-…`) come from one atomic SQL statement. Two simultaneous requests can never get the same number.
- **Payments** have a unique `reference`, a unique `idempotencyKey` and a unique (`method`, `providerReference`) pair. Webhooks are deduplicated by (`provider`, `eventId`).
- **Card data:** only the card brand and last 4 digits are ever stored.

## Backups

Hosted Postgres providers include automatic backups and point-in-time recovery. Check the retention period on your plan.

For a manual backup:
```bash
pg_dump "$DIRECT_URL" -Fc -f fuelflow-$(date +%F).dump
```

To restore:
```bash
pg_restore -d "$DIRECT_URL" --clean fuelflow-YYYY-MM-DD.dump
```

## Security

| Area | Protection |
|---|---|
| Passwords | bcrypt (cost 12); at least 8 characters with letters and numbers |
| Repeated wrong passwords | Account locks for 15 minutes after 5 failures. This applies to the login screen and to supervisor discount approvals. |
| Request limits | 20 login attempts per 15 minutes per IP; 600 API requests per minute per IP |
| Sessions | Random token in an httpOnly, SameSite=Lax cookie (Secure in production). Only its SHA-256 hash is stored. Sessions are revoked on logout, password change or reset, and when a user is disabled. Users can sign out their other devices. |
| CSRF | State-changing API calls must send `X-Requested-With: fuelflow`, which other websites cannot send |
| Authorization | Every route checks permissions. Station-bound staff are limited to their own station on every query. |
| Input | Zod validation on every body and query; money and liters parsed straight to Decimal |
| SQL injection | Prisma parameterised queries; raw SQL only through tagged templates |
| XSS | All dynamic text is HTML-escaped, including quotes; CSP and other security headers via helmet |
| CSV export | Formula injection (`=`, `+`, `-`, `@`) is neutralised |
| Payments | Server-side verification; signed, deduplicated webhooks; idempotency; no card data stored (see `PAYMENTS.md`) |
| Database backstops | CHECK constraints (tank level within capacity, paid ≤ total, positive amounts). The audit log, stock ledger and payment event log are append-only (enforced by triggers). |
| Audit | Every financial, stock and access change is logged with user, time and IP. Report exports and receipt reprints are logged too. |
| Production guards | Startup is refused if `COOKIE_SECURE` is not true, `APP_URL` is not HTTPS, the payment sandbox is enabled, or the database is not UTF-8 |
| Operations | Every response carries an `X-Request-Id`. The access log records method, path, status and duration, never bodies or tokens. Expired sessions are cleaned up daily. |

**In production, the database user the app runs as should not have DELETE permission on `AuditLog`, `StockMovement` or `PaymentTransaction`.** The triggers already block edits.

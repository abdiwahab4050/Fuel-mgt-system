# FuelFlow ERP: Fuel Station Management System

A management system for fuel stations covering:
- pumps and shifts
- tanks and stock
- sales (point of sale)
- customers and credit accounts
- invoices and receipts
- ZAAD, eDAHAB and Mastercard payments (sandbox until live credentials are available)
- suppliers and purchasing
- expenses
- finance
- fleet
- reports, with Excel, CSV and PDF export

## Layout

```
backend/     Node.js API (Express + Prisma + PostgreSQL); also serves the web app
frontend/    Web app (HTML + JavaScript + prebuilt Tailwind CSS)
deploy/      nginx config, database role script, backup and restore scripts
Dockerfile, docker-compose.yml
```

## Run it locally

```bash
cd backend
npm install
```

```bash
cp .env.example .env
```

Edit `.env`: set `DATABASE_URL` and `DIRECT_URL` to a UTF-8 PostgreSQL database, and set `SEED_ADMIN_PASSWORD`. Then:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

Open <http://localhost:4000>. With `SEED_DEMO_DATA=true`, the login screen offers demo accounts for every role.

## Documentation
- `backend/README.md`: API setup, tests (111), data rules and the security model
- `backend/PAYMENTS.md`: how payments work and how to activate live providers
- `DEPLOYMENT.md`: production deployment, first-run checklist, backups and monitoring
- `design-reference/DESIGN.md`: the visual design system

## Roles

| Role | What they do |
|---|---|
| Super Administrator | Everything: users, settings, payment configuration, all stations |
| Station Manager | Runs a station: stock, pumps, shifts, staff, approvals, reports |
| Cashier | Sales, invoices, taking payments, receipts |
| Fuel Attendant | Pump meter readings and their assigned pumps |
| Accountant | Expenses, supplier payments, receivables, finance reports |
| Customer | Their own invoices, payments, balance and receipts |

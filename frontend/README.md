# FuelFlow ERP — Frontend MVP

A modern, responsive Fuel Management System built with **HTML, CSS, and JavaScript**, following the **Industrial Precision** design system from the Stitch design reference.

## Quick Start

The backend API now serves this frontend, and it handles login, users and the dashboard. Opening `index.html` directly from disk no longer works.

```bash
cd backend
npm run dev
```

Then visit `http://localhost:4000`. See `backend/README.md` for database setup and the demo accounts. There are 6 roles: Super Administrator, Station Manager, Cashier, Fuel Attendant, Accountant and Customer.

### Migration status

| Module | Data source |
|--------|-------------|
| Login, sessions, profile, password | API |
| Users and roles | API |
| Dashboard, notifications | API |
| Inventory: tanks, products, ledger, adjustments, transfers, dips | API |
| Stations, pumps, nozzles, shifts, meter readings, reconciliation | API |
| Sales (POS), customers, invoices, payments (cash and bank), refunds, statements | API |
| ZAAD, eDAHAB, Mastercard payments | API. **Sandbox only**: live adapters need provider docs and credentials (see `backend/PAYMENTS.md`) |
| Company, branding, currency, tax and billing settings | API |
| Suppliers, purchase orders, deliveries, supplier invoices and payments | API |
| Expenses (with approval), employees, finance (profit and loss, cash flow, aging) | API |
| Fleet vehicles, fuel consumption and efficiency | API |
| Reports (14) with Excel, CSV and print/PDF export; daily alerts | API |

No module uses browser `localStorage` for business data any more. `store.js` remains only for the public landing page demo data and as a currency/brand fallback if settings fail to load.

## Modules

- **Dashboard** — KPIs, fuel stock gauges, sales trends, recent activities, charts
- **Inventory** — Fuel types, stock levels, adjustments, transfers, low-stock alerts
- **Suppliers** — CRUD, contact info, purchase history counts
- **Purchases** — Create/update purchases, auto stock updates, CSV export
- **Sales** — Record sales, daily reports, stock deduction, CSV export
- **Fleet** — Vehicle registration, status, fuel history
- **Consumption** — Track fuel issued to vehicles, efficiency monitoring
- **Reports** — Financial, stock, purchase, sales, vehicle, consumption, audit logs
- **User Management** — Admin-only: create users, roles, reset passwords
- **Settings** — Company config, currency, alerts, seed data reset

## Features

- Role-based access control (Admin, Fuel Attendant, Fleet Manager)
- Dark / light mode toggle
- Notifications (low stock, purchases, high consumption)
- Audit logging
- LocalStorage persistence with seed data
- Responsive layout (sidebar collapses on mobile)
- CSV export on key modules

## Design System

Based on `design-reference/DESIGN.md`:

- **Colors**: Deep Petrol sidebar, Action Green accents, Amber warnings
- **Typography**: Geist (headlines/data), Inter (body)
- **Layout**: 280px sidebar, 1600px max content width, bento grid dashboard
- **Components**: Metric cards, sticky data tables, subtle pill badges, tonal elevation

## Project Structure

```
frontend/
├── index.html          # Login page
├── app.html            # Main SPA shell
├── css/styles.css      # Custom styles & components
├── css/tailwind-*.css  # Prebuilt Tailwind (npm run build:css; configs in build/)
├── js/
│   ├── store.js        # Data layer + seed data
│   ├── auth.js         # Session management
│   ├── utils.js        # Helpers, modals, toasts, tables
│   ├── router.js       # Hash-based routing
│   ├── app.js          # App initialization
│   └── pages/          # Module page renderers
└── README.md
```

## Next Steps (Backend)

This frontend is ready to connect to a Next.js + Prisma + PostgreSQL backend. Replace `Store` calls with API fetch calls when the backend is built.

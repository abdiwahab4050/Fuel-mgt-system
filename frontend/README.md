# FuelFlow ERP — Frontend MVP

A modern, responsive Fuel Management System built with **HTML, CSS, and JavaScript**, following the **Industrial Precision** design system from the Stitch design reference.

## Quick Start

1. Open `index.html` in a browser (or serve the `frontend` folder with any static server).
2. Sign in with a demo account (see below).
3. Explore all modules from the sidebar navigation.

### Using a Local Server (recommended)

```bash
cd frontend
npx serve .
# or: python -m http.server 8080
```

Then visit `http://localhost:3000` (or `:8080`).

## Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Administrator | admin@fuelflow.com | admin123 |
| Fuel Attendant | attendant@fuelflow.com | attendant123 |
| Fleet Manager | fleet@fuelflow.com | fleet123 |

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

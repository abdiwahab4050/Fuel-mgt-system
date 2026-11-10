/**
 * Permission catalogue and role → permission matrix.
 * Single source of truth: the seed writes these to the database, and the
 * frontend receives the logged-in user's resolved permission keys.
 */

// SECTION: every permission in the system, grouped by module
export const PERMISSIONS = {
  dashboard: ['dashboard.view'],
  stations: ['stations.view', 'stations.manage'],
  inventory: ['inventory.view', 'inventory.manage', 'inventory.adjust.request', 'inventory.adjust.approve'],
  pumps: ['pumps.view', 'pumps.manage', 'pumps.readings.record', 'pumps.reconcile'],
  shifts: ['shifts.view', 'shifts.view_own', 'shifts.manage'],
  sales: ['sales.view', 'sales.view_own', 'sales.create', 'sales.discount.apply', 'sales.discount.approve', 'sales.cancel'],
  refunds: ['refunds.request', 'refunds.approve'],
  customers: ['customers.view', 'customers.manage', 'customers.credit.manage'],
  invoices: ['invoices.view', 'invoices.view_own', 'invoices.create'],
  payments: ['payments.view', 'payments.view_own', 'payments.receive', 'payments.configure'],
  suppliers: ['suppliers.view', 'suppliers.manage', 'supplier_payments.manage'],
  purchases: ['purchases.view', 'purchases.manage', 'deliveries.confirm'],
  expenses: ['expenses.view', 'expenses.manage', 'expenses.approve'],
  finance: ['finance.view'],
  fleet: ['fleet.view', 'fleet.manage', 'consumption.record'],
  reports: ['reports.view', 'reports.financial', 'reports.export'],
  users: ['users.view', 'users.manage', 'employees.manage'],
  system: ['settings.manage', 'audit.view', 'notifications.view'],
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS).flat();

// SECTION: role definitions; super_admin always receives every permission
export const ROLES = {
  super_admin: {
    name: 'Super Administrator',
    description: 'Full system access, users, configuration, payments and all stations',
    permissions: ALL_PERMISSIONS,
  },
  station_manager: {
    name: 'Station Manager',
    description: 'Runs station operations, inventory, staff and approvals',
    permissions: [
      'dashboard.view', 'stations.view',
      'inventory.view', 'inventory.manage', 'inventory.adjust.request', 'inventory.adjust.approve',
      'pumps.view', 'pumps.manage', 'pumps.readings.record', 'pumps.reconcile',
      'shifts.view', 'shifts.manage',
      'sales.view', 'sales.create', 'sales.discount.apply', 'sales.discount.approve', 'sales.cancel',
      'refunds.request', 'refunds.approve',
      'customers.view', 'customers.manage', 'customers.credit.manage',
      'invoices.view', 'invoices.create', 'payments.view', 'payments.receive',
      'suppliers.view', 'purchases.view', 'purchases.manage', 'deliveries.confirm',
      'expenses.view', 'expenses.manage',
      'fleet.view', 'fleet.manage', 'consumption.record',
      'reports.view', 'reports.export',
      'users.view', 'employees.manage',
      'audit.view', 'notifications.view',
    ],
  },
  cashier: {
    name: 'Cashier',
    description: 'Processes sales, invoices and customer payments',
    permissions: [
      'dashboard.view',
      'sales.view_own', 'sales.create', 'sales.discount.apply', 'refunds.request',
      'customers.view', 'customers.manage',
      'invoices.view', 'invoices.create', 'payments.view', 'payments.receive',
      'shifts.view_own', 'notifications.view',
    ],
  },
  attendant: {
    name: 'Fuel Attendant',
    description: 'Dispenses fuel and records pump meter readings',
    permissions: [
      'dashboard.view', 'inventory.view',
      'pumps.view', 'pumps.readings.record', 'shifts.view_own',
      'sales.view_own', 'sales.create',
      'notifications.view',
    ],
  },
  accountant: {
    name: 'Accountant',
    description: 'Manages expenses, payments, receivables, payables and financial reports',
    permissions: [
      'dashboard.view',
      'sales.view', 'invoices.view', 'payments.view', 'refunds.approve',
      'customers.view', 'customers.credit.manage',
      'suppliers.view', 'supplier_payments.manage', 'purchases.view',
      'expenses.view', 'expenses.manage', 'expenses.approve',
      'finance.view', 'reports.view', 'reports.financial', 'reports.export',
      'audit.view', 'notifications.view',
    ],
  },
  customer: {
    name: 'Customer',
    description: 'Views own transactions, invoices, payments and balance',
    permissions: ['sales.view_own', 'invoices.view_own', 'payments.view_own', 'notifications.view'],
  },
};

// SECTION: guard against typos in the role matrix at import time
for (const [roleKey, role] of Object.entries(ROLES)) {
  for (const p of role.permissions) {
    if (!ALL_PERMISSIONS.includes(p)) {
      throw new Error(`Role "${roleKey}" references unknown permission "${p}"`);
    }
  }
}

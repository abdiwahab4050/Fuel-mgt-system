import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, ALL_PERMISSIONS } from '../src/auth/permissions.js';

const can = (role, perm) => ROLES[role].permissions.includes(perm);

test('defines the six required roles', () => {
  assert.deepEqual(Object.keys(ROLES).sort(), ['accountant', 'attendant', 'cashier', 'customer', 'station_manager', 'super_admin']);
});

test('super admin has every permission', () => {
  assert.equal(ROLES.super_admin.permissions.length, ALL_PERMISSIONS.length);
});

test('no duplicate permissions in any role', () => {
  for (const [key, role] of Object.entries(ROLES)) {
    assert.equal(new Set(role.permissions).size, role.permissions.length, key);
  }
});

test('only super admin can configure payments, manage users or settings', () => {
  for (const role of Object.keys(ROLES).filter((r) => r !== 'super_admin')) {
    assert.equal(can(role, 'payments.configure'), false, role);
    assert.equal(can(role, 'users.manage'), false, role);
    assert.equal(can(role, 'settings.manage'), false, role);
  }
});

test('role responsibilities match the spec', () => {
  assert.ok(can('station_manager', 'inventory.adjust.approve'));
  assert.ok(can('station_manager', 'employees.manage'));
  assert.ok(can('cashier', 'sales.create') && can('cashier', 'payments.receive') && can('cashier', 'invoices.create'));
  assert.ok(!can('cashier', 'sales.view'), 'cashier sees only own transactions');
  assert.ok(can('attendant', 'pumps.readings.record') && can('attendant', 'shifts.view_own'));
  assert.ok(!can('attendant', 'payments.receive'));
  assert.ok(can('accountant', 'expenses.manage') && can('accountant', 'reports.financial'));
  assert.ok(!can('accountant', 'sales.create'));
});

test('customer can only see their own records', () => {
  for (const p of ROLES.customer.permissions) {
    assert.ok(p.endsWith('_own') || p === 'notifications.view', p);
  }
});

test('approval permissions are never held by roles that only request', () => {
  assert.ok(!can('cashier', 'refunds.approve'));
  assert.ok(!can('cashier', 'sales.discount.approve'));
  assert.ok(!can('attendant', 'inventory.adjust.approve'));
});

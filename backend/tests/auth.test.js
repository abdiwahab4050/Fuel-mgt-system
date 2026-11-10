/**
 * Authentication, role permissions, user management and dashboard — against a
 * migrated + seeded database (SEED_DEMO_DATA=true). Skipped when no DB.
 */
import { ADMIN, CSRF, DEMO, loginAgent, needsDb, prisma } from './helpers.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { MAX_FAILED_LOGINS } from '../src/routes/auth.js';

const app = createApp();
const TEST_EMAIL_DOMAIN = '@test.fuelflow.local';

after(async () => {
  // test users are disabled-not-deleted by the API, so remove them (and their rows) directly
  const users = await prisma.user.findMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } }, select: { id: true } }).catch(() => []);
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { entityId: { in: ids } }] } });
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

async function makeUser(roleKey, password = 'testpass123') {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const email = `${roleKey}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${TEST_EMAIL_DOMAIN}`;
  const user = await prisma.user.create({ data: { email, name: `Test ${roleKey}`, roleId: role.id, passwordHash: await hashPassword(password) } });
  return { user, creds: { email, password } };
}

test('login: wrong password is rejected with a generic message', needsDb, async () => {
  const res = await request(app).post('/api/auth/login').set(CSRF).send({ email: DEMO.cashier.email, password: 'nope-wrong1' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.message, 'Invalid email or password');
  const unknown = await request(app).post('/api/auth/login').set(CSRF).send({ email: 'ghost@nowhere.io', password: 'nope-wrong1' });
  assert.equal(unknown.body.error.message, 'Invalid email or password', 'same message for unknown email');
});

test('login: success sets an httpOnly cookie and returns permissions; session stored hashed', needsDb, async () => {
  const res = await request(app).post('/api/auth/login').set(CSRF).send(DEMO.cashier);
  assert.equal(res.status, 200);
  const cookie = res.headers['set-cookie'].find((c) => c.startsWith('ff_session='));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.equal(res.body.user.role, 'cashier');
  assert.ok(res.body.user.permissions.includes('sales.create'));
  assert.ok(!('passwordHash' in res.body.user));
  const token = decodeURIComponent(cookie.split(';')[0].split('=')[1]);
  assert.equal(await prisma.session.count({ where: { tokenHash: token } }), 0, 'raw token is not stored');
});

test('login: email is case-insensitive', needsDb, async () => {
  const res = await request(app).post('/api/auth/login').set(CSRF).send({ email: DEMO.cashier.email.toUpperCase(), password: DEMO.cashier.password });
  assert.equal(res.status, 200);
});

test(`login: account locks after ${MAX_FAILED_LOGINS} failed attempts`, needsDb, async () => {
  const { creds } = await makeUser('cashier');
  for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
    await request(app).post('/api/auth/login').set(CSRF).send({ ...creds, password: 'wrong-pass1' });
  }
  const locked = await request(app).post('/api/auth/login').set(CSRF).send(creds);
  assert.equal(locked.status, 423, 'correct password refused while locked');
});

test('disabled users cannot log in', needsDb, async () => {
  const { user, creds } = await makeUser('cashier');
  await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
  assert.equal((await request(app).post('/api/auth/login').set(CSRF).send(creds)).status, 401);
});

test('logout revokes the session server-side', needsDb, async () => {
  const agent = await loginAgent(request, app, DEMO.attendant);
  assert.equal((await agent.get('/api/auth/me')).status, 200);
  assert.equal((await agent.post('/api/auth/logout').set(CSRF)).status, 200);
  assert.equal((await agent.get('/api/auth/me')).status, 401);
});

test('role permissions are enforced by the API', needsDb, async () => {
  const cashier = await loginAgent(request, app, DEMO.cashier);
  assert.equal((await cashier.get('/api/users')).status, 403);
  assert.equal((await cashier.post('/api/users').set(CSRF).send({})).status, 403);

  const customer = await loginAgent(request, app, DEMO.customer);
  assert.equal((await customer.get('/api/dashboard/summary')).status, 403);

  const manager = await loginAgent(request, app, DEMO.manager);
  assert.equal((await manager.get('/api/users')).status, 200, 'manager can view staff');
  assert.equal((await manager.post('/api/users').set(CSRF).send({})).status, 403, 'but not create accounts');
});

test('station managers only see their own station', needsDb, async () => {
  const manager = await loginAgent(request, app, DEMO.manager);
  const me = (await manager.get('/api/auth/me')).body.user;
  const { users } = (await manager.get('/api/users').query({ stationId: 'other' })).body;
  assert.ok(users.length > 0);
  assert.ok(users.every((u) => u.stationId === me.stationId));
});

test('admin user management: create, validate, reset password, disable', needsDb, async () => {
  assert.ok(ADMIN.password, 'SEED_ADMIN_PASSWORD must be set for this test');
  const admin = await loginAgent(request, app, ADMIN);
  const email = `new-${Date.now()}${TEST_EMAIL_DOMAIN}`;

  const weak = await admin.post('/api/users').set(CSRF).send({ name: 'Weak', email, password: 'short', roleKey: 'cashier' });
  assert.equal(weak.status, 400);

  const created = await admin.post('/api/users').set(CSRF).send({ name: 'New Cashier', email, password: 'cashier2026', roleKey: 'cashier' });
  assert.equal(created.status, 201);
  const id = created.body.user.id;
  assert.equal((await admin.post('/api/users').set(CSRF).send({ name: 'Dup', email, password: 'cashier2026', roleKey: 'cashier' })).status, 409);

  const userAgent = await loginAgent(request, app, { email, password: 'cashier2026' });
  assert.equal((await admin.post(`/api/users/${id}/reset-password`).set(CSRF).send({ password: 'newpass2026' })).status, 200);
  assert.equal((await userAgent.get('/api/auth/me')).status, 401, 'reset signs the user out');
  await loginAgent(request, app, { email, password: 'newpass2026' });

  assert.equal((await admin.delete(`/api/users/${id}`).set(CSRF)).status, 200);
  const row = await prisma.user.findUnique({ where: { id } });
  assert.equal(row.status, 'DISABLED', 'disabled, not deleted');
  assert.ok(await prisma.auditLog.count({ where: { entityId: id, action: 'user.disable' } }));
});

test('admins cannot change their own role or status', needsDb, async () => {
  const admin = await loginAgent(request, app, ADMIN);
  const me = (await admin.get('/api/auth/me')).body.user;
  assert.equal((await admin.patch(`/api/users/${me.userId}`).set(CSRF).send({ roleKey: 'cashier' })).status, 400);
  assert.equal((await admin.patch(`/api/users/${me.userId}`).set(CSRF).send({ status: 'DISABLED' })).status, 400);
  assert.equal((await admin.delete(`/api/users/${me.userId}`).set(CSRF)).status, 400);
});

test('suspending a user ends their active session immediately', needsDb, async () => {
  const { user, creds } = await makeUser('cashier');
  const agent = await loginAgent(request, app, creds);
  const admin = await loginAgent(request, app, ADMIN);
  assert.equal((await admin.patch(`/api/users/${user.id}`).set(CSRF).send({ status: 'SUSPENDED' })).status, 200);
  assert.equal((await agent.get('/api/auth/me')).status, 401);
});

test('only super admins can grant the super admin role', needsDb, async () => {
  const { creds } = await makeUser('station_manager');
  await prisma.role.findUniqueOrThrow({ where: { key: 'station_manager' } });
  // station managers lack users.manage entirely; verify the API refuses either way
  const mgr = await loginAgent(request, app, creds);
  const res = await mgr.post('/api/users').set(CSRF).send({ name: 'X', email: `x${Date.now()}${TEST_EMAIL_DOMAIN}`, password: 'abcd12345', roleKey: 'super_admin' });
  assert.equal(res.status, 403);
});

test('change password requires the current password', needsDb, async () => {
  const { creds } = await makeUser('accountant');
  const agent = await loginAgent(request, app, creds);
  assert.equal((await agent.post('/api/auth/change-password').set(CSRF).send({ currentPassword: 'wrong', newPassword: 'another2026' })).status, 400);
  assert.equal((await agent.post('/api/auth/change-password').set(CSRF).send({ currentPassword: creds.password, newPassword: 'another2026' })).status, 200);
  await loginAgent(request, app, { email: creds.email, password: 'another2026' });
});

test('avatar upload validates type and size', needsDb, async () => {
  const { creds } = await makeUser('cashier');
  const agent = await loginAgent(request, app, creds);
  assert.equal((await agent.put('/api/auth/me/avatar').set(CSRF).send({ dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' })).status, 400);
  const overLimit = 'data:image/png;base64,' + 'A'.repeat(700 * 1024); // ~525 KB decoded
  assert.equal((await agent.put('/api/auth/me/avatar').set(CSRF).send({ dataUrl: overLimit })).status, 400);
  const huge = 'data:image/png;base64,' + 'A'.repeat(1100 * 1024);
  assert.equal((await agent.put('/api/auth/me/avatar').set(CSRF).send({ dataUrl: huge })).status, 413, 'body limit');
  const ok = await agent.put('/api/auth/me/avatar').set(CSRF).send({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.equal(ok.status, 200);
  assert.equal((await agent.get('/api/auth/me')).body.user.avatarUrl, 'data:image/png;base64,iVBORw0KGgo=');
});

test('dashboard: admin sees finance; cashier sees only own sales without finance', needsDb, async () => {
  const admin = await loginAgent(request, app, ADMIN);
  const a = await admin.get('/api/dashboard/summary').query({ from: '2026-01-01', to: '2026-01-31' });
  assert.equal(a.status, 200);
  assert.equal(a.body.series.length, 31);
  assert.ok(a.body.finance && a.body.receivables && a.body.activity);
  assert.ok(Array.isArray(a.body.stock) && a.body.stock.length > 0);
  for (const t of a.body.stock) assert.equal(t.low, t.liters <= t.minLevel);

  const cashier = await loginAgent(request, app, DEMO.cashier);
  const c = await cashier.get('/api/dashboard/summary');
  assert.equal(c.status, 200);
  assert.equal(c.body.scope.ownSalesOnly, true);
  assert.equal(c.body.finance, undefined);
  assert.equal(c.body.activity, undefined);

  assert.equal((await admin.get('/api/dashboard/summary').query({ from: 'bad' })).status, 400);
});

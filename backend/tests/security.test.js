/**
 * Phase 9 hardening: database backstops, approval lockout, session management,
 * production guards, request ids / rate-limit headers, and HTML escaping.
 */
import { ADMIN, CSRF, DEMO, loginAgent, needsDb, prisma } from './helpers.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';

const app = createApp();
const here = path.dirname(fileURLToPath(import.meta.url));
const RUN = Date.now().toString(36).toLowerCase();

after(async () => {
  const users = (await prisma.user.findMany({ where: { email: { contains: `sec-${RUN}` } }, select: { id: true } }).catch(() => [])).map((u) => u.id);
  if (users.length) {
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { entityId: { in: users } }] } });
    await prisma.session.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  await prisma.$disconnect();
});

// ─── No database needed ──────────────────────────────────────

test('frontend escapeHtml escapes quotes so attribute values cannot be broken out of', () => {
  const src = fs.readFileSync(path.join(here, '../../frontend/js/utils.js'), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(`${src}\n;globalThis.__Utils = Utils;`, ctx);
  const esc = ctx.__Utils.escapeHtml;
  assert.equal(esc('" onmouseover="alert(1)'), '&quot; onmouseover=&quot;alert(1)');
  assert.equal(esc("<img src=x onerror='a'>"), '&lt;img src=x onerror=&#39;a&#39;&gt;');
  assert.equal(esc('A & B'), 'A &amp; B');
  assert.equal(esc(null), '');
  assert.equal(esc(42), '42');
});

test('production refuses insecure cookies, plain-HTTP URLs and the payment sandbox', () => {
  const run = (extra) => spawnSync(process.execPath, ['-e', "import('./src/config/env.js').then(()=>console.log('STARTED')).catch(e=>{console.error(e.message);process.exit(1)})"], {
    cwd: path.join(here, '..'),
    env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgresql://x:y@127.0.0.1:1/z', PAYMENT_MODE: 'live', COOKIE_SECURE: 'true', APP_URL: 'https://fuel.example.com', ...extra },
    encoding: 'utf8',
  });
  assert.match(run({}).stdout, /STARTED/, 'secure production config starts');
  assert.match(run({ COOKIE_SECURE: 'false' }).stderr, /COOKIE_SECURE=true is required/);
  assert.match(run({ APP_URL: 'http://fuel.example.com' }).stderr, /must use https/);
  assert.match(run({ PAYMENT_MODE: 'sandbox' }).stderr, /sandbox is not allowed/);
});

test('every response carries a request id; the API sends rate-limit headers', async () => {
  const res = await request(app).get('/api/auth/config');
  assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  assert.ok(res.headers.ratelimit || res.headers['ratelimit-policy'], 'standard RateLimit headers');
});

// ─── Database backstops ──────────────────────────────────────

test('database CHECK constraints reject impossible values even if the app had a bug', needsDb, async () => {
  const tank = await prisma.tank.findFirstOrThrow();
  await assert.rejects(prisma.tank.update({ where: { id: tank.id }, data: { currentLiters: D(-1) } }), /Tank_level_within_capacity/);
  await assert.rejects(prisma.tank.update({ where: { id: tank.id }, data: { currentLiters: tank.capacityLiters.plus(1) } }), /Tank_level_within_capacity/);
  const inv = await prisma.invoice.findFirst();
  if (inv) await assert.rejects(prisma.invoice.update({ where: { id: inv.id }, data: { amountPaid: inv.total.plus(1) } }), /Invoice_amounts_valid/);
});

test('audit log and stock ledger rows cannot be edited', needsDb, async () => {
  const log = await prisma.auditLog.findFirstOrThrow();
  await assert.rejects(prisma.auditLog.update({ where: { id: log.id }, data: { details: 'tampered' } }), /append-only/);
  const mv = await prisma.stockMovement.findFirstOrThrow();
  await assert.rejects(prisma.stockMovement.update({ where: { id: mv.id }, data: { note: 'tampered' } }), /append-only/);
});

// ─── Supervisor approval lockout ─────────────────────────────

test('wrong supervisor passwords are recorded and lock the supervisor out', needsDb, async () => {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'station_manager' } });
  const station = await prisma.station.findFirstOrThrow({ where: { code: 'STN-001' } });
  const sup = await prisma.user.create({ data: { email: `sec-${RUN}-sup@test.fuelflow.local`, name: 'Sec Supervisor', roleId: role.id, stationId: station.id, passwordHash: await hashPassword('rightpass123') } });
  const cashier = await loginAgent(request, app, DEMO.cashier);
  const nozzle = await prisma.nozzle.findFirstOrThrow({ where: { pump: { stationId: station.id }, status: 'ACTIVE' } });
  const attempt = (password) => cashier.post('/api/sales').set(CSRF).send({
    idempotencyKey: `sec-${RUN}-${Math.random().toString(36).slice(2)}`, paymentMethod: 'CASH',
    items: [{ nozzleId: nozzle.id, quantity: '10', discount: '1.00' }],
    discountApproval: { email: sup.email, password },
  });
  for (let i = 0; i < 5; i++) assert.equal((await attempt('wrong-guess1')).status, 403);
  const locked = await prisma.user.findUnique({ where: { id: sup.id } });
  assert.ok(locked.lockedUntil > new Date(), 'locked after 5 wrong passwords');
  const res = await attempt('rightpass123');
  assert.equal(res.status, 403);
  assert.match(res.body.error.message, /temporarily locked/);
  assert.equal(await prisma.auditLog.count({ where: { action: 'sale.discount_approval_failed', entityId: sup.id } }), 5, 'failed attempts persist despite the sale rolling back');
});

// ─── Sessions ────────────────────────────────────────────────

test('users can see their sessions and sign out other devices', needsDb, async () => {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'cashier' } });
  const creds = { email: `sec-${RUN}-multi@test.fuelflow.local`, password: 'multipass123' };
  await prisma.user.create({ data: { email: creds.email, name: 'Sec Multi', roleId: role.id, passwordHash: await hashPassword(creds.password) } });
  const phone = await loginAgent(request, app, creds);
  const laptop = await loginAgent(request, app, creds);
  const list = (await laptop.get('/api/auth/sessions')).body.sessions;
  assert.equal(list.length, 2);
  assert.equal(list.filter((s) => s.current).length, 1);
  assert.ok(!('tokenHash' in list[0]), 'token hashes are never returned');
  assert.equal((await laptop.post('/api/auth/sessions/revoke-others').set(CSRF)).status, 200);
  assert.equal((await phone.get('/api/auth/me')).status, 401, 'other device signed out');
  assert.equal((await laptop.get('/api/auth/me')).status, 200, 'this device stays signed in');
});

test('admin sign-in still works after hardening (smoke)', needsDb, async () => {
  const admin = await loginAgent(request, app, ADMIN);
  assert.equal((await admin.get('/api/dashboard/summary')).status, 200);
});

function D(v) {
  return new Prisma.Decimal(v);
}

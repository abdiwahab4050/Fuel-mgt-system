/**
 * Auth building blocks — no database required.
 */
import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { hashToken } from '../src/auth/session.js';
import { hashPassword, passwordSchema, verifyPassword } from '../src/auth/password.js';
import { csrfGuard, requirePermission, stationScope } from '../src/middleware/auth.js';
import { resolveRange } from '../src/lib/dates.js';
import { createApp } from '../src/app.js';

// Runs a middleware and resolves with the error passed to next (or undefined)
const run = (mw, req) => new Promise((resolve) => mw(req, {}, resolve));
const userWith = (...perms) => ({ id: 'u1', permissions: new Set(perms) });

test('session token hash is deterministic and never equals the token', () => {
  assert.equal(hashToken('abc'), hashToken('abc'));
  assert.notEqual(hashToken('abc'), 'abc');
  assert.match(hashToken('abc'), /^[0-9a-f]{64}$/);
});

test('passwords are bcrypt-hashed and verify correctly', async () => {
  const hash = await hashPassword('secret123');
  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.equal(await verifyPassword('secret123', hash), true);
  assert.equal(await verifyPassword('wrong123', hash), false);
  assert.equal(await verifyPassword('anything', null), false, 'unknown user never verifies');
});

test('password policy requires 8+ chars with letters and numbers', () => {
  assert.equal(passwordSchema.safeParse('short1').success, false);
  assert.equal(passwordSchema.safeParse('onlyletters').success, false);
  assert.equal(passwordSchema.safeParse('12345678').success, false);
  assert.equal(passwordSchema.safeParse('fuel2026ok').success, true);
});

test('CSRF guard blocks state-changing requests without the header', async () => {
  const get = (h) => (name) => h[name.toLowerCase()];
  assert.equal(await run(csrfGuard, { method: 'GET', get: get({}) }), undefined);
  assert.equal((await run(csrfGuard, { method: 'POST', get: get({}) })).status, 403);
  assert.equal((await run(csrfGuard, { method: 'DELETE', get: get({ 'x-requested-with': 'other' }) })).status, 403);
  assert.equal(await run(csrfGuard, { method: 'POST', get: get({ 'x-requested-with': 'fuelflow' }) }), undefined);
});

test('requirePermission: 401 anonymous, 403 missing permission, pass with any listed permission', async () => {
  const mw = requirePermission('users.manage', 'users.view');
  assert.equal((await run(mw, { user: null })).status, 401);
  assert.equal((await run(mw, { user: userWith('sales.create') })).status, 403);
  assert.equal(await run(mw, { user: userWith('users.view') }), undefined);
});

test('station-bound users cannot query another station', () => {
  assert.equal(stationScope({ user: { stationId: 'A' }, query: { stationId: 'B' } }), 'A');
  assert.equal(stationScope({ user: { stationId: null }, query: { stationId: 'B' } }), 'B');
  assert.equal(stationScope({ user: { stationId: null }, query: {} }), undefined);
});

test('date ranges: defaults to 30 days, validates order, format and length', () => {
  assert.equal(resolveRange({}).days, 30);
  const r = resolveRange({ from: '2026-01-01', to: '2026-01-31' });
  assert.equal(r.days, 31);
  assert.equal(r.from, '2026-01-01');
  assert.throws(() => resolveRange({ from: '2026-02-01', to: '2026-01-01' }), /on or after/);
  assert.throws(() => resolveRange({ from: '2026-13-01' }), /valid date/);
  assert.throws(() => resolveRange({ from: '01/02/2026' }), /YYYY-MM-DD/);
  assert.throws(() => resolveRange({ from: '2024-01-01', to: '2026-01-01' }), /cannot exceed/);
});

test('API rejects unauthenticated and unverified requests before touching data', async () => {
  const app = createApp();
  assert.equal((await request(app).get('/api/auth/me')).status, 401);
  assert.equal((await request(app).get('/api/users')).status, 401);
  assert.equal((await request(app).get('/api/dashboard/summary')).status, 401);
  const noHeader = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x' });
  assert.equal(noHeader.status, 403);
  const cfg = await request(app).get('/api/auth/config');
  assert.equal(cfg.status, 200);
  assert.equal(typeof cfg.body.demo, 'boolean');
});

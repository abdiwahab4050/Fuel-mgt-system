/**
 * Payment building blocks — no database required.
 */
import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { buildSignedWebhook, createSandboxProvider, SIGNATURE_HEADER, TIMESTAMP_HEADER, WEBHOOK_TOLERANCE_SECONDS } from '../src/services/payments/providers/sandbox.js';
import { createLiveProvider, LIVE_REQUIREMENTS } from '../src/services/payments/providers/live.js';
import { normalizePhone } from '../src/services/payments/index.js';

const sandbox = createSandboxProvider('ZAAD');
const event = { eventId: 'evt_1', reference: 'FF-PAY-2026-000001', status: 'SUCCESSFUL' };

test('sandbox webhook: a correctly signed body verifies', () => {
  const { rawBody, headers } = buildSignedWebhook(event);
  const v = sandbox.verifyWebhook(rawBody, headers);
  assert.equal(v.valid, true);
  assert.equal(v.reference, event.reference);
});

test('sandbox webhook: tampered body, wrong signature, missing headers are rejected', () => {
  const { rawBody, headers } = buildSignedWebhook(event);
  assert.equal(sandbox.verifyWebhook(rawBody.replace('SUCCESSFUL', 'SUCCESSFUL '), headers).valid, false);
  assert.equal(sandbox.verifyWebhook(rawBody, { ...headers, [SIGNATURE_HEADER]: 'a'.repeat(64) }).valid, false);
  assert.equal(sandbox.verifyWebhook(rawBody, {}).valid, false);
});

test('sandbox webhook: old timestamps are rejected (replay protection)', () => {
  const old = Math.floor(Date.now() / 1000) - WEBHOOK_TOLERANCE_SECONDS - 10;
  const { rawBody, headers } = buildSignedWebhook(event, old);
  const v = sandbox.verifyWebhook(rawBody, headers);
  assert.equal(v.valid, false);
  assert.match(v.error, /tolerance/);
  // re-signing with a new timestamp is impossible without the secret
  assert.equal(sandbox.verifyWebhook(rawBody, { ...headers, [TIMESTAMP_HEADER]: String(Math.floor(Date.now() / 1000)) }).valid, false);
});

test('phone numbers are normalized and validated', () => {
  assert.equal(normalizePhone('+252 63 444-4444'), '252634444444');
  assert.throws(() => normalizePhone('12'), /valid mobile/);
  assert.throws(() => normalizePhone('63abc4444'), /valid mobile/);
});

test('live adapters never claim to work: unavailable with a precise reason', async () => {
  for (const method of Object.keys(LIVE_REQUIREMENTS)) {
    const p = createLiveProvider(method);
    assert.equal(p.available, false);
    assert.equal(p.implemented, false);
    assert.match(p.unavailableReason, /not configured|not been implemented/);
    await assert.rejects(async () => p.initiate({}), (e) => e.code === 'PROVIDER_UNAVAILABLE');
    assert.equal(p.verifyWebhook('{}', {}).valid, false, 'a live webhook is never accepted unverified');
  }
});

test('live adapter with credentials present still reports "not implemented"', () => {
  const keys = LIVE_REQUIREMENTS.EDAHAB.env;
  for (const k of keys) process.env[k] = 'x';
  try {
    const p = createLiveProvider('EDAHAB');
    assert.equal(p.configured, true);
    assert.equal(p.available, false);
    assert.match(p.unavailableReason, /not been implemented/);
  } finally {
    for (const k of keys) delete process.env[k];
  }
});

test('webhook endpoint: no CSRF/session needed, but a bad signature is refused', async () => {
  const app = createApp();
  const bad = await request(app).post('/api/webhooks/zaad').set('Content-Type', 'application/json').send(JSON.stringify(event));
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, 'BAD_SIGNATURE');
  assert.equal((await request(app).post('/api/webhooks/paypal').send('{}')).status, 404);
});

test('starting a payment needs a signed-in user with permission', async () => {
  const app = createApp();
  assert.equal((await request(app).post('/api/invoices/x/pay').set('X-Requested-With', 'fuelflow').send({})).status, 401);
  assert.equal((await request(app).get('/api/payments/providers')).status, 401);
});

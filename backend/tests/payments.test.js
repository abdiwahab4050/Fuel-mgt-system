/**
 * Electronic payment lifecycle against the sandbox provider — migrated +
 * seeded database, PAYMENT_MODE=sandbox. Builds its own station.
 */
import { ADMIN, CSRF, loginAgent, needsDb, prisma } from './helpers.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createApp } from '../src/app.js';
import { applyStockMovement } from '../src/services/stock.js';
import { hashPassword } from '../src/auth/password.js';
import { expireStalePayments } from '../src/services/payments/index.js';
import { _sandboxState, buildSignedWebhook, simulateCustomerAction } from '../src/services/payments/providers/sandbox.js';

const app = createApp();
const D = (v) => new Prisma.Decimal(v);
const RUN = Date.now().toString(36).toUpperCase();
const ctx = { agents: {} };
let seq = 0;
const key = () => `pay-${RUN}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

async function makeUser(roleKey, stationId) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const email = `${roleKey}-${RUN}-${Math.random().toString(36).slice(2, 6)}@test.fuelflow.local`.toLowerCase(); // the API stores emails lower-case
  const user = await prisma.user.create({ data: { email, name: `T ${roleKey}`, roleId: role.id, stationId, passwordHash: await hashPassword('testpass123') } });
  return { user, creds: { email, password: 'testpass123' } };
}

// an unpaid ZAAD sale → invoice
async function unpaidInvoice(liters = '10', extra = {}) {
  const res = await ctx.agents.cashier.post('/api/sales').set(CSRF).send({
    idempotencyKey: key(), paymentMethod: 'ZAAD', items: [{ nozzleId: ctx.nozzle.id, quantity: liters }], ...extra,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.sale.invoice;
}
const pay = (agent, invoiceId, body) => agent.post(`/api/invoices/${invoiceId}/pay`).set(CSRF).send({ idempotencyKey: key(), ...body });
const sim = (agent, reference, action) => agent.post(`/api/payments/sandbox/${encodeURIComponent(reference)}/${action}`).set(CSRF).send({});
const invoiceOf = (id) => prisma.invoice.findUnique({ where: { id } });

before(async () => {
  if (needsDb.skip) return;
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
  ctx.station = await prisma.station.create({ data: { code: `TSP-${RUN}`, name: `Payments Test ${RUN}` } });
  ctx.product = await prisma.fuelProduct.create({ data: { code: `TP${RUN}`, name: 'Pay Test Diesel', sellingPrice: D('2.00'), costPrice: D('1.50') } });
  ctx.tank = await prisma.tank.create({ data: { code: 'T1', stationId: ctx.station.id, productId: ctx.product.id, capacityLiters: D('5000') } });
  await prisma.$transaction((tx) => applyStockMovement(tx, { tankId: ctx.tank.id, type: 'OPENING', quantity: D('2000'), userId: admin.id }));
  const pump = await prisma.pump.create({ data: { code: 'P1', stationId: ctx.station.id } });
  ctx.nozzle = await prisma.nozzle.create({ data: { code: 'N1', pumpId: pump.id, tankId: ctx.tank.id } });
  for (const [name, role] of [['cashier', 'cashier'], ['manager', 'station_manager'], ['manager2', 'station_manager']]) {
    ctx[name] = await makeUser(role, ctx.station.id);
    ctx.agents[name] = await loginAgent(request, app, ctx[name].creds);
  }
  ctx.customer = await prisma.customer.create({ data: { customerNo: `CUS-P${RUN}-1`, name: 'Portal Payer', phone: '252634111111', creditAllowed: true, creditLimit: D('1000') } });
  const portal = await makeUser('customer', null);
  await prisma.customer.update({ where: { id: ctx.customer.id }, data: { userId: portal.user.id } });
  ctx.agents.customer = await loginAgent(request, app, portal.creds);
});

after(async () => {
  if (!ctx.station) return prisma.$disconnect();
  const sid = ctx.station.id;
  const invoiceIds = (await prisma.invoice.findMany({ where: { stationId: sid }, select: { id: true } })).map((i) => i.id);
  const paymentIds = (await prisma.payment.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true, reference: true } }));
  const users = (await prisma.user.findMany({ where: { email: { contains: `-${RUN}-`.toLowerCase() } }, select: { id: true } })).map((u) => u.id);
  await prisma.webhookEvent.deleteMany({ where: { payload: { path: ['reference'], string_starts_with: 'FF-' }, receivedAt: { gte: new Date(Date.now() - 3600_000) } } }).catch(() => {});
  await prisma.refund.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await prisma.paymentTransaction.deleteMany({ where: { paymentId: { in: paymentIds.map((p) => p.id) } } });
  await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  await prisma.saleItem.deleteMany({ where: { sale: { stationId: sid } } });
  await prisma.sale.deleteMany({ where: { stationId: sid } });
  await prisma.stockMovement.deleteMany({ where: { tankId: ctx.tank.id } });
  await prisma.notification.deleteMany({ where: { OR: [{ stationId: sid }, { userId: { in: users } }] } });
  await prisma.nozzle.deleteMany({ where: { tankId: ctx.tank.id } });
  await prisma.pump.deleteMany({ where: { stationId: sid } });
  await prisma.tank.delete({ where: { id: ctx.tank.id } });
  await prisma.fuelProduct.delete({ where: { id: ctx.product.id } });
  await prisma.customer.deleteMany({ where: { customerNo: { startsWith: `CUS-P${RUN}` } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { entityId: { in: paymentIds.map((p) => p.id) } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.station.delete({ where: { id: sid } });
  await prisma.$disconnect();
});

test('ZAAD: request → customer approves → signed webhook → server verifies → invoice PAID', needsDb, async () => {
  const inv = await unpaidInvoice('10'); // 20.00
  const start = await pay(ctx.agents.cashier, inv.id, { method: 'ZAAD', phone: '+252 63 444 4444' });
  assert.equal(start.status, 201);
  const p = start.body.payment;
  assert.equal(p.status, 'PENDING');
  assert.equal(p.amount, 20);
  assert.equal(p.payerPhone, '252****44', 'phone is masked in responses');
  assert.equal((await invoiceOf(inv.id)).status, 'UNPAID', 'nothing is paid at initiation');

  // a status poll before the customer acts changes nothing
  assert.equal((await ctx.agents.cashier.get(`/api/payments/${p.id}`)).body.payment.status, 'PENDING');

  assert.equal((await sim(ctx.agents.cashier, p.reference, 'approve')).status, 200);
  const done = await ctx.agents.cashier.get(`/api/payments/${p.id}`);
  assert.equal(done.body.payment.status, 'SUCCESSFUL');
  assert.match(done.body.payment.providerReference, /^SBX-ZAAD-/);
  assert.equal(done.body.invoice.status, 'PAID');
  const events = await prisma.paymentTransaction.findMany({ where: { paymentId: p.id } });
  assert.ok(events.some((e) => e.type === 'INITIATE') && events.some((e) => e.type === 'CALLBACK'));
  assert.ok(!JSON.stringify(events).includes('2526344444'), 'full phone number not stored in provider logs');
});

test('the browser cannot mark a payment paid; duplicate and forged webhooks are harmless', needsDb, async () => {
  const inv = await unpaidInvoice('5');
  const p = (await pay(ctx.agents.cashier, inv.id, { method: 'EDAHAB', phone: '252655000001' })).body.payment;

  // no endpoint accepts a client-declared outcome
  assert.equal((await ctx.agents.cashier.post(`/api/payments/${p.id}`).set(CSRF).send({ status: 'SUCCESSFUL' })).status, 404);
  assert.equal((await ctx.agents.cashier.patch(`/api/payments/${p.id}`).set(CSRF).send({ status: 'SUCCESSFUL' })).status, 404);

  // forged webhook (validly signed but provider-side state still pending) → status check says PENDING → no change
  const forged = buildSignedWebhook({ eventId: `evt_forge_${RUN}`, reference: p.reference, status: 'SUCCESSFUL' });
  const r = await request(app).post('/api/webhooks/edahab').set('Content-Type', 'application/json').set(forged.headers).send(forged.rawBody);
  assert.equal(r.status, 200);
  assert.equal((await prisma.payment.findUnique({ where: { id: p.id } })).status, 'PENDING', 'webhook claims are confirmed with the provider');

  // real approval, then the same webhook delivered twice
  const hook = simulateCustomerAction(p.reference, 'approve');
  const first = await request(app).post('/api/webhooks/edahab').set('Content-Type', 'application/json').set(hook.headers).send(hook.rawBody);
  const second = await request(app).post('/api/webhooks/edahab').set('Content-Type', 'application/json').set(hook.headers).send(hook.rawBody);
  assert.equal(first.body.status, 'SUCCESSFUL');
  assert.equal(second.body.duplicate, true);
  const invoice = await invoiceOf(inv.id);
  assert.equal(invoice.amountPaid.toString(), '10', 'applied exactly once');
  assert.equal(await prisma.payment.count({ where: { invoiceId: inv.id, status: 'SUCCESSFUL' } }), 1);
});

test('declines and sandbox insufficient-balance leave the invoice unpaid', needsDb, async () => {
  const inv = await unpaidInvoice('3');
  const p1 = (await pay(ctx.agents.cashier, inv.id, { method: 'ZAAD', phone: '252634000000' })).body.payment; // ends in 0
  await sim(ctx.agents.cashier, p1.reference, 'approve');
  const r1 = (await ctx.agents.cashier.get(`/api/payments/${p1.id}`)).body;
  assert.equal(r1.payment.status, 'FAILED');
  assert.match(r1.payment.failureReason, /Insufficient balance/);

  const p2 = (await pay(ctx.agents.cashier, inv.id, { method: 'MASTERCARD' })).body;
  assert.match(p2.redirectUrl, /\/api\/payments\/sandbox\/checkout\//);
  await sim(ctx.agents.cashier, p2.payment.reference, 'decline');
  assert.equal((await ctx.agents.cashier.get(`/api/payments/${p2.payment.id}`)).body.payment.status, 'FAILED');
  assert.equal((await invoiceOf(inv.id)).status, 'UNPAID');
});

test('one payment in flight per invoice; cash is blocked while it is pending; retries are idempotent', needsDb, async () => {
  const inv = await unpaidInvoice('4');
  const k = key();
  const a = await ctx.agents.cashier.post(`/api/invoices/${inv.id}/pay`).set(CSRF).send({ method: 'ZAAD', phone: '252634555555', idempotencyKey: k });
  const again = await ctx.agents.cashier.post(`/api/invoices/${inv.id}/pay`).set(CSRF).send({ method: 'ZAAD', phone: '252634555555', idempotencyKey: k });
  assert.equal(again.status, 200);
  assert.equal(again.body.payment.id, a.body.payment.id);

  const other = await pay(ctx.agents.cashier, inv.id, { method: 'MASTERCARD' });
  assert.equal(other.status, 409);
  assert.equal(other.body.error.details.paymentId, a.body.payment.id);
  const cash = await ctx.agents.cashier.post(`/api/invoices/${inv.id}/payments`).set(CSRF).send({ amount: '8', method: 'CASH', idempotencyKey: key() });
  assert.equal(cash.status, 409, 'no double payment while ZAAD is pending');
  assert.equal((await ctx.agents.manager.post(`/api/sales/${inv.saleId}/cancel`).set(CSRF).send({ reason: 'pending payment exists' })).status, 409);

  // cancel asks the provider first; still pending → cancelled
  const cancelled = await ctx.agents.cashier.post(`/api/payments/${a.body.payment.id}/cancel`).set(CSRF);
  assert.equal(cancelled.body.payment.status, 'CANCELLED');
  assert.equal((await ctx.agents.cashier.post(`/api/invoices/${inv.id}/payments`).set(CSRF).send({ amount: '8', method: 'CASH', idempotencyKey: key() })).status, 201);
});

test('cancelling a payment the customer already approved records it as paid', needsDb, async () => {
  const inv = await unpaidInvoice('2');
  const p = (await pay(ctx.agents.cashier, inv.id, { method: 'ZAAD', phone: '252634777777' })).body.payment;
  simulateCustomerAction(p.reference, 'approve'); // approved at the provider, webhook not delivered yet
  const res = await ctx.agents.cashier.post(`/api/payments/${p.id}/cancel`).set(CSRF);
  assert.equal(res.body.payment.status, 'SUCCESSFUL');
  assert.equal((await invoiceOf(inv.id)).status, 'PAID');
});

test('amount mismatch from the provider is not applied and is flagged for review', needsDb, async () => {
  const inv = await unpaidInvoice('6');
  const p = (await pay(ctx.agents.cashier, inv.id, { method: 'ZAAD', phone: '252634888888' })).body.payment;
  simulateCustomerAction(p.reference, 'approve');
  _sandboxState().get(p.reference).amount = '1.00'; // provider says only 1.00 was paid
  const res = (await ctx.agents.cashier.get(`/api/payments/${p.id}`)).body;
  assert.equal(res.payment.status, 'FAILED');
  assert.match(res.payment.failureReason, /Amount mismatch/);
  assert.equal((await invoiceOf(inv.id)).amountPaid.toString(), '0');
  assert.ok(await prisma.notification.count({ where: { stationId: ctx.station.id, title: 'Payment needs review' } }));
});

test('partial electronic payment then balance', needsDb, async () => {
  const inv = await unpaidInvoice('10'); // 20.00
  assert.equal((await pay(ctx.agents.cashier, inv.id, { method: 'ZAAD', phone: '252634111222', amount: '25' })).status, 400, 'cannot exceed balance');
  const p = (await pay(ctx.agents.cashier, inv.id, { method: 'ZAAD', phone: '252634111222', amount: '12.50' })).body.payment;
  await sim(ctx.agents.cashier, p.reference, 'approve');
  assert.equal((await invoiceOf(inv.id)).status, 'PARTIALLY_PAID');
  const rest = (await pay(ctx.agents.cashier, inv.id, { method: 'MASTERCARD' })).body;
  assert.equal(rest.payment.amount, 7.5, 'defaults to the remaining balance');
  await sim(ctx.agents.cashier, rest.payment.reference, 'approve');
  const final = (await ctx.agents.cashier.get(`/api/payments/${rest.payment.id}`)).body.payment;
  assert.equal(final.cardBrand, 'MASTERCARD');
  assert.equal(final.cardLast4, '0008');
  assert.equal((await invoiceOf(inv.id)).status, 'PAID');
  const stored = await prisma.payment.findUnique({ where: { id: rest.payment.id } });
  assert.equal(stored.cardLast4.length, 4, 'only last 4 digits stored');
});

test('customers can pay their own invoices only', needsDb, async () => {
  const mine = await unpaidInvoice('5', { paymentMethod: 'CREDIT_ACCOUNT', customerId: ctx.customer.id });
  const notMine = await unpaidInvoice('5');
  assert.equal((await pay(ctx.agents.customer, notMine.id, { method: 'ZAAD', phone: '252634111111' })).status, 404);
  const p = await pay(ctx.agents.customer, mine.id, { method: 'ZAAD', phone: '252634111111' });
  assert.equal(p.status, 201);
  assert.equal((await ctx.agents.customer.get(`/api/payments/${p.body.payment.id}`)).status, 200);
  await sim(ctx.agents.customer, p.body.payment.reference, 'approve');
  assert.equal((await invoiceOf(mine.id)).status, 'PAID');
  const otherPayment = await prisma.payment.findFirst({ where: { invoiceId: { not: mine.id }, invoice: { stationId: ctx.station.id } } });
  assert.equal((await ctx.agents.customer.get(`/api/payments/${otherPayment.id}`)).status, 404);
});

test('electronic refund: approved by a second person, returned through the provider', needsDb, async () => {
  const inv = await unpaidInvoice('5'); // 10.00
  const p = (await pay(ctx.agents.cashier, inv.id, { method: 'ZAAD', phone: '252634999999' })).body.payment;
  await sim(ctx.agents.cashier, p.reference, 'approve');
  const r = await ctx.agents.cashier.post(`/api/invoices/${inv.id}/refunds`).set(CSRF).send({ amount: '10.00', paymentId: p.id, reason: 'Duplicate payment by customer' });
  assert.equal(r.status, 201);
  const approved = await ctx.agents.manager.post(`/api/refunds/${r.body.refund.id}/approve`).set(CSRF);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.refund.status, 'COMPLETED');
  assert.match(approved.body.refund.providerReference, /^SBX-RF-/);
  assert.equal((await prisma.payment.findUnique({ where: { id: p.id } })).status, 'REFUNDED');
  assert.equal((await invoiceOf(inv.id)).status, 'REFUNDED');
  assert.ok(await prisma.paymentTransaction.count({ where: { paymentId: p.id, type: 'REFUND' } }));
});

test('stale pending payments expire after the timeout', needsDb, async () => {
  const inv = await unpaidInvoice('1');
  const p = (await pay(ctx.agents.cashier, inv.id, { method: 'ZAAD', phone: '252634123456' })).body.payment;
  await prisma.payment.update({ where: { id: p.id }, data: { createdAt: new Date(Date.now() - 60 * 60000) } });
  await expireStalePayments();
  const after = await prisma.payment.findUnique({ where: { id: p.id } });
  assert.equal(after.status, 'CANCELLED');
  assert.match(after.failureReason, /Expired/);
});

test('provider status endpoint is admin-only and exposes names, not secrets', needsDb, async () => {
  assert.equal((await ctx.agents.manager.get('/api/payments/providers/status')).status, 403);
  const admin = await loginAgent(request, app, ADMIN);
  const res = await admin.get('/api/payments/providers/status');
  assert.equal(res.status, 200);
  for (const p of res.body.providers) {
    assert.ok(Array.isArray(p.requiredEnv) && p.liveImplemented === false);
    for (const k of p.requiredEnv) assert.ok(!JSON.stringify(res.body).includes(String(process.env[k] || '\u0000')));
  }
});

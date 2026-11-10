/**
 * Sales, invoices, payments, credit, discounts, cancellations, refunds and
 * visibility — against a migrated + seeded database. Builds its own station.
 */
import { ADMIN, CSRF, loginAgent, needsDb, prisma } from './helpers.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createApp } from '../src/app.js';
import { applyStockMovement } from '../src/services/stock.js';
import { hashPassword } from '../src/auth/password.js';

const app = createApp();
const D = (v) => new Prisma.Decimal(v);
const RUN = Date.now().toString(36).toUpperCase();
const ctx = { agents: {} };
let keySeq = 0;
const key = () => `test-${RUN}-${++keySeq}-${Math.random().toString(36).slice(2, 8)}`;

async function makeUser(roleKey, stationId) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const email = `${roleKey}-${RUN}-${Math.random().toString(36).slice(2, 6)}@test.fuelflow.local`.toLowerCase(); // the API stores emails lower-case
  const user = await prisma.user.create({ data: { email, name: `T ${roleKey}`, roleId: role.id, stationId, passwordHash: await hashPassword('testpass123') } });
  return { user, creds: { email, password: 'testpass123' } };
}

const sell = (agent, body) => agent.post('/api/sales').set(CSRF).send({
  idempotencyKey: key(), paymentMethod: 'CASH', items: [{ nozzleId: ctx.nozzle.id, quantity: '10' }], ...body,
});
const level = async () => (await prisma.tank.findUnique({ where: { id: ctx.tank.id } })).currentLiters;

before(async () => {
  if (needsDb.skip) return;
  ctx.originalTax = await prisma.setting.findUnique({ where: { key: 'invoice.taxRate' } });
  ctx.originalDiscount = await prisma.setting.findUnique({ where: { key: 'sales.maxDiscountPercentWithoutApproval' } });
  await prisma.setting.upsert({ where: { key: 'invoice.taxRate' }, update: { value: 0 }, create: { key: 'invoice.taxRate', value: 0 } });
  await prisma.setting.upsert({ where: { key: 'sales.maxDiscountPercentWithoutApproval' }, update: { value: 0 }, create: { key: 'sales.maxDiscountPercentWithoutApproval', value: 0 } });

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
  ctx.station = await prisma.station.create({ data: { code: `TSS-${RUN}`, name: `Sales Test ${RUN}` } });
  ctx.product = await prisma.fuelProduct.create({ data: { code: `TS${RUN}`, name: 'Sales Test Petrol', sellingPrice: D('1.8950'), costPrice: D('1.40') } });
  ctx.tank = await prisma.tank.create({ data: { code: 'T1', stationId: ctx.station.id, productId: ctx.product.id, capacityLiters: D('5000'), minLevelLiters: D('10') } });
  await prisma.$transaction((tx) => applyStockMovement(tx, { tankId: ctx.tank.id, type: 'OPENING', quantity: D('1000'), userId: admin.id }));
  const pump = await prisma.pump.create({ data: { code: 'P1', stationId: ctx.station.id } });
  ctx.nozzle = await prisma.nozzle.create({ data: { code: 'N1', pumpId: pump.id, tankId: ctx.tank.id } });

  for (const [name, role] of [['cashier', 'cashier'], ['cashier2', 'cashier'], ['manager', 'station_manager'], ['manager2', 'station_manager']]) {
    const u = await makeUser(role, ctx.station.id);
    ctx[name] = u;
    ctx.agents[name] = await loginAgent(request, app, u.creds);
  }
  ctx.creditCustomer = await prisma.customer.create({ data: { customerNo: `CUS-T${RUN}-1`, name: 'Credit Co', creditAllowed: true, creditLimit: D('100') } });
  ctx.cashCustomer = await prisma.customer.create({ data: { customerNo: `CUS-T${RUN}-2`, name: 'No Credit Ltd' } });
  const portal = await makeUser('customer', null);
  await prisma.customer.update({ where: { id: ctx.creditCustomer.id }, data: { userId: portal.user.id } });
  ctx.agents.customer = await loginAgent(request, app, portal.creds);
  ctx.agents.admin = await loginAgent(request, app, ADMIN);
});

after(async () => {
  if (!ctx.station) return prisma.$disconnect();
  const sid = ctx.station.id;
  for (const k of ['invoice.taxRate', 'sales.maxDiscountPercentWithoutApproval']) {
    const orig = k === 'invoice.taxRate' ? ctx.originalTax : ctx.originalDiscount;
    if (orig) await prisma.setting.update({ where: { key: k }, data: { value: orig.value } });
  }
  const invoiceIds = (await prisma.invoice.findMany({ where: { stationId: sid }, select: { id: true } })).map((i) => i.id);
  const users = (await prisma.user.findMany({ where: { email: { contains: `-${RUN}-`.toLowerCase() } }, select: { id: true } })).map((u) => u.id);
  await prisma.refund.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await prisma.paymentTransaction.deleteMany({ where: { payment: { invoiceId: { in: invoiceIds } } } });
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
  await prisma.customer.deleteMany({ where: { customerNo: { startsWith: `CUS-T${RUN}` } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
  await prisma.session.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.station.delete({ where: { id: sid } });
  await prisma.$disconnect();
});

test('cash sale: server prices it, deducts stock, invoices and records payment', needsDb, async () => {
  const before = await level();
  const res = await sell(ctx.agents.cashier, { items: [{ nozzleId: ctx.nozzle.id, quantity: '10.5' }], amountTendered: '25', unitPrice: '0.01', total: '0.01' });
  assert.equal(res.status, 201);
  const { sale, change } = res.body;
  assert.equal(sale.total, 19.9, '10.5 L × 1.8950 = 19.8975 → 19.90 (client price ignored)');
  assert.equal(change, 5.1);
  assert.equal(sale.invoice.status, 'PAID');
  assert.equal(sale.invoice.payments.length, 1);
  assert.equal(sale.invoice.payments[0].method, 'CASH');
  assert.equal((await level()).toString(), before.minus('10.5').toString());
  const mv = await prisma.stockMovement.findFirst({ where: { referenceId: sale.id } });
  assert.equal(mv.type, 'SALE');
  assert.match(sale.saleNo, /^SAL-\d{4}-\d{6}$/);
  assert.match(sale.invoice.invoiceNo, /^INV-\d{4}-\d{6}$/);
});

test('tax is applied from settings at the time of sale', needsDb, async () => {
  await prisma.setting.update({ where: { key: 'invoice.taxRate' }, data: { value: 5 } });
  try {
    const res = await sell(ctx.agents.cashier, { items: [{ nozzleId: ctx.nozzle.id, quantity: '20' }] });
    assert.equal(res.status, 201);
    assert.equal(res.body.sale.subtotal, 37.9);
    assert.equal(res.body.sale.taxTotal, 1.9, '5% of 37.90 = 1.895 → 1.90');
    assert.equal(res.body.sale.total, 39.8);
    assert.equal(res.body.sale.invoice.taxRate, 5);
  } finally {
    await prisma.setting.update({ where: { key: 'invoice.taxRate' }, data: { value: 0 } });
  }
});

test('duplicate submissions create one sale (sequential and concurrent)', needsDb, async () => {
  const k = key();
  const body = { idempotencyKey: k, paymentMethod: 'CASH', items: [{ nozzleId: ctx.nozzle.id, quantity: '1' }] };
  const before = await level();
  const results = await Promise.all([1, 2, 3].map(() => ctx.agents.cashier.post('/api/sales').set(CSRF).send(body)));
  const again = await ctx.agents.cashier.post('/api/sales').set(CSRF).send(body);
  const ids = new Set([...results, again].map((r) => r.body.sale.id));
  assert.equal(ids.size, 1);
  assert.ok(again.body.replayed);
  assert.equal(await prisma.sale.count({ where: { idempotencyKey: k } }), 1);
  assert.equal((await level()).toString(), before.minus(1).toString(), 'stock deducted once');
  assert.equal((await ctx.agents.cashier2.post('/api/sales').set(CSRF).send(body)).status, 409, 'another user cannot replay the key');
});

test('selling more than the tank holds fails and leaves nothing behind', needsDb, async () => {
  const salesBefore = await prisma.sale.count({ where: { stationId: ctx.station.id } });
  const res = await sell(ctx.agents.cashier, { items: [{ nozzleId: ctx.nozzle.id, quantity: '99999' }] });
  assert.equal(res.status, 409);
  assert.equal(await prisma.sale.count({ where: { stationId: ctx.station.id } }), salesBefore);
});

test('credit sales respect credit permission and limit; partial payments update status', needsDb, async () => {
  assert.equal((await sell(ctx.agents.cashier, { paymentMethod: 'CREDIT_ACCOUNT' })).status, 400, 'needs a customer');
  assert.equal((await sell(ctx.agents.cashier, { paymentMethod: 'CREDIT_ACCOUNT', customerId: ctx.cashCustomer.id })).status, 409, 'not approved for credit');
  assert.equal((await sell(ctx.agents.cashier, { paymentMethod: 'CREDIT_ACCOUNT', customerId: ctx.creditCustomer.id, items: [{ nozzleId: ctx.nozzle.id, quantity: '60' }] })).status, 409, '113.70 > 100 limit');

  const ok = await sell(ctx.agents.cashier, { paymentMethod: 'CREDIT_ACCOUNT', customerId: ctx.creditCustomer.id, items: [{ nozzleId: ctx.nozzle.id, quantity: '40' }] });
  assert.equal(ok.status, 201);
  const inv = ok.body.sale.invoice;
  assert.equal(inv.status, 'UNPAID');
  assert.ok(new Date(inv.dueDate) > new Date(), 'due date in the future');
  ctx.creditInvoice = inv;

  const me = (await ctx.agents.customer.get('/api/customers/me')).body.customer;
  assert.equal(me.outstanding, 75.8);
  assert.equal(me.availableCredit, 24.2);

  const pay = (amount, extra = {}) => ctx.agents.cashier.post(`/api/invoices/${inv.id}/payments`).set(CSRF).send({ amount, method: 'CASH', idempotencyKey: key(), ...extra });
  assert.equal((await pay('100')).status, 409, 'cannot overpay');
  assert.equal((await pay('5', { method: 'ZAAD' })).status, 400, 'electronic payments cannot be keyed in');
  const part = await pay('30');
  assert.equal(part.status, 201);
  assert.equal(part.body.invoice.status, 'PARTIALLY_PAID');
  const k = key();
  const rest = await ctx.agents.cashier.post(`/api/invoices/${inv.id}/payments`).set(CSRF).send({ amount: '45.80', method: 'BANK_TRANSFER', reference: 'BNK-1', idempotencyKey: k });
  assert.equal(rest.body.invoice.status, 'PAID');
  const replay = await ctx.agents.cashier.post(`/api/invoices/${inv.id}/payments`).set(CSRF).send({ amount: '45.80', method: 'BANK_TRANSFER', reference: 'BNK-1', idempotencyKey: k });
  assert.equal(replay.status, 200, 'retried payment is not applied twice');
  assert.equal((await prisma.invoice.findUnique({ where: { id: inv.id } })).amountPaid.toString(), '75.8');
});

test('discounts above the free limit need a supervisor', needsDb, async () => {
  const body = { items: [{ nozzleId: ctx.nozzle.id, quantity: '10', discount: '2.00' }] };
  const res = await sell(ctx.agents.cashier, body);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'DISCOUNT_APPROVAL_REQUIRED');

  assert.equal((await sell(ctx.agents.cashier, { ...body, discountApproval: { email: ctx.manager.creds.email, password: 'wrong' } })).status, 403);
  assert.equal((await sell(ctx.agents.cashier, { ...body, discountApproval: ctx.cashier2.creds })).status, 403, 'approver needs the permission');

  const ok = await sell(ctx.agents.cashier, { ...body, discountApproval: ctx.manager.creds });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.sale.discountTotal, 2);
  assert.equal(ok.body.sale.total, 16.95);
  assert.equal((await prisma.sale.findUnique({ where: { id: ok.body.sale.id } })).discountApprovedById, ctx.manager.user.id);

  assert.equal((await sell(ctx.agents.manager, body)).status, 201, 'managers approve their own');
  assert.equal((await sell(ctx.agents.cashier, { items: [{ nozzleId: ctx.nozzle.id, quantity: '1', discount: '5' }] })).status, 400, 'discount above line amount');
});

test('electronic payment methods create an unpaid invoice awaiting the provider', needsDb, async () => {
  const res = await sell(ctx.agents.cashier, { paymentMethod: 'ZAAD' });
  assert.equal(res.status, 201);
  assert.equal(res.body.sale.invoice.status, 'UNPAID');
  assert.equal(res.body.sale.invoice.payments.length, 0);
  ctx.zaadSale = res.body.sale;
});

test('cancel: only unpaid sales, by authorized staff; fuel returns to the tank', needsDb, async () => {
  const paid = await sell(ctx.agents.cashier, {});
  assert.equal((await ctx.agents.manager.post(`/api/sales/${paid.body.sale.id}/cancel`).set(CSRF).send({ reason: 'test cancel' })).status, 409, 'paid → refund instead');

  const before = await level();
  assert.equal((await ctx.agents.cashier.post(`/api/sales/${ctx.zaadSale.id}/cancel`).set(CSRF).send({ reason: 'customer left' })).status, 403, 'cashiers cannot cancel');
  const res = await ctx.agents.manager.post(`/api/sales/${ctx.zaadSale.id}/cancel`).set(CSRF).send({ reason: 'Customer left before paying' });
  assert.equal(res.status, 200);
  assert.equal(res.body.sale.status, 'CANCELLED');
  assert.equal(res.body.sale.invoice.status, 'CANCELLED');
  assert.equal((await level()).toString(), before.plus(10).toString());
  assert.equal((await ctx.agents.manager.post(`/api/sales/${ctx.zaadSale.id}/cancel`).set(CSRF).send({ reason: 'again please' })).status, 409);
});

test('refunds: requested, approved by someone else, never more than was paid', needsDb, async () => {
  const sale = (await sell(ctx.agents.cashier, { items: [{ nozzleId: ctx.nozzle.id, quantity: '20' }] })).body.sale;
  const inv = sale.invoice;
  const paymentId = inv.payments[0].id;
  const ask = (agent, amount) => agent.post(`/api/invoices/${inv.id}/refunds`).set(CSRF).send({ amount, paymentId, reason: 'Pump overcharge complaint' });

  assert.equal((await ask(ctx.agents.cashier, '50')).status, 409, 'more than paid (37.90)');
  const r1 = await ask(ctx.agents.manager, '10');
  assert.equal(r1.status, 201);
  assert.equal((await ask(ctx.agents.cashier, '30')).status, 409, 'pending 10 is reserved: only 27.90 left');

  assert.equal((await ctx.agents.cashier.post(`/api/refunds/${r1.body.refund.id}/approve`).set(CSRF)).status, 403, 'cashiers cannot approve');
  assert.equal((await ctx.agents.manager.post(`/api/refunds/${r1.body.refund.id}/approve`).set(CSRF)).status, 403, 'no self-approval');
  const ok = await ctx.agents.manager2.post(`/api/refunds/${r1.body.refund.id}/approve`).set(CSRF);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.refund.status, 'COMPLETED', 'cash refund paid out on approval');
  assert.equal((await prisma.sale.findUnique({ where: { id: sale.id } })).status, 'PARTIALLY_REFUNDED');

  const r2 = await ask(ctx.agents.cashier, '27.90');
  await ctx.agents.manager.post(`/api/refunds/${r2.body.refund.id}/approve`).set(CSRF);
  assert.equal((await prisma.invoice.findUnique({ where: { id: inv.id } })).status, 'REFUNDED');
  assert.equal((await prisma.payment.findUnique({ where: { id: paymentId } })).status, 'REFUNDED');
  assert.equal((await prisma.sale.findUnique({ where: { id: sale.id } })).status, 'REFUNDED');
  assert.equal((await ask(ctx.agents.cashier, '0.01')).status, 409, 'nothing left to refund');
});

test('visibility: cashiers see their own sales, customers only their own records', needsDb, async () => {
  await sell(ctx.agents.cashier2, {});
  const mine = (await ctx.agents.cashier2.get('/api/sales').query({ pageSize: 100 })).body.sales;
  assert.ok(mine.length > 0 && mine.every((s) => s.cashier.name === 'T cashier'));
  const ids = new Set((await prisma.sale.findMany({ where: { cashierId: ctx.cashier2.user.id } })).map((s) => s.id));
  assert.ok(mine.every((s) => ids.has(s.id)));

  const custInvoices = (await ctx.agents.customer.get('/api/invoices')).body.invoices;
  assert.ok(custInvoices.length > 0 && custInvoices.every((i) => i.customer?.name === 'Credit Co'));
  const other = await prisma.invoice.findFirst({ where: { stationId: ctx.station.id, customerId: null } });
  assert.equal((await ctx.agents.customer.get(`/api/invoices/${other.id}`)).status, 404);
  assert.equal((await ctx.agents.customer.get(`/api/customers/${ctx.cashCustomer.id}/statement`)).status, 403);
  assert.equal((await ctx.agents.customer.post('/api/sales').set(CSRF).send({})).status, 403);
});

test('statement closing balance equals the outstanding balance', needsDb, async () => {
  const sale = await sell(ctx.agents.cashier, { paymentMethod: 'CREDIT_ACCOUNT', customerId: ctx.creditCustomer.id, items: [{ nozzleId: ctx.nozzle.id, quantity: '5' }] });
  assert.equal(sale.status, 201);
  const st = (await ctx.agents.customer.get(`/api/customers/${ctx.creditCustomer.id}/statement`)).body;
  const me = (await ctx.agents.customer.get('/api/customers/me')).body.customer;
  assert.equal(st.closing, me.outstanding);
  assert.equal(st.closing, 9.48, 'only the new 5 L credit sale (9.475 → 9.48) is unpaid');
});

test('settings: only administrators change them, with validation', needsDb, async () => {
  assert.equal((await ctx.agents.manager.put('/api/settings').set(CSRF).send({ 'company.name': 'X' })).status, 403);
  assert.equal((await ctx.agents.admin.put('/api/settings').set(CSRF).send({ 'currency.code': 'dollars' })).status, 400);
  assert.equal((await ctx.agents.admin.put('/api/settings').set(CSRF).send({ 'unknown.key': 1 })).status, 400);
  const s = (await ctx.agents.cashier.get('/api/settings')).body.settings;
  assert.ok(s['currency.symbol']);
});

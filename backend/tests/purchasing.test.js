/**
 * Purchasing, deliveries, accounts payable, expenses, employees and financial
 * statements — against a migrated + seeded database. Builds its own station.
 */
import { ADMIN, CSRF, DEMO, loginAgent, needsDb, prisma } from './helpers.js';
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
let seq = 0;
const key = () => `pur-${RUN}-${++seq}`;
const level = async () => (await prisma.tank.findUnique({ where: { id: ctx.tank.id } })).currentLiters;

async function makeUser(roleKey, stationId) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const email = `${roleKey}-${RUN}-${Math.random().toString(36).slice(2, 6)}@test.fuelflow.local`.toLowerCase(); // the API stores emails lower-case
  const user = await prisma.user.create({ data: { email, name: `T ${roleKey}`, roleId: role.id, stationId, passwordHash: await hashPassword('testpass123') } });
  return { user, creds: { email, password: 'testpass123' } };
}

before(async () => {
  if (needsDb.skip) return;
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
  ctx.station = await prisma.station.create({ data: { code: `TPU-${RUN}`, name: `Purchasing Test ${RUN}` } });
  ctx.product = await prisma.fuelProduct.create({ data: { code: `TU${RUN}`, name: 'Purchase Test Petrol', sellingPrice: D('2.00'), costPrice: D('1.50') } });
  ctx.tank = await prisma.tank.create({ data: { code: 'T1', stationId: ctx.station.id, productId: ctx.product.id, capacityLiters: D('10000') } });
  await prisma.$transaction((tx) => applyStockMovement(tx, { tankId: ctx.tank.id, type: 'OPENING', quantity: D('1000'), unitCost: D('1.50'), userId: admin.id }));
  const pump = await prisma.pump.create({ data: { code: 'P1', stationId: ctx.station.id } });
  ctx.nozzle = await prisma.nozzle.create({ data: { code: 'N1', pumpId: pump.id, tankId: ctx.tank.id } });
  ctx.supplier = await prisma.supplier.create({ data: { code: `SUP-T${RUN}`, name: `Test Refinery ${RUN}` } });
  for (const [name, role, station] of [['manager', 'station_manager', ctx.station.id], ['manager2', 'station_manager', ctx.station.id], ['cashier', 'cashier', ctx.station.id], ['accountant', 'accountant', null]]) {
    ctx[name] = await makeUser(role, station);
    ctx.agents[name] = await loginAgent(request, app, ctx[name].creds);
  }
  ctx.agents.admin = await loginAgent(request, app, ADMIN);
  ctx.agents.otherManager = await loginAgent(request, app, DEMO.manager); // seeded STN-001 manager
});

after(async () => {
  if (!ctx.station) return prisma.$disconnect();
  const sid = ctx.station.id;
  const users = (await prisma.user.findMany({ where: { email: { contains: `-${RUN}-`.toLowerCase() } }, select: { id: true } })).map((u) => u.id);
  const invoiceIds = (await prisma.invoice.findMany({ where: { stationId: sid }, select: { id: true } })).map((i) => i.id);
  await prisma.supplierPayment.deleteMany({ where: { supplierId: ctx.supplier.id } });
  await prisma.supplierInvoice.deleteMany({ where: { supplierId: ctx.supplier.id } });
  await prisma.fuelDelivery.deleteMany({ where: { supplierId: ctx.supplier.id } });
  await prisma.purchaseOrder.deleteMany({ where: { supplierId: ctx.supplier.id } });
  await prisma.expense.deleteMany({ where: { stationId: sid } });
  await prisma.employee.deleteMany({ where: { stationId: sid } });
  await prisma.paymentTransaction.deleteMany({ where: { payment: { invoiceId: { in: invoiceIds } } } });
  await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  await prisma.saleItem.deleteMany({ where: { sale: { stationId: sid } } });
  await prisma.sale.deleteMany({ where: { stationId: sid } });
  await prisma.customer.deleteMany({ where: { customerNo: { startsWith: `CUS-U${RUN}` } } });
  await prisma.stockMovement.deleteMany({ where: { tankId: ctx.tank.id } });
  await prisma.notification.deleteMany({ where: { OR: [{ stationId: sid }, { userId: { in: users } }] } });
  await prisma.nozzle.deleteMany({ where: { tankId: ctx.tank.id } });
  await prisma.pump.deleteMany({ where: { stationId: sid } });
  await prisma.tank.delete({ where: { id: ctx.tank.id } });
  await prisma.fuelPriceHistory.deleteMany({ where: { productId: ctx.product.id } });
  await prisma.fuelProduct.delete({ where: { id: ctx.product.id } });
  await prisma.supplier.delete({ where: { id: ctx.supplier.id } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
  await prisma.session.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.station.delete({ where: { id: sid } });
  await prisma.$disconnect();
});

const newPO = (agent, items, submit = true) => agent.post('/api/purchase-orders').set(CSRF).send({ supplierId: ctx.supplier.id, submit, items });

test('purchase orders: validated, totalled on the server, draft → ordered', needsDb, async () => {
  const m = ctx.agents.manager;
  assert.equal((await newPO(m, [{ productId: ctx.product.id, quantity: '10', unitCost: '1' }, { productId: ctx.product.id, quantity: '5', unitCost: '1' }])).status, 400, 'duplicate product lines');
  assert.equal((await ctx.agents.cashier.post('/api/purchase-orders').set(CSRF).send({})).status, 403);
  const draft = await newPO(m, [{ productId: ctx.product.id, quantity: '3000', unitCost: '1.4567' }], false);
  assert.equal(draft.status, 201);
  assert.equal(draft.body.order.status, 'DRAFT');
  assert.equal(draft.body.order.totalAmount, 4370.1, '3000 × 1.4567 = 4370.10');
  assert.equal((await m.post('/api/deliveries').set(CSRF).send({ purchaseOrderId: draft.body.order.id, tankId: ctx.tank.id, quantityDelivered: '10' })).status, 409, 'no deliveries on drafts');
  const sent = await m.post(`/api/purchase-orders/${draft.body.order.id}/order`).set(CSRF);
  assert.equal(sent.body.order.status, 'ORDERED');
  ctx.po = sent.body.order;
});

test('deliveries: pending until confirmed; confirmed stock enters the tank with its cost', needsDb, async () => {
  const m = ctx.agents.manager;
  const before = await level();
  assert.equal((await m.post('/api/deliveries').set(CSRF).send({ purchaseOrderId: ctx.po.id, tankId: ctx.tank.id, quantityDelivered: '3500' })).status, 409, 'more than ordered');
  const d1 = await m.post('/api/deliveries').set(CSRF).send({ purchaseOrderId: ctx.po.id, tankId: ctx.tank.id, quantityDelivered: '2000' });
  assert.equal(d1.status, 201);
  assert.equal(d1.body.delivery.status, 'PENDING');
  assert.equal(d1.body.delivery.unitCost, 1.4567, 'cost defaults to the PO price');
  assert.equal((await level()).toString(), before.toString(), 'pending delivery does not change stock');
  assert.equal((await m.post('/api/deliveries').set(CSRF).send({ purchaseOrderId: ctx.po.id, tankId: ctx.tank.id, quantityDelivered: '1500' })).status, 409, 'pending quantity is reserved against the PO');

  assert.equal((await ctx.agents.otherManager.post(`/api/deliveries/${d1.body.delivery.id}/confirm`).set(CSRF).send({})).status, 403, 'other station');
  assert.equal((await m.post(`/api/deliveries/${d1.body.delivery.id}/confirm`).set(CSRF).send({ quantityDelivered: '2100' })).status, 400, 'cannot confirm more than the note');
  const c = await m.post(`/api/deliveries/${d1.body.delivery.id}/confirm`).set(CSRF).send({ quantityDelivered: '1980' });
  assert.equal(c.status, 200);
  assert.equal(c.body.delivery.quantityDelivered, 1980);
  assert.equal(c.body.delivery.totalCost, 2884.27, '1980 × 1.4567 = 2884.266 → 2884.27');
  assert.equal((await level()).toString(), before.plus(1980).toString());
  const mv = await prisma.stockMovement.findFirst({ where: { referenceId: d1.body.delivery.id } });
  assert.equal(mv.type, 'DELIVERY');
  assert.equal(mv.unitCost.toString(), '1.4567');
  assert.equal((await prisma.fuelProduct.findUnique({ where: { id: ctx.product.id } })).costPrice.toString(), '1.4567', 'last-cost method');
  assert.equal((await prisma.purchaseOrder.findUnique({ where: { id: ctx.po.id } })).status, 'PARTIALLY_RECEIVED');
  assert.equal((await m.post(`/api/deliveries/${d1.body.delivery.id}/confirm`).set(CSRF).send({})).status, 409, 'confirm once');
  assert.equal((await m.post(`/api/purchase-orders/${ctx.po.id}/cancel`).set(CSRF)).status, 409, 'cannot cancel with confirmed deliveries');

  const d2 = await m.post('/api/deliveries').set(CSRF).send({ purchaseOrderId: ctx.po.id, tankId: ctx.tank.id, quantityDelivered: '1020' });
  await m.post(`/api/deliveries/${d2.body.delivery.id}/confirm`).set(CSRF).send({});
  assert.equal((await prisma.purchaseOrder.findUnique({ where: { id: ctx.po.id } })).status, 'RECEIVED');
});

test('rejected deliveries never touch stock', needsDb, async () => {
  const m = ctx.agents.manager;
  const before = await level();
  const d = await m.post('/api/deliveries').set(CSRF).send({ supplierId: ctx.supplier.id, tankId: ctx.tank.id, quantityDelivered: '500', unitCost: '1.60' });
  assert.equal((await m.post(`/api/deliveries/${d.body.delivery.id}/reject`).set(CSRF).send({ reason: 'Water contamination found' })).status, 200);
  assert.equal((await m.post(`/api/deliveries/${d.body.delivery.id}/confirm`).set(CSRF).send({})).status, 409);
  assert.equal((await level()).toString(), before.toString());
});

test('accounts payable: supplier invoices and payments with balance checks', needsDb, async () => {
  const acc = ctx.agents.accountant;
  const inv = await acc.post('/api/supplier-invoices').set(CSRF).send({ supplierId: ctx.supplier.id, purchaseOrderId: ctx.po.id, invoiceNumber: `RG-${RUN}`, issueDate: '2026-01-10', dueDate: '2026-02-09', amount: '4370.10' });
  assert.equal(inv.status, 201);
  assert.equal((await acc.post('/api/supplier-invoices').set(CSRF).send({ supplierId: ctx.supplier.id, invoiceNumber: `RG-${RUN}`, issueDate: '2026-01-10', amount: '1' })).status, 409, 'invoice numbers are unique per supplier');
  assert.equal((await acc.post('/api/supplier-invoices').set(CSRF).send({ supplierId: ctx.supplier.id, invoiceNumber: `X-${RUN}`, issueDate: '2026-02-10', dueDate: '2026-01-01', amount: '1' })).status, 400, 'due before issue');

  const payInv = (body) => acc.post('/api/supplier-payments').set(CSRF).send({ supplierInvoiceId: inv.body.invoice.id, ...body });
  assert.equal((await payInv({ amount: '5000', method: 'CASH' })).status, 409, 'overpayment');
  assert.equal((await payInv({ amount: '100', method: 'BANK_TRANSFER' })).status, 400, 'bank needs a reference');
  assert.equal((await ctx.agents.cashier.post('/api/supplier-payments').set(CSRF).send({ supplierInvoiceId: inv.body.invoice.id, amount: '1', method: 'CASH' })).status, 403);
  assert.equal((await payInv({ amount: '2000', method: 'BANK_TRANSFER', reference: 'TRX-1' })).status, 201);
  assert.equal((await payInv({ amount: '2000', method: 'BANK_TRANSFER', reference: 'TRX-1' })).status, 409, 'duplicate entry guard');
  const sup = (await acc.get(`/api/suppliers/${ctx.supplier.id}`)).body.supplier;
  assert.equal(sup.outstanding, 2370.1);
  assert.equal((await prisma.supplierInvoice.findUnique({ where: { id: inv.body.invoice.id } })).status, 'PARTIALLY_PAID');
  assert.equal((await payInv({ amount: '2370.10', method: 'CASH' })).status, 201);
  assert.equal((await prisma.supplierInvoice.findUnique({ where: { id: inv.body.invoice.id } })).status, 'PAID');
});

test('expenses: two-person approval; only approved ones count', needsDb, async () => {
  const cats = (await ctx.agents.manager.get('/api/expense-categories')).body.categories;
  const util = cats.find((c) => c.type === 'UTILITY');
  const body = { categoryId: util.id, amount: '120.50', description: 'Generator diesel and electricity', expenseDate: '2026-03-05' };
  const e1 = await ctx.agents.manager.post('/api/expenses').set(CSRF).send(body);
  assert.equal(e1.status, 201);
  assert.equal(e1.body.expense.status, 'PENDING', 'managers record, accountants approve');
  assert.equal((await ctx.agents.manager.post(`/api/expenses/${e1.body.expense.id}/approve`).set(CSRF)).status, 403);
  const [a, b] = await Promise.all([
    ctx.agents.accountant.post(`/api/expenses/${e1.body.expense.id}/approve`).set(CSRF),
    ctx.agents.accountant.post(`/api/expenses/${e1.body.expense.id}/approve`).set(CSRF),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);

  const e2 = await ctx.agents.manager.post('/api/expenses').set(CSRF).send({ ...body, amount: '999', description: 'Rejected expense item' });
  await ctx.agents.accountant.post(`/api/expenses/${e2.body.expense.id}/reject`).set(CSRF);
  assert.equal((await ctx.agents.manager.patch(`/api/expenses/${e2.body.expense.id}`).set(CSRF).send({ amount: '1' })).status, 409, 'decided expenses are locked');

  const auto = await ctx.agents.admin.post('/api/expenses').set(CSRF).send({ ...body, stationId: ctx.station.id, amount: '79.50', description: 'Pump nozzle repair' });
  assert.equal(auto.body.expense.status, 'APPROVED', 'approvers record pre-approved');
  assert.equal((await ctx.agents.manager.post('/api/expenses').set(CSRF).send({ ...body, expenseDate: '2099-01-01' })).status, 400, 'no future dates');

  const list = (await ctx.agents.accountant.get('/api/expenses').query({ stationId: ctx.station.id, from: '2026-03-01', to: '2026-03-31' })).body;
  assert.equal(list.summary.approved, 200, '120.50 + 79.50; the rejected 999 is excluded');
});

test('employees: station managers manage their station; salaries hidden from non-HR viewers', needsDb, async () => {
  const e = await ctx.agents.manager.post('/api/employees').set(CSRF).send({ fullName: 'Hassan Ali', position: 'Pump attendant', salary: '350', hireDate: '2025-06-01' });
  assert.equal(e.status, 201);
  assert.equal(e.body.employee.stationId, ctx.station.id);
  assert.equal((await ctx.agents.cashier.get('/api/employees')).status, 403);
  assert.equal((await ctx.agents.otherManager.patch(`/api/employees/${e.body.employee.id}`).set(CSRF).send({ salary: '1' })).status, 403);
  const cats = (await ctx.agents.manager.get('/api/expense-categories')).body.categories;
  const otherStationEmp = await prisma.employee.create({ data: { employeeNo: `EMP-T${RUN}`, fullName: 'Elsewhere', position: 'x', stationId: (await prisma.station.findFirstOrThrow({ where: { code: 'STN-001' } })).id } });
  const bad = await ctx.agents.manager.post('/api/expenses').set(CSRF).send({ categoryId: cats[0].id, employeeId: otherStationEmp.id, amount: '10', description: 'Allowance test', expenseDate: '2026-03-05' });
  assert.equal(bad.status, 400);
  await prisma.employee.delete({ where: { id: otherStationEmp.id } });
});

test('profit & loss: exact arithmetic, cost of sales at the cost recorded when sold', needsDb, async () => {
  // product cost is 1.4567 after the deliveries; sell 100 L at 2.00 → revenue 200.00, cost 145.67
  const sale = await ctx.agents.cashier.post('/api/sales').set(CSRF).send({ idempotencyKey: key(), paymentMethod: 'CASH', items: [{ nozzleId: ctx.nozzle.id, quantity: '100' }] });
  assert.equal(sale.status, 201);
  // a later, more expensive delivery must not change the cost of that past sale
  const d = await ctx.agents.manager.post('/api/deliveries').set(CSRF).send({ supplierId: ctx.supplier.id, tankId: ctx.tank.id, quantityDelivered: '100', unitCost: '1.90' });
  await ctx.agents.manager.post(`/api/deliveries/${d.body.delivery.id}/confirm`).set(CSRF).send({});

  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const fin = await ctx.agents.accountant.get('/api/finance/summary').query({ from: ymd, to: ymd, stationId: ctx.station.id });
  assert.equal(fin.status, 200);
  const { pnl, cash } = fin.body;
  assert.equal(pnl.revenue, 200);
  assert.equal(pnl.costOfSales, 145.67);
  assert.equal(pnl.grossProfit, 54.33);
  assert.equal(pnl.netProfit, Math.round((54.33 - pnl.totalExpenses) * 100) / 100);
  assert.equal(cash.received, 200);
  assert.ok(fin.body.trend.length === 12);

  assert.equal((await ctx.agents.cashier.get('/api/finance/summary')).status, 403);
  assert.equal((await ctx.agents.manager.get('/api/finance/summary')).status, 403, 'station managers see the dashboard, not the books');
});

test('aging: overdue receivables and payables land in the right buckets', needsDb, async () => {
  const customer = await prisma.customer.create({ data: { customerNo: `CUS-U${RUN}-1`, name: 'Aging Co', creditAllowed: true, creditLimit: D('10000') } });
  const sale = await ctx.agents.cashier.post('/api/sales').set(CSRF).send({ idempotencyKey: key(), paymentMethod: 'CREDIT_ACCOUNT', customerId: customer.id, items: [{ nozzleId: ctx.nozzle.id, quantity: '50' }] });
  await prisma.invoice.update({ where: { id: sale.body.sale.invoice.id }, data: { dueDate: new Date(Date.now() - 45 * 86400000) } });
  await ctx.agents.accountant.post('/api/supplier-invoices').set(CSRF).send({ supplierId: ctx.supplier.id, invoiceNumber: `OLD-${RUN}`, issueDate: '2025-01-01', dueDate: '2025-02-01', amount: '300' });

  const { receivables, payables } = (await ctx.agents.accountant.get('/api/finance/summary').query({ stationId: ctx.station.id })).body;
  const cust = receivables.parties.find((p) => p.name === 'Aging Co');
  assert.equal(cust.total, 100);
  assert.equal(cust.overdue, 100);
  assert.ok(receivables.buckets['31-60'] >= 100);
  const sup = payables.parties.find((p) => p.name === ctx.supplier.name);
  assert.ok(sup.total >= 300 && payables.buckets['90+'] >= 300);
});

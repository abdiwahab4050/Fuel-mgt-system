/**
 * Reports, exports, fleet consumption and daily alerts — against a migrated +
 * seeded database. Builds its own station and data.
 */
import { ADMIN, CSRF, DEMO, loginAgent, needsDb, prisma } from './helpers.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createApp } from '../src/app.js';
import { applyStockMovement } from '../src/services/stock.js';
import { hashPassword } from '../src/auth/password.js';
import { runDailyAlerts } from '../src/services/alerts.js';

const app = createApp();
const D = (v) => new Prisma.Decimal(v);
const RUN = Date.now().toString(36).toUpperCase();
const ctx = { agents: {} };
let seq = 0;
const key = () => `rep-${RUN}-${++seq}`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function makeUser(roleKey, stationId) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const email = `${roleKey}-${RUN}-${Math.random().toString(36).slice(2, 6)}@test.fuelflow.local`.toLowerCase(); // the API stores emails lower-case
  const user = await prisma.user.create({ data: { email, name: `R ${roleKey}`, roleId: role.id, stationId, passwordHash: await hashPassword('testpass123') } });
  return { user, creds: { email, password: 'testpass123' } };
}

// raw binary response for supertest
const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };

before(async () => {
  if (needsDb.skip) return;
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
  ctx.station = await prisma.station.create({ data: { code: `TRP-${RUN}`, name: `Reports Test ${RUN}` } });
  ctx.product = await prisma.fuelProduct.create({ data: { code: `TR${RUN}`, name: 'Report Test Diesel', sellingPrice: D('2.00'), costPrice: D('1.50') } });
  ctx.tank = await prisma.tank.create({ data: { code: 'T1', stationId: ctx.station.id, productId: ctx.product.id, capacityLiters: D('5000'), minLevelLiters: D('0') } });
  ctx.tank2 = await prisma.tank.create({ data: { code: 'T2', stationId: ctx.station.id, productId: ctx.product.id, capacityLiters: D('5000') } });
  await prisma.$transaction((tx) => applyStockMovement(tx, { tankId: ctx.tank.id, type: 'OPENING', quantity: D('1000'), unitCost: D('1.50'), userId: admin.id }));
  const pump = await prisma.pump.create({ data: { code: 'P1', stationId: ctx.station.id } });
  ctx.nozzle = await prisma.nozzle.create({ data: { code: 'N1', pumpId: pump.id, tankId: ctx.tank.id } });
  for (const [name, role] of [['cashier', 'cashier'], ['manager', 'station_manager'], ['attendant', 'attendant']]) {
    ctx[name] = await makeUser(role, ctx.station.id);
    ctx.agents[name] = await loginAgent(request, app, ctx[name].creds);
  }
  ctx.accountant = await makeUser('accountant', null);
  ctx.agents.accountant = await loginAgent(request, app, ctx.accountant.creds);
  ctx.agents.admin = await loginAgent(request, app, ADMIN);

  // activity: 3 sales (10, 20, 30 L), a loss, a transfer
  for (const q of ['10', '20', '30']) {
    const r = await ctx.agents.cashier.post('/api/sales').set(CSRF).send({ idempotencyKey: key(), paymentMethod: 'CASH', items: [{ nozzleId: ctx.nozzle.id, quantity: q }] });
    assert.equal(r.status, 201);
  }
  await prisma.$transaction((tx) => applyStockMovement(tx, { tankId: ctx.tank.id, type: 'LOSS', quantity: D('-5'), userId: admin.id }));
  await ctx.agents.manager.post('/api/stock-transfers').set(CSRF).send({ fromTankId: ctx.tank.id, toTankId: ctx.tank2.id, quantity: '100' });
});

after(async () => {
  if (!ctx.station) return prisma.$disconnect();
  const sid = ctx.station.id;
  const users = (await prisma.user.findMany({ where: { email: { contains: `-${RUN}-`.toLowerCase() } }, select: { id: true } })).map((u) => u.id);
  const invoiceIds = (await prisma.invoice.findMany({ where: { stationId: sid }, select: { id: true } })).map((i) => i.id);
  await prisma.fuelConsumption.deleteMany({ where: { vehicle: { registrationNumber: { startsWith: `T${RUN}` } } } });
  await prisma.vehicle.deleteMany({ where: { registrationNumber: { startsWith: `T${RUN}` } } });
  await prisma.paymentTransaction.deleteMany({ where: { payment: { invoiceId: { in: invoiceIds } } } });
  await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  await prisma.saleItem.deleteMany({ where: { sale: { stationId: sid } } });
  await prisma.sale.deleteMany({ where: { stationId: sid } });
  await prisma.stockMovement.deleteMany({ where: { tank: { stationId: sid } } });
  await prisma.notification.deleteMany({ where: { OR: [{ stationId: sid }, { userId: { in: users } }] } });
  await prisma.nozzle.deleteMany({ where: { pump: { stationId: sid } } });
  await prisma.pump.deleteMany({ where: { stationId: sid } });
  await prisma.tank.deleteMany({ where: { stationId: sid } });
  await prisma.fuelProduct.delete({ where: { id: ctx.product.id } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
  await prisma.session.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.station.delete({ where: { id: sid } });
  await prisma.$disconnect();
});

test('report catalogue depends on role', needsDb, async () => {
  const keys = async (agent) => (await agent.get('/api/reports')).body.reports.map((r) => r.key);
  const admin = await keys(ctx.agents.admin);
  assert.equal(admin.length, 14);
  const manager = await keys(ctx.agents.manager);
  assert.ok(manager.includes('sales') && manager.includes('stock') && !manager.includes('profit-loss'));
  const accountant = await keys(ctx.agents.accountant);
  assert.ok(accountant.includes('profit-loss') && accountant.includes('outstanding-debt'));
  assert.deepEqual(await keys(ctx.agents.cashier), [], 'cashiers have no reports');
  assert.equal((await ctx.agents.manager.get('/api/reports/profit-loss')).status, 403);
  assert.equal((await ctx.agents.cashier.get('/api/reports/sales')).status, 403);
});

test('sales report: grouped rows add up to the totals', needsDb, async () => {
  for (const groupBy of ['day', 'week', 'month', 'year']) {
    const r = (await ctx.agents.manager.get('/api/reports/sales').query({ from: today(), to: today(), groupBy })).body;
    assert.equal(r.rows.length, 1, groupBy);
    assert.equal(r.totals.transactions, 3);
    assert.equal(r.totals.liters, 60);
    assert.equal(r.totals.revenue, 120);
  }
  assert.equal((await ctx.agents.manager.get('/api/reports/sales').query({ groupBy: 'hour' })).status, 400);
  const byProduct = (await ctx.agents.manager.get('/api/reports/sales-by-product').query({ from: today(), to: today() })).body;
  assert.equal(byProduct.rows.find((x) => x.product === 'Report Test Diesel').avgPrice, 2);
});

test('stock reconciliation: opening + movements = closing = tank level', needsDb, async () => {
  const r = (await ctx.agents.manager.get('/api/reports/stock').query({ from: today(), to: today() })).body;
  const t1 = r.rows.find((x) => x.tank === 'T1');
  assert.equal(t1.opening, 0);
  assert.equal(t1.received, 1000);
  assert.equal(t1.sold, 60);
  assert.equal(t1.losses, 5);
  assert.equal(t1.transfers, -100);
  assert.equal(t1.closing, 835);
  assert.equal(t1.opening + t1.received - t1.sold - t1.losses + t1.adjustments + t1.transfers, t1.closing);
  assert.equal((await prisma.tank.findUnique({ where: { id: ctx.tank.id } })).currentLiters.toNumber(), 835);

  // a period that ends yesterday: everything above happened after it, so closing = opening = 0
  const y = new Date(Date.now() - 86400000);
  const yd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  const past = (await ctx.agents.manager.get('/api/reports/stock').query({ from: yd, to: yd })).body.rows.find((x) => x.tank === 'T1');
  assert.equal(past.closing, 0);
});

test('Excel and CSV exports: valid files, audited', needsDb, async () => {
  const x = await ctx.agents.manager.get('/api/reports/sales').query({ from: today(), to: today(), format: 'xlsx' }).buffer(true).parse(binary);
  assert.equal(x.status, 200);
  assert.match(x.headers['content-type'], /spreadsheetml/);
  assert.match(x.headers['content-disposition'], /attachment; filename="sales-/);
  assert.equal(x.body.slice(0, 2).toString(), 'PK', 'zip container');
  const c = await ctx.agents.manager.get('/api/reports/sales').query({ from: today(), to: today(), format: 'csv' });
  assert.match(c.headers['content-type'], /text\/csv/);
  assert.ok(c.text.includes('"Total"'));
  assert.ok(await prisma.auditLog.count({ where: { userId: ctx.manager.user.id, action: 'report.export' } }) >= 2);
  assert.equal((await ctx.agents.manager.get('/api/reports/sales').query({ format: 'pdf' })).status, 404);
});

test('station managers only see their own station in reports', needsDb, async () => {
  const other = await loginAgent(request, app, DEMO.manager);
  const r = (await other.get('/api/reports/stock').query({ stationId: ctx.station.id })).body;
  assert.ok(!r.rows.some((x) => x.product === 'Report Test Diesel'));
});

test('employee performance credits the cashier', needsDb, async () => {
  const r = (await ctx.agents.manager.get('/api/reports/employee-performance').query({ from: today(), to: today() })).body;
  const me = r.rows.find((x) => x.employee === 'R cashier');
  assert.equal(me.sales, 3);
  assert.equal(me.liters, 60);
  assert.equal(me.revenue, 120);
});

test('fleet: odometer must increase; efficiency is fill-to-fill', needsDb, async () => {
  const m = ctx.agents.manager;
  const v = await m.post('/api/vehicles').set(CSRF).send({ registrationNumber: `t${RUN}-1`, name: 'Report Truck', type: 'Heavy Duty', driver: 'Sahra' });
  assert.equal(v.status, 201);
  assert.equal(v.body.vehicle.registrationNumber, `T${RUN}-1`, 'uppercased');
  const fill = (body) => m.post('/api/consumption').set(CSRF).send({ vehicleId: v.body.vehicle.id, productId: ctx.product.id, ...body });
  const f1 = await fill({ quantity: '50', odometerReading: '10000' });
  assert.equal(f1.status, 201);
  assert.equal(f1.body.record.mileage, null, 'first fill has no previous reading');
  assert.equal(f1.body.record.driver, 'Sahra', 'driver defaults to the vehicle driver');
  assert.equal((await fill({ quantity: '40', odometerReading: '9990' })).status, 409);
  const f2 = await fill({ quantity: '40', odometerReading: '10360' });
  assert.equal(f2.body.record.mileage, 9, '360 km / 40 L');
  await fill({ quantity: '100' }); // 190 L today → over the 150 L alert threshold
  const list = (await m.get('/api/consumption').query({ vehicleId: v.body.vehicle.id })).body;
  assert.equal(list.summary.liters, 190);
  assert.ok(list.highUseToday.some((h) => h.registrationNumber === `T${RUN}-1`));
  assert.equal((await ctx.agents.cashier.post('/api/consumption').set(CSRF).send({})).status, 403);
});

test('daily alerts run once per day and flag approvals waiting', needsDb, async () => {
  await ctx.agents.manager.post(`/api/tanks/${ctx.tank.id}/adjustments`).set(CSRF).send({ quantity: '-1', isLoss: true, reason: 'Alert test loss' });
  const first = await runDailyAlerts({ force: true });
  assert.equal(first.skipped, false);
  assert.ok(await prisma.notification.count({ where: { stationId: ctx.station.id, title: 'Waiting for approval' } }));
  assert.equal((await runDailyAlerts()).skipped, true, 'second run the same day is skipped');
  await prisma.stockAdjustment.deleteMany({ where: { tankId: ctx.tank.id } });
});

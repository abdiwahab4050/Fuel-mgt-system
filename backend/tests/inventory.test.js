/**
 * Inventory, stations, pumps, shifts and readings — against a migrated +
 * seeded database. Each run builds its own test station and removes it after.
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
const ctx = {};

async function makeStaff(roleKey, stationId) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const email = `${roleKey}-${RUN}-${Math.random().toString(36).slice(2, 6)}@test.fuelflow.local`.toLowerCase(); // the API stores emails lower-case
  await prisma.user.create({ data: { email, name: `T ${roleKey}`, roleId: role.id, stationId, passwordHash: await hashPassword('testpass123') } });
  return { email, password: 'testpass123' };
}

before(async () => {
  if (needsDb.skip) return;
  ctx.admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
  ctx.station = await prisma.station.create({ data: { code: `TST-${RUN}`, name: `Test Station ${RUN}` } });
  ctx.productA = await prisma.fuelProduct.create({ data: { code: `TA${RUN}`, name: 'Test Petrol', sellingPrice: D('2.00'), costPrice: D('1.50') } });
  ctx.productB = await prisma.fuelProduct.create({ data: { code: `TB${RUN}`, name: 'Test Diesel', sellingPrice: D('1.80'), costPrice: D('1.40') } });
  const tank = (code, productId, level, min = '100') => prisma.tank.create({ data: { code, stationId: ctx.station.id, productId, capacityLiters: D('10000'), currentLiters: D(0), minLevelLiters: D(min) } });
  ctx.t1 = await tank('T1', ctx.productA.id);
  ctx.t2 = await tank('T2', ctx.productA.id);
  ctx.t3 = await tank('T3', ctx.productB.id);
  for (const t of [ctx.t1, ctx.t2, ctx.t3]) {
    await prisma.$transaction((tx) => applyStockMovement(tx, { tankId: t.id, type: 'OPENING', quantity: D('1000'), userId: ctx.admin.id }));
  }
  ctx.pump = await prisma.pump.create({ data: { code: 'P1', stationId: ctx.station.id } });
  ctx.pump2 = await prisma.pump.create({ data: { code: 'P2', stationId: ctx.station.id } });
  ctx.nozzle = await prisma.nozzle.create({ data: { code: 'N1', pumpId: ctx.pump.id, tankId: ctx.t1.id, currentMeter: D('5000') } });
  ctx.manager = await makeStaff('station_manager', ctx.station.id);
  ctx.manager2 = await makeStaff('station_manager', ctx.station.id);
  ctx.attendant = await makeStaff('attendant', ctx.station.id);
});

after(async () => {
  if (!ctx.station) return prisma.$disconnect();
  const sid = ctx.station.id;
  const users = await prisma.user.findMany({ where: { email: { contains: `-${RUN}-`.toLowerCase() } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  await prisma.notification.deleteMany({ where: { OR: [{ stationId: sid }, { userId: { in: userIds } }] } });
  await prisma.pumpReading.deleteMany({ where: { nozzle: { pump: { stationId: sid } } } });
  await prisma.pumpAssignment.deleteMany({ where: { shift: { stationId: sid } } });
  await prisma.shift.deleteMany({ where: { stationId: sid } });
  await prisma.nozzle.deleteMany({ where: { pump: { stationId: sid } } });
  await prisma.pump.deleteMany({ where: { stationId: sid } });
  await prisma.stockAdjustment.deleteMany({ where: { tank: { stationId: sid } } });
  await prisma.tankStockRecord.deleteMany({ where: { tank: { stationId: sid } } });
  await prisma.stockMovement.deleteMany({ where: { tank: { stationId: sid } } });
  await prisma.tank.deleteMany({ where: { stationId: sid } });
  await prisma.fuelPriceHistory.deleteMany({ where: { product: { code: { endsWith: RUN } } } });
  await prisma.fuelProduct.deleteMany({ where: { code: { endsWith: RUN } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.station.delete({ where: { id: sid } });
  await prisma.$disconnect();
});

const level = async (tankId) => (await prisma.tank.findUnique({ where: { id: tankId } })).currentLiters;
const ledgerSum = async (tankId) => (await prisma.stockMovement.aggregate({ where: { tankId }, _sum: { quantity: true } }))._sum.quantity;

test('concurrent withdrawals never oversell a tank and the ledger matches the level', needsDb, async () => {
  // 1000 L in the tank; 15 concurrent withdrawals of 100 L → exactly 10 succeed
  const results = await Promise.allSettled(Array.from({ length: 15 }, () =>
    prisma.$transaction((tx) => applyStockMovement(tx, { tankId: ctx.t3.id, type: 'SALE', quantity: D('-100'), userId: ctx.admin.id }))));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 10);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 409));
  assert.equal((await level(ctx.t3.id)).toString(), '0');
  assert.equal((await ledgerSum(ctx.t3.id)).toString(), '0');
});

test('crossing the minimum level raises exactly one low-stock notification', needsDb, async () => {
  const count = () => prisma.notification.count({ where: { stationId: ctx.station.id, title: 'Low Stock Alert' } });
  const before = await count();
  // t3 crossed below 100 L during the previous test (1 alert); refill and cross again
  await prisma.$transaction((tx) => applyStockMovement(tx, { tankId: ctx.t3.id, type: 'DELIVERY', quantity: D('500'), userId: ctx.admin.id }));
  await prisma.$transaction((tx) => applyStockMovement(tx, { tankId: ctx.t3.id, type: 'SALE', quantity: D('-450'), userId: ctx.admin.id }));
  await prisma.$transaction((tx) => applyStockMovement(tx, { tankId: ctx.t3.id, type: 'SALE', quantity: D('-10'), userId: ctx.admin.id }));
  assert.equal(await count(), before + 1);
});

test('deliveries cannot overflow the tank', needsDb, async () => {
  await assert.rejects(
    prisma.$transaction((tx) => applyStockMovement(tx, { tankId: ctx.t1.id, type: 'DELIVERY', quantity: D('9500'), userId: ctx.admin.id })),
    (e) => e.status === 409 && /overflow/.test(e.message),
  );
});

test('product price changes are versioned and audited', needsDb, async () => {
  const admin = await loginAgent(request, app, ADMIN);
  const res = await admin.patch(`/api/products/${ctx.productA.id}`).set(CSRF).send({ sellingPrice: '2.10' });
  assert.equal(res.status, 200);
  assert.equal(res.body.product.sellingPrice, 2.1, 'decimals serialize as numbers');
  const history = await prisma.fuelPriceHistory.findMany({ where: { productId: ctx.productA.id } });
  assert.equal(history.length, 1);
  assert.equal(await prisma.auditLog.count({ where: { entityId: ctx.productA.id, action: 'product.price_change' } }), 1);
  assert.equal((await admin.patch(`/api/products/${ctx.productA.id}`).set(CSRF).send({ sellingPrice: '1.23456' })).status, 400, 'max 4 decimals');
});

test('tank level cannot be edited directly; capacity cannot drop below stock', needsDb, async () => {
  const mgr = await loginAgent(request, app, ctx.manager);
  const res = await mgr.patch(`/api/tanks/${ctx.t1.id}`).set(CSRF).send({ currentLiters: 99999, capacityLiters: '500' });
  assert.equal(res.status, 400);
  const ok = await mgr.patch(`/api/tanks/${ctx.t1.id}`).set(CSRF).send({ currentLiters: 99999, minLevelLiters: '200' });
  assert.equal(ok.status, 200);
  assert.equal((await level(ctx.t1.id)).toString(), '1000', 'currentLiters ignored');
});

test('adjustments need a second person to approve, and only once', needsDb, async () => {
  const mgr = await loginAgent(request, app, ctx.manager);
  const mgr2 = await loginAgent(request, app, ctx.manager2);
  const before = await level(ctx.t2.id);

  const bad = await mgr.post(`/api/tanks/${ctx.t2.id}/adjustments`).set(CSRF).send({ quantity: '25', isLoss: true, reason: 'leak found' });
  assert.equal(bad.status, 400, 'a loss must be negative');

  const created = await mgr.post(`/api/tanks/${ctx.t2.id}/adjustments`).set(CSRF).send({ quantity: '-25.5', isLoss: true, reason: 'Evaporation, measured by dip' });
  assert.equal(created.status, 201);
  const id = created.body.adjustment.id;
  assert.equal((await level(ctx.t2.id)).toString(), before.toString(), 'pending adjustments do not move stock');

  assert.equal((await mgr.post(`/api/stock-adjustments/${id}/approve`).set(CSRF)).status, 403, 'no self-approval');
  const attendant = await loginAgent(request, app, ctx.attendant);
  assert.equal((await attendant.post(`/api/stock-adjustments/${id}/approve`).set(CSRF)).status, 403);

  const [a, b] = await Promise.all([
    mgr2.post(`/api/stock-adjustments/${id}/approve`).set(CSRF),
    mgr2.post(`/api/stock-adjustments/${id}/approve`).set(CSRF),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], 'concurrent double approval applies once');
  assert.equal((await level(ctx.t2.id)).toString(), before.minus('25.5').toString());
  const mv = await prisma.stockMovement.findFirst({ where: { referenceId: id } });
  assert.equal(mv.type, 'LOSS');
});

test('transfers move stock atomically between same-product tanks only', needsDb, async () => {
  const mgr = await loginAgent(request, app, ctx.manager);
  const [l1, l2] = [await level(ctx.t1.id), await level(ctx.t2.id)];
  assert.equal((await mgr.post('/api/stock-transfers').set(CSRF).send({ fromTankId: ctx.t1.id, toTankId: ctx.t3.id, quantity: '10' })).status, 400, 'different product');
  assert.equal((await mgr.post('/api/stock-transfers').set(CSRF).send({ fromTankId: ctx.t1.id, toTankId: ctx.t2.id, quantity: '50000' })).status, 409, 'more than available');
  assert.equal((await level(ctx.t1.id)).toString(), l1.toString(), 'failed transfer changed nothing');

  const ok = await mgr.post('/api/stock-transfers').set(CSRF).send({ fromTankId: ctx.t1.id, toTankId: ctx.t2.id, quantity: '120.250' });
  assert.equal(ok.status, 201);
  assert.equal((await level(ctx.t1.id)).toString(), l1.minus('120.25').toString());
  assert.equal((await level(ctx.t2.id)).toString(), l2.plus('120.25').toString());
  for (const t of [ctx.t1, ctx.t2]) assert.equal((await ledgerSum(t.id)).toString(), (await level(t.id)).toString());
});

test('closing dip records book level and variance', needsDb, async () => {
  const mgr = await loginAgent(request, app, ctx.manager);
  const day = '2026-03-15';
  assert.equal((await mgr.post(`/api/tanks/${ctx.t1.id}/stock-records`).set(CSRF).send({ recordDate: day, closingLiters: '800' })).status, 400, 'opening first');
  assert.equal((await mgr.post(`/api/tanks/${ctx.t1.id}/stock-records`).set(CSRF).send({ recordDate: day, openingLiters: '900' })).status, 200);
  const book = await level(ctx.t1.id);
  const res = await mgr.post(`/api/tanks/${ctx.t1.id}/stock-records`).set(CSRF).send({ recordDate: day, closingLiters: '700' });
  assert.equal(res.status, 200);
  assert.equal(res.body.record.bookLiters, book.toNumber());
  assert.equal(res.body.record.varianceLiters, D('700').minus(book).toNumber());
  assert.ok(await prisma.notification.count({ where: { stationId: ctx.station.id, title: 'Stock discrepancy' } }));
});

test('station-bound staff cannot touch another station', needsDb, async () => {
  const seededManager = await loginAgent(request, app, DEMO.manager);
  assert.equal((await seededManager.post(`/api/tanks/${ctx.t1.id}/adjustments`).set(CSRF).send({ quantity: '-1', reason: 'cross-station test' })).status, 403);
  const { tanks } = (await seededManager.get('/api/tanks')).body;
  assert.ok(tanks.every((t) => t.stationId !== ctx.station.id));
});

test('shifts: a pump can be assigned to only one open shift', needsDb, async () => {
  const mgr = await loginAgent(request, app, ctx.manager);
  const att = await prisma.user.findUniqueOrThrow({ where: { email: ctx.attendant.email } });
  const mgr2 = await prisma.user.findUniqueOrThrow({ where: { email: ctx.manager2.email } });
  const s1 = await mgr.post('/api/shifts').set(CSRF).send({ userId: att.id, pumpIds: [ctx.pump.id] });
  assert.equal(s1.status, 201);
  ctx.shiftId = s1.body.shift.id;
  assert.equal((await mgr.post('/api/shifts').set(CSRF).send({ userId: att.id, pumpIds: [ctx.pump2.id] })).status, 409, 'one open shift per person');
  assert.equal((await mgr.post('/api/shifts').set(CSRF).send({ userId: mgr2.id, pumpIds: [ctx.pump.id] })).status, 409, 'pump already assigned');
});

test('pump readings: assignment, forward-only meters, variance and reconciliation', needsDb, async () => {
  const att = await loginAgent(request, app, ctx.attendant);
  const mgr2 = await loginAgent(request, app, ctx.manager2);

  // attendant is assigned P1 (previous test) — but not P2
  const n2 = await prisma.nozzle.create({ data: { code: 'N1', pumpId: ctx.pump2.id, tankId: ctx.t1.id } });
  assert.equal((await att.post('/api/pump-readings').set(CSRF).send({ nozzleId: n2.id, openingMeter: '0' })).status, 403);

  assert.equal((await att.post('/api/pump-readings').set(CSRF).send({ nozzleId: ctx.nozzle.id, openingMeter: '4999' })).status, 409, 'meter cannot go backwards');
  const opened = await att.post('/api/pump-readings').set(CSRF).send({ nozzleId: ctx.nozzle.id, openingMeter: '5000' });
  assert.equal(opened.status, 201);
  assert.equal(opened.body.reading.shiftId, ctx.shiftId);
  assert.equal((await att.post('/api/pump-readings').set(CSRF).send({ nozzleId: ctx.nozzle.id, openingMeter: '5000' })).status, 409, 'one open reading per nozzle');

  const id = opened.body.reading.id;
  assert.equal((await att.post(`/api/pump-readings/${id}/close`).set(CSRF).send({ closingMeter: '4000' })).status, 400);
  const closed = await att.post(`/api/pump-readings/${id}/close`).set(CSRF).send({ closingMeter: '5150.5' });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.reading.meterLiters, 150.5);
  assert.equal(closed.body.reading.recordedLiters, 0, 'no sales recorded yet');
  assert.equal(closed.body.reading.varianceLiters, 150.5);
  assert.equal((await prisma.nozzle.findUnique({ where: { id: ctx.nozzle.id } })).currentMeter.toString(), '5150.5');

  assert.equal((await att.post(`/api/pump-readings/${id}/reconcile`).set(CSRF).send({ notes: 'x' })).status, 403, 'attendants cannot reconcile');
  assert.equal((await mgr2.post(`/api/pump-readings/${id}/reconcile`).set(CSRF).send({})).status, 400, 'variance needs an explanation');
  assert.equal((await mgr2.post(`/api/pump-readings/${id}/reconcile`).set(CSRF).send({ notes: 'Sales not yet recorded in system (pre-Phase 5)' })).status, 200);

  // shift can now close, and becomes RECONCILED since all its readings are
  assert.equal((await att.post(`/api/shifts/${ctx.shiftId}/close`).set(CSRF)).status, 200);
  const shift = await prisma.shift.findUnique({ where: { id: ctx.shiftId } });
  assert.equal(shift.status, 'CLOSED');
});

test('notifications: station staff see station alerts and can mark them read', needsDb, async () => {
  const mgr = await loginAgent(request, app, ctx.manager);
  const before = (await mgr.get('/api/notifications')).body;
  assert.ok(before.notifications.some((n) => n.title === 'Low Stock Alert'));
  assert.ok(before.unread > 0);
  await mgr.post('/api/notifications/read-all').set(CSRF);
  assert.equal((await mgr.get('/api/notifications')).body.unread, 0);

  const seededManager = await loginAgent(request, app, DEMO.manager);
  const other = (await seededManager.get('/api/notifications')).body.notifications;
  assert.ok(!other.some((n) => /Test (Petrol|Diesel)/.test(n.message)), 'other stations do not see them');
});

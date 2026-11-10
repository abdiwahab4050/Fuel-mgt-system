/**
 * /api — fuel products, tanks, stock ledger, adjustments, transfers, daily dips.
 *
 *  - Stock levels change only through services/stock.js (locked, ledgered).
 *  - Adjustments and losses are requested, then approved by a different person
 *    holding inventory.adjust.approve (super admins may approve their own).
 *  - Daily stock records compare a physical dip against the book level and
 *    raise a notification when the variance exceeds the tolerance.
 */
import express from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { assertStationAccess, can, requirePermission, stationScope } from '../middleware/auth.js';
import { applyStockMovement, lockTank } from '../services/stock.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { code, dayString, id, liters, optionalText, paging, unitPrice } from '../lib/validation.js';
import { parseDay, startOfDay } from '../lib/dates.js';

const router = express.Router();
const D = (v) => new Prisma.Decimal(v);

// Physical vs book difference (liters, and % of book) above which a dip raises an alert
export const DIP_TOLERANCE_LITERS = 50;
export const DIP_TOLERANCE_PERCENT = 0.5;

// ─── Products ────────────────────────────────────────────────

router.get('/products', requirePermission('inventory.view', 'sales.create', 'purchases.view'), async (req, res) => {
  const products = await prisma.fuelProduct.findMany({
    where: req.query.all === 'true' ? {} : { status: 'ACTIVE' },
    orderBy: { name: 'asc' },
  });
  res.json({ products });
});

const productBody = z.object({
  code,
  name: z.string().trim().min(2).max(80),
  unit: z.string().trim().min(1).max(10).default('L'),
  sellingPrice: unitPrice({ positive: true }),
  costPrice: unitPrice().default(0),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

router.post('/products', requirePermission('inventory.manage'), async (req, res) => {
  const body = productBody.parse(req.body);
  const product = await prisma.$transaction(async (tx) => {
    const p = await tx.fuelProduct.create({ data: body });
    await tx.fuelPriceHistory.create({ data: { productId: p.id, sellingPrice: p.sellingPrice, costPrice: p.costPrice, changedById: req.user.id } });
    await audit(tx, req, { action: 'product.create', entityType: 'FuelProduct', entityId: p.id, details: `Added ${p.name} at ${p.sellingPrice}/L`, after: body });
    return p;
  });
  res.status(201).json({ product });
});

router.patch('/products/:id', requirePermission('inventory.manage'), async (req, res) => {
  const body = productBody.partial().parse(req.body);
  const existing = await prisma.fuelProduct.findUnique({ where: { id: req.params.id } });
  if (!existing) throw notFound('Product not found');

  const product = await prisma.$transaction(async (tx) => {
    const p = await tx.fuelProduct.update({ where: { id: existing.id }, data: body });
    const priceChanged = !p.sellingPrice.equals(existing.sellingPrice) || !p.costPrice.equals(existing.costPrice);
    if (priceChanged) {
      await tx.fuelPriceHistory.create({ data: { productId: p.id, sellingPrice: p.sellingPrice, costPrice: p.costPrice, changedById: req.user.id } });
    }
    await audit(tx, req, {
      action: priceChanged ? 'product.price_change' : 'product.update', entityType: 'FuelProduct', entityId: p.id,
      details: priceChanged ? `${p.name}: selling ${existing.sellingPrice} → ${p.sellingPrice}, cost ${existing.costPrice} → ${p.costPrice}` : `Updated ${p.name}`,
      before: { name: existing.name, sellingPrice: existing.sellingPrice, costPrice: existing.costPrice, status: existing.status },
      after: { name: p.name, sellingPrice: p.sellingPrice, costPrice: p.costPrice, status: p.status },
    });
    return p;
  });
  res.json({ product });
});

router.get('/products/:id/price-history', requirePermission('inventory.view'), async (req, res) => {
  const history = await prisma.fuelPriceHistory.findMany({
    where: { productId: req.params.id },
    orderBy: { effectiveAt: 'desc' },
    take: 50,
    include: { changedBy: { select: { name: true } } },
  });
  res.json({ history });
});

// ─── Tanks ───────────────────────────────────────────────────

const tankInclude = {
  product: { select: { id: true, code: true, name: true, sellingPrice: true } },
  station: { select: { id: true, code: true, name: true } },
  _count: { select: { nozzles: true } },
};

router.get('/tanks', requirePermission('inventory.view', 'pumps.view', 'sales.create'), async (req, res) => {
  const stationId = stationScope(req);
  const tanks = await prisma.tank.findMany({
    where: { ...(stationId ? { stationId } : {}), ...(req.query.productId ? { productId: String(req.query.productId) } : {}) },
    include: tankInclude,
    orderBy: [{ station: { code: 'asc' } }, { code: 'asc' }],
  });
  res.json({
    tanks: tanks.map((t) => ({
      ...t,
      percent: t.capacityLiters.isZero() ? 0 : Math.round(t.currentLiters.div(t.capacityLiters).times(100).toNumber()),
      low: t.currentLiters.lte(t.minLevelLiters),
    })),
  });
});

const tankBody = z.object({
  code,
  name: optionalText(80),
  stationId: id,
  productId: id,
  capacityLiters: liters({ positive: true }),
  minLevelLiters: liters().default(0),
  openingLiters: liters().default(0),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'OUT_OF_SERVICE']).default('ACTIVE'),
});

router.post('/tanks', requirePermission('inventory.manage'), async (req, res) => {
  const { openingLiters, ...body } = tankBody.parse(req.body);
  assertStationAccess(req, body.stationId);
  if (openingLiters.gt(body.capacityLiters)) throw badRequest('Opening stock cannot exceed tank capacity');
  if (body.minLevelLiters.gt(body.capacityLiters)) throw badRequest('Minimum level cannot exceed tank capacity');

  const tank = await prisma.$transaction(async (tx) => {
    const t = await tx.tank.create({ data: { ...body, currentLiters: 0 } });
    if (openingLiters.gt(0)) {
      await applyStockMovement(tx, { tankId: t.id, type: 'OPENING', quantity: openingLiters, userId: req.user.id, note: 'Opening stock', referenceType: 'Tank', referenceId: t.id });
    }
    await audit(tx, req, { action: 'tank.create', entityType: 'Tank', entityId: t.id, details: `Added tank ${t.code} (${body.capacityLiters} L) with ${openingLiters} L opening stock` });
    return tx.tank.findUnique({ where: { id: t.id }, include: tankInclude });
  });
  res.status(201).json({ tank });
});

// Level is NOT editable here — use adjustments, deliveries, or sales
router.patch('/tanks/:id', requirePermission('inventory.manage'), async (req, res) => {
  const body = tankBody.omit({ openingLiters: true, stationId: true, productId: true }).partial().parse(req.body);
  const tank = await prisma.$transaction(async (tx) => {
    const current = await lockTank(tx, req.params.id);
    assertStationAccess(req, current.stationId);
    const capacity = body.capacityLiters ?? current.capacityLiters;
    if (capacity.lt(current.currentLiters)) throw badRequest(`Capacity cannot be below the current level (${current.currentLiters} L)`);
    if ((body.minLevelLiters ?? current.minLevelLiters).gt(capacity)) throw badRequest('Minimum level cannot exceed capacity');
    const t = await tx.tank.update({ where: { id: current.id }, data: body, include: tankInclude });
    await audit(tx, req, { action: 'tank.update', entityType: 'Tank', entityId: t.id, details: `Updated tank ${t.code}`, after: body });
    return t;
  });
  res.json({ tank });
});

// ─── Stock ledger ────────────────────────────────────────────

router.get('/stock-movements', requirePermission('inventory.view'), async (req, res) => {
  const stationId = stationScope(req);
  const { skip, take, page, pageSize } = paging(req.query);
  const where = {
    ...(req.query.tankId ? { tankId: String(req.query.tankId) } : {}),
    ...(req.query.type ? { type: String(req.query.type) } : {}),
    ...(stationId ? { tank: { stationId } } : {}),
  };
  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where, skip, take, orderBy: { createdAt: 'desc' },
      include: { tank: { select: { code: true, product: { select: { name: true } } } }, createdBy: { select: { name: true } } },
    }),
    prisma.stockMovement.count({ where }),
  ]);
  res.json({ movements, total, page, pageSize });
});

// ─── Adjustments & losses (two-person approval) ─────────────

router.get('/stock-adjustments', requirePermission('inventory.view', 'inventory.adjust.request'), async (req, res) => {
  const stationId = stationScope(req);
  const adjustments = await prisma.stockAdjustment.findMany({
    where: { ...(req.query.status ? { status: String(req.query.status) } : {}), ...(stationId ? { tank: { stationId } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      tank: { select: { code: true, currentLiters: true, product: { select: { name: true } } } },
      requestedBy: { select: { id: true, name: true } },
      approvedBy: { select: { name: true } },
    },
  });
  res.json({ adjustments });
});

router.post('/tanks/:id/adjustments', requirePermission('inventory.adjust.request'), async (req, res) => {
  const body = z.object({
    quantity: liters({ allowNegative: true }),
    isLoss: z.boolean().default(false),
    reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500),
  }).parse(req.body);
  if (body.quantity.isZero()) throw badRequest('Quantity cannot be zero');
  if (body.isLoss && body.quantity.isPositive()) throw badRequest('A loss must be a negative quantity');

  const tank = await prisma.tank.findUnique({ where: { id: req.params.id } });
  if (!tank) throw notFound('Tank not found');
  assertStationAccess(req, tank.stationId);

  const adjustment = await prisma.$transaction(async (tx) => {
    const a = await tx.stockAdjustment.create({ data: { tankId: tank.id, quantity: body.quantity, isLoss: body.isLoss, reason: body.reason, requestedById: req.user.id } });
    await audit(tx, req, { action: 'stock.adjustment_requested', entityType: 'StockAdjustment', entityId: a.id, details: `${body.isLoss ? 'Loss' : 'Adjustment'} of ${body.quantity} L on tank ${tank.code}: ${body.reason}` });
    await notify(tx, { type: 'INFO', title: 'Adjustment awaiting approval', message: `${body.quantity} L on tank ${tank.code} — ${body.reason}`, link: '#inventory', stationId: tank.stationId });
    return a;
  });
  res.status(201).json({ adjustment });
});

const decideAdjustment = (approve) => async (req, res) => {
  const { note } = z.object({ note: optionalText(500) }).parse(req.body ?? {});

  const adjustment = await prisma.$transaction(async (tx) => {
    // lock the request row so it cannot be decided twice
    const rows = await tx.$queryRaw`SELECT "id" FROM "StockAdjustment" WHERE "id" = ${req.params.id} FOR UPDATE`;
    if (!rows.length) throw notFound('Adjustment not found');
    const a = await tx.stockAdjustment.findUnique({ where: { id: req.params.id }, include: { tank: true } });
    if (a.status !== 'PENDING') throw conflict(`This adjustment was already ${a.status.toLowerCase()}`);
    assertStationAccess(req, a.tank.stationId);
    if (a.requestedById === req.user.id && req.user.role !== 'super_admin') {
      throw forbidden('You cannot approve or reject your own adjustment request');
    }

    if (approve) {
      await applyStockMovement(tx, {
        tankId: a.tankId, type: a.isLoss ? 'LOSS' : 'ADJUSTMENT', quantity: a.quantity, userId: req.user.id,
        referenceType: 'StockAdjustment', referenceId: a.id, note: a.reason, allowNegative: false,
      });
    }
    const updated = await tx.stockAdjustment.update({
      where: { id: a.id },
      data: { status: approve ? 'APPROVED' : 'REJECTED', approvedById: req.user.id, decidedAt: new Date() },
    });
    await audit(tx, req, {
      action: approve ? 'stock.adjustment_approved' : 'stock.adjustment_rejected', entityType: 'StockAdjustment', entityId: a.id,
      details: `${approve ? 'Approved' : 'Rejected'} ${a.quantity} L on tank ${a.tank.code}${note ? ` — ${note}` : ''}`,
    });
    await notify(tx, { type: approve ? 'SUCCESS' : 'WARNING', title: `Adjustment ${approve ? 'approved' : 'rejected'}`, message: `${a.quantity} L on tank ${a.tank.code}`, userId: a.requestedById, link: '#inventory' });
    return updated;
  });
  res.json({ adjustment });
};

router.post('/stock-adjustments/:id/approve', requirePermission('inventory.adjust.approve'), decideAdjustment(true));
router.post('/stock-adjustments/:id/reject', requirePermission('inventory.adjust.approve'), decideAdjustment(false));

// ─── Transfers ───────────────────────────────────────────────

router.post('/stock-transfers', requirePermission('inventory.manage'), async (req, res) => {
  const body = z.object({ fromTankId: id, toTankId: id, quantity: liters({ positive: true }), note: optionalText(500) }).parse(req.body);
  if (body.fromTankId === body.toTankId) throw badRequest('Choose two different tanks');

  const result = await prisma.$transaction(async (tx) => {
    // lock in a fixed order so two opposite transfers cannot deadlock
    const [a, b] = [body.fromTankId, body.toTankId].sort();
    const locked = { [a]: await lockTank(tx, a), [b]: await lockTank(tx, b) };
    const from = locked[body.fromTankId];
    const to = locked[body.toTankId];
    assertStationAccess(req, from.stationId);
    assertStationAccess(req, to.stationId);
    if (from.productId !== to.productId) throw badRequest('Fuel can only be transferred between tanks holding the same product');

    const ref = `TRF-${Date.now()}`;
    const out = await applyStockMovement(tx, { tankId: from.id, type: 'TRANSFER_OUT', quantity: body.quantity.negated(), userId: req.user.id, referenceType: 'Transfer', referenceId: ref, note: body.note ?? `To tank ${to.code}` });
    const into = await applyStockMovement(tx, { tankId: to.id, type: 'TRANSFER_IN', quantity: body.quantity, userId: req.user.id, referenceType: 'Transfer', referenceId: ref, note: body.note ?? `From tank ${from.code}` });
    await audit(tx, req, { action: 'stock.transfer', entityType: 'Transfer', entityId: ref, details: `Moved ${body.quantity} L from tank ${from.code} to tank ${to.code}` });
    return { reference: ref, from: { tankId: from.id, after: out.after }, to: { tankId: to.id, after: into.after } };
  });
  res.status(201).json(result);
});

// ─── Daily opening / closing stock (physical dips) ──────────

router.get('/tank-stock-records', requirePermission('inventory.view', 'pumps.readings.record'), async (req, res) => {
  const stationId = stationScope(req);
  const date = req.query.date ? parseDay(String(req.query.date), 'date') : startOfDay();
  const records = await prisma.tankStockRecord.findMany({
    where: { recordDate: date, ...(stationId ? { tank: { stationId } } : {}) },
    include: { tank: { select: { code: true, product: { select: { name: true } } } }, recordedBy: { select: { name: true } } },
  });
  res.json({ date: req.query.date ?? null, records });
});

router.post('/tanks/:id/stock-records', requirePermission('inventory.manage', 'pumps.readings.record'), async (req, res) => {
  const body = z.object({
    recordDate: dayString,
    openingLiters: liters().optional(),
    closingLiters: liters().optional(),
  }).refine((b) => b.openingLiters || b.closingLiters, 'Enter an opening or closing dip').parse(req.body);
  const recordDate = parseDay(body.recordDate, 'recordDate');

  const record = await prisma.$transaction(async (tx) => {
    const tank = await lockTank(tx, req.params.id);
    assertStationAccess(req, tank.stationId);
    if (body.openingLiters?.gt(tank.capacityLiters) || body.closingLiters?.gt(tank.capacityLiters)) {
      throw badRequest(`Dip cannot exceed tank capacity (${tank.capacityLiters} L)`);
    }
    const existing = await tx.tankStockRecord.findUnique({ where: { tankId_recordDate: { tankId: tank.id, recordDate } } });
    if (!existing && body.openingLiters === undefined) throw badRequest('Record the opening dip before the closing dip');

    const data = { recordedById: req.user.id };
    if (body.openingLiters !== undefined) data.openingLiters = body.openingLiters;
    if (body.closingLiters !== undefined) {
      data.closingLiters = body.closingLiters;
      data.bookLiters = tank.currentLiters;
      data.varianceLiters = body.closingLiters.minus(tank.currentLiters);
    }
    const r = existing
      ? await tx.tankStockRecord.update({ where: { id: existing.id }, data })
      : await tx.tankStockRecord.create({ data: { ...data, tankId: tank.id, recordDate } });

    // SECTION: discrepancy alert
    if (data.varianceLiters) {
      const v = data.varianceLiters.abs();
      const pct = tank.currentLiters.isZero() ? D(100) : v.div(tank.currentLiters).times(100);
      if (v.gt(DIP_TOLERANCE_LITERS) && pct.gt(DIP_TOLERANCE_PERCENT)) {
        await notify(tx, {
          type: 'DANGER', title: 'Stock discrepancy',
          message: `Tank ${tank.code}: physical ${body.closingLiters} L vs book ${tank.currentLiters} L (${data.varianceLiters.isNegative() ? '' : '+'}${data.varianceLiters} L)`,
          link: '#inventory', stationId: tank.stationId,
        });
      }
    }
    await audit(tx, req, {
      action: 'stock.dip_recorded', entityType: 'TankStockRecord', entityId: r.id,
      details: `Tank ${tank.code} ${body.recordDate}: ${body.openingLiters !== undefined ? `opening ${body.openingLiters} L ` : ''}${body.closingLiters !== undefined ? `closing ${body.closingLiters} L (book ${tank.currentLiters} L)` : ''}`.trim(),
    });
    return r;
  });
  res.json({ record });
});

// ─── Inventory report ────────────────────────────────────────

router.get('/reports/inventory', requirePermission('inventory.view', 'reports.view'), async (req, res) => {
  const stationId = stationScope(req);
  const tanks = await prisma.tank.findMany({
    where: stationId ? { stationId } : {},
    include: { product: { select: { name: true, costPrice: true, sellingPrice: true } }, station: { select: { name: true } } },
    orderBy: [{ stationId: 'asc' }, { code: 'asc' }],
  });
  const movementTotals = await prisma.stockMovement.groupBy({
    by: ['tankId', 'type'],
    where: { tankId: { in: tanks.map((t) => t.id) } },
    _sum: { quantity: true },
  });
  const byTank = {};
  for (const m of movementTotals) (byTank[m.tankId] ||= {})[m.type] = m._sum.quantity;

  const rows = tanks.map((t) => ({
    tankId: t.id, tank: t.code, station: t.station.name, product: t.product.name,
    capacity: t.capacityLiters, current: t.currentLiters, minLevel: t.minLevelLiters, low: t.currentLiters.lte(t.minLevelLiters),
    costValue: t.currentLiters.times(t.product.costPrice).toDecimalPlaces(2),
    retailValue: t.currentLiters.times(t.product.sellingPrice).toDecimalPlaces(2),
    movements: byTank[t.id] ?? {},
  }));
  res.json({ rows, totals: {
    liters: rows.reduce((s, r) => s.plus(r.current), D(0)),
    costValue: rows.reduce((s, r) => s.plus(r.costValue), D(0)),
    retailValue: rows.reduce((s, r) => s.plus(r.retailValue), D(0)),
  } });
});

export default router;

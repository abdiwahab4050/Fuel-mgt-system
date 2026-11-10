/**
 * /api — stations, pumps, nozzles, shifts and pump meter readings.
 *
 * Meter rules:
 *  - A nozzle's meter only moves forward: a new opening reading must be ≥ the
 *    last closing (Nozzle.currentMeter), and closing ≥ opening.
 *  - One open reading per nozzle at a time.
 *  - Staff without pumps.manage may only record readings on pumps assigned to
 *    their own open shift.
 *  - Closing a reading compares meter liters with liters recorded as sales on
 *    that nozzle during the reading; the difference is the variance that a
 *    manager reconciles.
 */
import express from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { assertStationAccess, can, requirePermission, stationScope } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { code, dayString, id, liters, optionalText } from '../lib/validation.js';
import { addDays, parseDay, startOfDay } from '../lib/dates.js';

const router = express.Router();
const D = (v) => new Prisma.Decimal(v);

// Meter-vs-recorded difference that triggers a notification on close
export const PUMP_VARIANCE_ALERT_LITERS = 5;

const equipmentStatus = z.enum(['ACTIVE', 'MAINTENANCE', 'OUT_OF_SERVICE']);

// ─── Stations ────────────────────────────────────────────────

router.get('/stations', requirePermission('stations.view', 'users.manage', 'dashboard.view', 'pumps.view'), async (req, res) => {
  const stationId = stationScope(req);
  const stations = await prisma.station.findMany({
    where: stationId ? { id: stationId } : {},
    include: { _count: { select: { tanks: true, pumps: true, users: true } } },
    orderBy: { code: 'asc' },
  });
  res.json({ stations });
});

const stationBody = z.object({
  code,
  name: z.string().trim().min(2).max(100),
  address: optionalText(200),
  phone: optionalText(30),
  email: z.string().trim().email().optional().nullable().or(z.literal('')).transform((v) => v || null),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

router.post('/stations', requirePermission('stations.manage'), async (req, res) => {
  const body = stationBody.parse(req.body);
  const station = await prisma.$transaction(async (tx) => {
    const s = await tx.station.create({ data: body });
    await audit(tx, req, { action: 'station.create', entityType: 'Station', entityId: s.id, details: `Added station ${s.code} — ${s.name}` });
    return s;
  });
  res.status(201).json({ station });
});

router.patch('/stations/:id', requirePermission('stations.manage'), async (req, res) => {
  const body = stationBody.partial().parse(req.body);
  const station = await prisma.$transaction(async (tx) => {
    const s = await tx.station.update({ where: { id: req.params.id }, data: body });
    await audit(tx, req, { action: 'station.update', entityType: 'Station', entityId: s.id, details: `Updated station ${s.code}`, after: body });
    return s;
  });
  res.json({ station });
});

// ─── Pumps & nozzles ─────────────────────────────────────────

router.get('/pumps', requirePermission('pumps.view', 'sales.create'), async (req, res) => {
  const stationId = stationScope(req);
  const pumps = await prisma.pump.findMany({
    where: stationId ? { stationId } : {},
    orderBy: [{ station: { code: 'asc' } }, { code: 'asc' }],
    include: {
      station: { select: { id: true, code: true, name: true } },
      nozzles: {
        orderBy: { code: 'asc' },
        include: {
          tank: { select: { id: true, code: true, currentLiters: true, product: { select: { id: true, code: true, name: true, sellingPrice: true } } } },
          readings: { where: { status: 'OPEN' }, take: 1, select: { id: true, openingMeter: true, readingDate: true, recordedBy: { select: { name: true } } } },
        },
      },
      assignments: { where: { shift: { status: 'OPEN' } }, select: { shift: { select: { id: true, user: { select: { id: true, name: true } } } } } },
    },
  });
  res.json({
    pumps: pumps.map(({ assignments, nozzles, ...p }) => ({
      ...p,
      attendant: assignments[0]?.shift.user ?? null,
      shiftId: assignments[0]?.shift.id ?? null,
      nozzles: nozzles.map(({ readings, ...n }) => ({ ...n, openReading: readings[0] ?? null })),
    })),
  });
});

router.post('/pumps', requirePermission('pumps.manage'), async (req, res) => {
  const body = z.object({ stationId: id, code, name: optionalText(80), status: equipmentStatus.default('ACTIVE') }).parse(req.body);
  assertStationAccess(req, body.stationId);
  const pump = await prisma.$transaction(async (tx) => {
    const p = await tx.pump.create({ data: body });
    await audit(tx, req, { action: 'pump.create', entityType: 'Pump', entityId: p.id, details: `Added pump ${p.code}` });
    return p;
  });
  res.status(201).json({ pump });
});

router.patch('/pumps/:id', requirePermission('pumps.manage'), async (req, res) => {
  const body = z.object({ code, name: optionalText(80), status: equipmentStatus }).partial().parse(req.body);
  const existing = await prisma.pump.findUnique({ where: { id: req.params.id } });
  if (!existing) throw notFound('Pump not found');
  assertStationAccess(req, existing.stationId);
  const pump = await prisma.$transaction(async (tx) => {
    const p = await tx.pump.update({ where: { id: existing.id }, data: body });
    await audit(tx, req, { action: 'pump.update', entityType: 'Pump', entityId: p.id, details: `Updated pump ${p.code}`, before: { name: existing.name, status: existing.status }, after: body });
    return p;
  });
  res.json({ pump });
});

async function assertTankAtStation(tankId, stationId) {
  const tank = await prisma.tank.findUnique({ where: { id: tankId } });
  if (!tank) throw badRequest('Tank not found');
  if (tank.stationId !== stationId) throw badRequest('The nozzle and its tank must be at the same station');
  return tank;
}

router.post('/pumps/:id/nozzles', requirePermission('pumps.manage'), async (req, res) => {
  const body = z.object({ code, tankId: id, currentMeter: liters().default(0), status: equipmentStatus.default('ACTIVE') }).parse(req.body);
  const pump = await prisma.pump.findUnique({ where: { id: req.params.id } });
  if (!pump) throw notFound('Pump not found');
  assertStationAccess(req, pump.stationId);
  await assertTankAtStation(body.tankId, pump.stationId);
  const nozzle = await prisma.$transaction(async (tx) => {
    const n = await tx.nozzle.create({ data: { ...body, pumpId: pump.id } });
    await audit(tx, req, { action: 'nozzle.create', entityType: 'Nozzle', entityId: n.id, details: `Added nozzle ${n.code} on pump ${pump.code} (meter ${body.currentMeter})` });
    return n;
  });
  res.status(201).json({ nozzle });
});

// The meter is not editable here — it only advances through closed readings
router.patch('/nozzles/:id', requirePermission('pumps.manage'), async (req, res) => {
  const body = z.object({ code, tankId: id, status: equipmentStatus }).partial().parse(req.body);
  const existing = await prisma.nozzle.findUnique({ where: { id: req.params.id }, include: { pump: true } });
  if (!existing) throw notFound('Nozzle not found');
  assertStationAccess(req, existing.pump.stationId);
  if (body.tankId) await assertTankAtStation(body.tankId, existing.pump.stationId);
  const nozzle = await prisma.$transaction(async (tx) => {
    const n = await tx.nozzle.update({ where: { id: existing.id }, data: body });
    await audit(tx, req, { action: 'nozzle.update', entityType: 'Nozzle', entityId: n.id, details: `Updated nozzle ${n.code} on pump ${existing.pump.code}`, after: body });
    return n;
  });
  res.json({ nozzle });
});

// ─── Shifts ──────────────────────────────────────────────────

const shiftInclude = {
  user: { select: { id: true, name: true } },
  station: { select: { id: true, name: true } },
  assignments: { include: { pump: { select: { id: true, code: true, name: true } } } },
  _count: { select: { readings: true, sales: true } },
};

router.get('/shifts', requirePermission('shifts.view', 'shifts.view_own'), async (req, res) => {
  const ownOnly = !can(req.user, 'shifts.view');
  const stationId = stationScope(req);
  const shifts = await prisma.shift.findMany({
    where: {
      ...(ownOnly ? { userId: req.user.id } : {}),
      ...(stationId ? { stationId } : {}),
      ...(req.query.status ? { status: String(req.query.status) } : {}),
    },
    include: shiftInclude,
    orderBy: { startedAt: 'desc' },
    take: 100,
  });
  res.json({ shifts });
});

router.get('/shifts/mine', requirePermission('shifts.view', 'shifts.view_own'), async (req, res) => {
  const shift = await prisma.shift.findFirst({ where: { userId: req.user.id, status: 'OPEN' }, include: shiftInclude });
  res.json({ shift });
});

router.post('/shifts', requirePermission('shifts.manage'), async (req, res) => {
  const body = z.object({ userId: id, pumpIds: z.array(id).min(1, 'Assign at least one pump').max(20), notes: optionalText(500) }).parse(req.body);
  const staff = await prisma.user.findUnique({ where: { id: body.userId }, include: { role: true } });
  if (!staff || staff.status !== 'ACTIVE') throw badRequest('Choose an active staff member');
  if (!['attendant', 'cashier', 'station_manager'].includes(staff.role.key)) throw badRequest('Shifts can only be opened for station staff');
  const stationId = staff.stationId ?? req.user.stationId;
  if (!stationId) throw badRequest('The staff member is not assigned to a station');
  assertStationAccess(req, stationId);

  const shift = await prisma.$transaction(async (tx) => {
    // serialize shift creation per station so two managers cannot double-assign a pump
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'shift:' + stationId}))`;
    if (await tx.shift.findFirst({ where: { userId: staff.id, status: 'OPEN' } })) throw conflict(`${staff.name} already has an open shift`);
    const pumps = await tx.pump.findMany({ where: { id: { in: body.pumpIds } } });
    if (pumps.length !== body.pumpIds.length || pumps.some((p) => p.stationId !== stationId)) throw badRequest('All pumps must belong to the staff member\'s station');
    if (pumps.some((p) => p.status !== 'ACTIVE')) throw badRequest('Only active pumps can be assigned');
    const busy = await tx.pumpAssignment.findMany({ where: { pumpId: { in: body.pumpIds }, shift: { status: 'OPEN' } }, include: { pump: true, shift: { include: { user: true } } } });
    if (busy.length) throw conflict(busy.map((b) => `Pump ${b.pump.code} is already assigned to ${b.shift.user.name}`).join('; '));

    const s = await tx.shift.create({
      data: { stationId, userId: staff.id, notes: body.notes, assignments: { create: body.pumpIds.map((pumpId) => ({ pumpId })) } },
      include: shiftInclude,
    });
    await audit(tx, req, { action: 'shift.open', entityType: 'Shift', entityId: s.id, details: `Opened shift for ${staff.name} on pumps ${pumps.map((p) => p.code).join(', ')}` });
    await notify(tx, { type: 'INFO', title: 'Shift assigned', message: `You are assigned to pumps ${pumps.map((p) => p.code).join(', ')}`, userId: staff.id, link: '#pumps' });
    return s;
  });
  res.status(201).json({ shift });
});

router.post('/shifts/:id/close', requirePermission('shifts.manage', 'shifts.view_own'), async (req, res) => {
  const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
  if (!shift) throw notFound('Shift not found');
  if (shift.userId !== req.user.id && !can(req.user, 'shifts.manage')) throw forbidden('You can only close your own shift');
  assertStationAccess(req, shift.stationId);
  if (shift.status !== 'OPEN') throw conflict('Shift is already closed');
  const open = await prisma.pumpReading.count({ where: { shiftId: shift.id, status: 'OPEN' } });
  if (open) throw conflict(`Close the ${open} open meter reading(s) before ending the shift`);

  const closed = await prisma.$transaction(async (tx) => {
    const s = await tx.shift.update({ where: { id: shift.id }, data: { status: 'CLOSED', endedAt: new Date() }, include: shiftInclude });
    await audit(tx, req, { action: 'shift.close', entityType: 'Shift', entityId: s.id, details: `Closed shift of ${s.user.name}` });
    return s;
  });
  res.json({ shift: closed });
});

// ─── Pump meter readings ─────────────────────────────────────

const readingInclude = {
  nozzle: { select: { id: true, code: true, pump: { select: { id: true, code: true, stationId: true } }, tank: { select: { code: true, product: { select: { name: true, sellingPrice: true } } } } } },
  recordedBy: { select: { name: true } },
  reconciledBy: { select: { name: true } },
};

// Staff without pumps.manage need an open shift covering the nozzle's pump
async function resolveShiftFor(req, nozzle) {
  const shift = await prisma.shift.findFirst({
    where: { userId: req.user.id, status: 'OPEN', assignments: { some: { pumpId: nozzle.pumpId } } },
  });
  if (!shift && !can(req.user, 'pumps.manage')) throw forbidden(`Pump ${nozzle.pump.code} is not assigned to your open shift`);
  return shift;
}

router.get('/pump-readings', requirePermission('pumps.view'), async (req, res) => {
  const stationId = stationScope(req);
  const date = req.query.date ? parseDay(String(req.query.date), 'date') : null;
  const readings = await prisma.pumpReading.findMany({
    where: {
      ...(date ? { readingDate: date } : {}),
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      ...(stationId ? { nozzle: { pump: { stationId } } } : {}),
    },
    include: readingInclude,
    orderBy: [{ readingDate: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  });
  res.json({ readings });
});

router.post('/pump-readings', requirePermission('pumps.readings.record'), async (req, res) => {
  const body = z.object({ nozzleId: id, readingDate: dayString.optional(), openingMeter: liters(), notes: optionalText(500) }).parse(req.body);
  const nozzle = await prisma.nozzle.findUnique({ where: { id: body.nozzleId }, include: { pump: true } });
  if (!nozzle) throw notFound('Nozzle not found');
  assertStationAccess(req, nozzle.pump.stationId);
  if (nozzle.status !== 'ACTIVE' || nozzle.pump.status !== 'ACTIVE') throw conflict('This nozzle or pump is not active');
  const shift = await resolveShiftFor(req, nozzle);

  const reading = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Nozzle" WHERE "id" = ${nozzle.id} FOR UPDATE`;
    const current = await tx.nozzle.findUnique({ where: { id: nozzle.id } });
    if (await tx.pumpReading.findFirst({ where: { nozzleId: nozzle.id, status: 'OPEN' } })) {
      throw conflict(`Nozzle ${nozzle.code} on pump ${nozzle.pump.code} already has an open reading`);
    }
    if (body.openingMeter.lt(current.currentMeter)) {
      throw conflict(`Opening meter ${body.openingMeter} is below the last closing reading ${current.currentMeter}. Meters cannot go backwards.`);
    }
    const r = await tx.pumpReading.create({
      data: {
        nozzleId: nozzle.id, shiftId: shift?.id ?? null, openingMeter: body.openingMeter, notes: body.notes,
        readingDate: body.readingDate ? parseDay(body.readingDate, 'readingDate') : startOfDay(), recordedById: req.user.id,
      },
      include: readingInclude,
    });
    if (body.openingMeter.gt(current.currentMeter) && !current.currentMeter.isZero()) {
      // a jump between readings means fuel left the pump unrecorded; flag it for the manager
      await notify(tx, {
        type: 'WARNING', title: 'Meter gap', link: '#pumps', stationId: nozzle.pump.stationId,
        message: `Pump ${nozzle.pump.code} nozzle ${nozzle.code}: opened at ${body.openingMeter}, last close was ${current.currentMeter} (${body.openingMeter.minus(current.currentMeter)} L unaccounted)`,
      });
    }
    await audit(tx, req, { action: 'pump.reading_opened', entityType: 'PumpReading', entityId: r.id, details: `Pump ${nozzle.pump.code}/${nozzle.code} opened at ${body.openingMeter}` });
    return r;
  });
  res.status(201).json({ reading });
});

router.post('/pump-readings/:id/close', requirePermission('pumps.readings.record'), async (req, res) => {
  const body = z.object({ closingMeter: liters(), notes: optionalText(500) }).parse(req.body);

  const reading = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT "id" FROM "PumpReading" WHERE "id" = ${req.params.id} FOR UPDATE`;
    if (!rows.length) throw notFound('Reading not found');
    const r = await tx.pumpReading.findUnique({ where: { id: req.params.id }, include: { nozzle: { include: { pump: true } } } });
    assertStationAccess(req, r.nozzle.pump.stationId);
    if (r.status !== 'OPEN') throw conflict('This reading is already closed');
    if (!can(req.user, 'pumps.manage') && r.recordedById !== req.user.id) {
      const shift = await tx.shift.findFirst({ where: { userId: req.user.id, status: 'OPEN', assignments: { some: { pumpId: r.nozzle.pumpId } } } });
      if (!shift) throw forbidden('You can only close readings on pumps assigned to your shift');
    }
    if (body.closingMeter.lt(r.openingMeter)) throw badRequest(`Closing meter must be at least the opening meter (${r.openingMeter})`);

    // liters recorded as sales on this nozzle while the reading was open
    const sold = await tx.saleItem.aggregate({
      where: { nozzleId: r.nozzleId, sale: { status: { not: 'CANCELLED' }, saleDate: { gte: r.createdAt } } },
      _sum: { quantity: true },
    });
    const meterLiters = body.closingMeter.minus(r.openingMeter);
    const recordedLiters = D(sold._sum.quantity ?? 0);
    const varianceLiters = meterLiters.minus(recordedLiters);

    const updated = await tx.pumpReading.update({
      where: { id: r.id },
      data: { closingMeter: body.closingMeter, meterLiters, recordedLiters, varianceLiters, status: 'CLOSED', notes: body.notes ?? r.notes },
      include: readingInclude,
    });
    await tx.nozzle.update({ where: { id: r.nozzleId }, data: { currentMeter: body.closingMeter } });

    if (varianceLiters.abs().gt(PUMP_VARIANCE_ALERT_LITERS)) {
      await notify(tx, {
        type: 'DANGER', title: 'Pump variance', link: '#pumps', stationId: r.nozzle.pump.stationId,
        message: `Pump ${r.nozzle.pump.code}/${r.nozzle.code}: meter ${meterLiters} L vs recorded sales ${recordedLiters} L (${varianceLiters.isNegative() ? '' : '+'}${varianceLiters} L)`,
      });
    }
    await audit(tx, req, { action: 'pump.reading_closed', entityType: 'PumpReading', entityId: r.id, details: `Pump ${r.nozzle.pump.code}/${r.nozzle.code} closed at ${body.closingMeter}: ${meterLiters} L metered, ${recordedLiters} L recorded` });
    return updated;
  });
  res.json({ reading });
});

router.post('/pump-readings/:id/reconcile', requirePermission('pumps.reconcile'), async (req, res) => {
  const body = z.object({ notes: optionalText(500) }).parse(req.body ?? {});
  const reading = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT "id" FROM "PumpReading" WHERE "id" = ${req.params.id} FOR UPDATE`;
    if (!rows.length) throw notFound('Reading not found');
    const r = await tx.pumpReading.findUnique({ where: { id: req.params.id }, include: { nozzle: { include: { pump: true } } } });
    assertStationAccess(req, r.nozzle.pump.stationId);
    if (r.status !== 'CLOSED') throw conflict(r.status === 'OPEN' ? 'Close the reading before reconciling' : 'Already reconciled');
    if (r.varianceLiters && !r.varianceLiters.isZero() && !body.notes) throw badRequest('Explain the variance before reconciling');

    const updated = await tx.pumpReading.update({
      where: { id: r.id },
      data: { status: 'RECONCILED', reconciledById: req.user.id, reconciledAt: new Date(), notes: body.notes ?? r.notes },
      include: readingInclude,
    });
    // a closed shift becomes RECONCILED once every reading in it is reconciled
    if (r.shiftId) {
      const pending = await tx.pumpReading.count({ where: { shiftId: r.shiftId, status: { not: 'RECONCILED' } } });
      if (!pending) await tx.shift.updateMany({ where: { id: r.shiftId, status: 'CLOSED' }, data: { status: 'RECONCILED' } });
    }
    await audit(tx, req, { action: 'pump.reading_reconciled', entityType: 'PumpReading', entityId: r.id, details: `Reconciled pump ${r.nozzle.pump.code}/${r.nozzle.code} (variance ${r.varianceLiters ?? 0} L)${body.notes ? ` — ${body.notes}` : ''}` });
    return updated;
  });
  res.json({ reading });
});

// ─── Daily pump reconciliation report ────────────────────────

router.get('/reports/pump-reconciliation', requirePermission('pumps.reconcile', 'reports.view'), async (req, res) => {
  const stationId = stationScope(req);
  const date = req.query.date ? parseDay(String(req.query.date), 'date') : startOfDay();
  const readings = await prisma.pumpReading.findMany({
    where: { readingDate: { gte: date, lt: addDays(date, 1) }, ...(stationId ? { nozzle: { pump: { stationId } } } : {}) },
    include: readingInclude,
    orderBy: { createdAt: 'asc' },
  });
  const byPump = {};
  for (const r of readings) {
    const key = r.nozzle.pump.code;
    const row = (byPump[key] ||= { pump: key, readings: 0, open: 0, meterLiters: D(0), recordedLiters: D(0), varianceLiters: D(0), expectedRevenue: D(0) });
    row.readings += 1;
    if (r.status === 'OPEN') row.open += 1;
    row.meterLiters = row.meterLiters.plus(r.meterLiters ?? 0);
    row.recordedLiters = row.recordedLiters.plus(r.recordedLiters ?? 0);
    row.varianceLiters = row.varianceLiters.plus(r.varianceLiters ?? 0);
    row.expectedRevenue = row.expectedRevenue.plus(D(r.meterLiters ?? 0).times(r.nozzle.tank.product.sellingPrice)).toDecimalPlaces(2);
  }
  res.json({ date: req.query.date ?? null, pumps: Object.values(byPump), readings });
});

export default router;

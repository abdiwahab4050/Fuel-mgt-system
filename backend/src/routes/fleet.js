/**
 * /api — fleet vehicles and fuel consumption records.
 *
 * Consumption entries log fuel put into fleet vehicles for efficiency tracking.
 * They do not move station stock — fuel issued from the station's own tanks is
 * a sale (normally on the fleet customer's credit account), which deducts stock.
 *
 * Efficiency is fill-to-fill: km driven since the previous fill ÷ liters of this fill.
 * Odometer readings must increase for each vehicle.
 */
import express from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { decimal, id, liters, optionalText, dayString } from '../lib/validation.js';
import { addDays, parseDay, startOfDay } from '../lib/dates.js';

const router = express.Router();
const D = (v) => new Prisma.Decimal(v ?? 0);
export const HIGH_DAILY_USE_LITERS = 150;

// ─── Vehicles ────────────────────────────────────────────────

router.get('/vehicles', requirePermission('fleet.view', 'consumption.record'), async (req, res) => {
  const q = req.query.search ? String(req.query.search).trim() : '';
  const vehicles = await prisma.vehicle.findMany({
    where: {
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      ...(q ? { OR: [{ registrationNumber: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }, { driver: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    include: { customer: { select: { id: true, name: true } } },
    orderBy: { registrationNumber: 'asc' },
  });
  const stats = await prisma.fuelConsumption.groupBy({ by: ['vehicleId'], _sum: { quantity: true }, _max: { date: true, odometerReading: true }, _avg: { mileage: true }, _count: true });
  const by = Object.fromEntries(stats.map((s) => [s.vehicleId, s]));
  res.json({
    vehicles: vehicles.map((v) => ({
      ...v, totalLiters: by[v.id]?._sum.quantity ?? 0, fills: by[v.id]?._count ?? 0, lastFill: by[v.id]?._max.date ?? null,
      lastOdometer: by[v.id]?._max.odometerReading ?? null, avgEfficiency: by[v.id]?._avg.mileage ?? null,
    })),
  });
});

const vehicleBody = z.object({
  registrationNumber: z.string().trim().min(2).max(20).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2).max(80),
  type: z.string().trim().min(2).max(40),
  driver: optionalText(80),
  department: optionalText(80),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'OUT_OF_SERVICE']).default('ACTIVE'),
  customerId: id.optional().nullable(),
});

router.post('/vehicles', requirePermission('fleet.manage'), async (req, res) => {
  const body = vehicleBody.parse(req.body);
  const vehicle = await prisma.$transaction(async (tx) => {
    const v = await tx.vehicle.create({ data: { ...body, customerId: body.customerId ?? null } });
    await audit(tx, req, { action: 'vehicle.create', entityType: 'Vehicle', entityId: v.id, details: `Registered ${v.registrationNumber} ${v.name}` });
    return v;
  });
  res.status(201).json({ vehicle });
});

router.patch('/vehicles/:id', requirePermission('fleet.manage'), async (req, res) => {
  const body = vehicleBody.partial().parse(req.body);
  const vehicle = await prisma.$transaction(async (tx) => {
    const v = await tx.vehicle.update({ where: { id: req.params.id }, data: body });
    await audit(tx, req, { action: 'vehicle.update', entityType: 'Vehicle', entityId: v.id, details: `Updated ${v.registrationNumber}`, after: body });
    return v;
  });
  res.json({ vehicle });
});

// ─── Consumption ─────────────────────────────────────────────

const consumptionInclude = {
  vehicle: { select: { id: true, registrationNumber: true, name: true, type: true } },
  product: { select: { name: true } },
  recordedBy: { select: { name: true } },
};

router.get('/consumption', requirePermission('fleet.view', 'consumption.record'), async (req, res) => {
  const where = {
    ...(req.query.vehicleId ? { vehicleId: String(req.query.vehicleId) } : {}),
    ...(req.query.from || req.query.to ? { date: {
      ...(req.query.from ? { gte: parseDay(String(req.query.from), 'from') } : {}),
      ...(req.query.to ? { lt: addDays(parseDay(String(req.query.to), 'to'), 1) } : {}),
    } } : {}),
  };
  const today = startOfDay();
  const [records, sums, todayUse] = await Promise.all([
    prisma.fuelConsumption.findMany({ where, include: consumptionInclude, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 500 }),
    prisma.fuelConsumption.aggregate({ where, _sum: { quantity: true }, _avg: { mileage: true }, _count: true }),
    prisma.fuelConsumption.groupBy({ by: ['vehicleId'], where: { date: { gte: today, lt: addDays(today, 1) } }, _sum: { quantity: true } }),
  ]);
  const high = todayUse.filter((t) => D(t._sum.quantity).gt(HIGH_DAILY_USE_LITERS));
  const vehicles = high.length ? await prisma.vehicle.findMany({ where: { id: { in: high.map((h) => h.vehicleId) } }, select: { id: true, registrationNumber: true, name: true } }) : [];
  res.json({
    records,
    summary: { liters: sums._sum.quantity ?? 0, records: sums._count, avgEfficiency: sums._avg.mileage ?? null },
    highUseToday: high.map((h) => ({ ...vehicles.find((v) => v.id === h.vehicleId), liters: h._sum.quantity })),
    highUseThreshold: HIGH_DAILY_USE_LITERS,
  });
});

router.post('/consumption', requirePermission('consumption.record'), async (req, res) => {
  const body = z.object({
    vehicleId: id,
    productId: id,
    quantity: liters({ positive: true, max: 2000 }),
    odometerReading: decimal(1, { positive: true }).optional().nullable(),
    mileage: decimal(3, { positive: true, max: 100 }).optional().nullable(),
    driver: optionalText(80),
    date: dayString.optional(),
  }).parse(req.body);
  const date = body.date ? parseDay(body.date, 'date') : startOfDay();
  if (date > new Date()) throw badRequest('Date cannot be in the future');

  const record = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT "id", "status", "driver" FROM "Vehicle" WHERE "id" = ${body.vehicleId} FOR UPDATE`;
    if (!rows.length) throw notFound('Vehicle not found');
    if (rows[0].status === 'OUT_OF_SERVICE') throw conflict('This vehicle is out of service');
    if (!(await tx.fuelProduct.findUnique({ where: { id: body.productId } }))) throw badRequest('Unknown fuel product');

    // SECTION: fill-to-fill efficiency from the previous odometer reading
    let mileage = body.mileage ?? null;
    if (body.odometerReading) {
      const prev = await tx.fuelConsumption.findFirst({ where: { vehicleId: body.vehicleId, odometerReading: { not: null } }, orderBy: { odometerReading: 'desc' } });
      if (prev && body.odometerReading.lte(prev.odometerReading)) {
        throw conflict(`Odometer must be above the last reading (${prev.odometerReading} km on ${prev.date.toISOString().slice(0, 10)})`);
      }
      if (prev) mileage = body.odometerReading.minus(prev.odometerReading).div(body.quantity).toDecimalPlaces(3);
    }
    const c = await tx.fuelConsumption.create({
      data: {
        vehicleId: body.vehicleId, productId: body.productId, quantity: body.quantity, odometerReading: body.odometerReading ?? null,
        mileage, driver: body.driver || rows[0].driver || null, date, recordedById: req.user.id,
      },
      include: consumptionInclude,
    });
    await audit(tx, req, { action: 'consumption.record', entityType: 'FuelConsumption', entityId: c.id, details: `${c.vehicle.registrationNumber}: ${c.quantity} L ${c.product.name}${mileage ? ` (${mileage} km/L)` : ''}` });
    return c;
  });
  res.status(201).json({ record });
});

export default router;

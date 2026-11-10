/**
 * Stock ledger — the ONLY code that changes Tank.currentLiters.
 *
 * Every call must run inside a Prisma interactive transaction (tx). The tank
 * row is locked with SELECT ... FOR UPDATE so concurrent sales/deliveries on
 * the same tank are serialized, then the new level and its StockMovement row
 * are written together. Tank level therefore always equals the ledger sum.
 */
import { Prisma } from '@prisma/client';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';

const D = (v) => new Prisma.Decimal(v);

// SECTION: lock a tank row for the rest of the transaction and return its current state
export async function lockTank(tx, tankId) {
  const rows = await tx.$queryRaw`
    SELECT "id", "stationId", "productId", "code", "currentLiters", "capacityLiters", "minLevelLiters", "status"
    FROM "Tank" WHERE "id" = ${tankId} FOR UPDATE`;
  if (!rows.length) throw notFound('Tank not found');
  const t = rows[0];
  return { ...t, currentLiters: D(t.currentLiters), capacityLiters: D(t.capacityLiters), minLevelLiters: D(t.minLevelLiters) };
}

/**
 * Apply a signed quantity to a tank.
 *  quantity      Decimal, + into the tank, − out of it (never zero)
 *  type          StockMovementType
 *  allowNegative only for corrections where the book level was already wrong (never for sales)
 */
export async function applyStockMovement(tx, {
  tankId, type, quantity, userId, unitCost = null, referenceType = null, referenceId = null, note = null, allowNegative = false,
}) {
  const qty = D(quantity);
  if (qty.isZero()) throw badRequest('Quantity cannot be zero');

  const tank = await lockTank(tx, tankId);
  if (tank.status === 'OUT_OF_SERVICE' && qty.isPositive()) throw conflict(`Tank ${tank.code} is out of service`);

  const after = tank.currentLiters.plus(qty);
  if (after.isNegative() && !allowNegative) {
    throw conflict(`Not enough fuel in tank ${tank.code}: ${tank.currentLiters.toString()} L available, ${qty.abs().toString()} L requested`, {
      tankId, available: tank.currentLiters.toNumber(),
    });
  }
  if (after.gt(tank.capacityLiters)) {
    throw conflict(`Tank ${tank.code} would overflow: capacity ${tank.capacityLiters.toString()} L, resulting level ${after.toString()} L`, {
      tankId, capacity: tank.capacityLiters.toNumber(),
    });
  }

  await tx.tank.update({ where: { id: tankId }, data: { currentLiters: after } });
  const movement = await tx.stockMovement.create({
    data: { tankId, type, quantity: qty, balanceAfter: after, unitCost, referenceType, referenceId, note, createdById: userId },
  });

  // SECTION: low-stock alert only when the level crosses the minimum (not on every sale below it)
  if (tank.currentLiters.gt(tank.minLevelLiters) && after.lte(tank.minLevelLiters)) {
    const product = await tx.fuelProduct.findUnique({ where: { id: tank.productId }, select: { name: true } });
    await notify(tx, {
      type: 'WARNING',
      title: 'Low Stock Alert',
      message: `${product?.name ?? 'Fuel'} tank ${tank.code} is at ${after.toString()} L (minimum ${tank.minLevelLiters.toString()} L)`,
      link: '#inventory',
      stationId: tank.stationId,
    });
  }

  return { movement, before: tank.currentLiters, after };
}

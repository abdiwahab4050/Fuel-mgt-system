/**
 * Purchasing — purchase orders, fuel deliveries, supplier invoices, supplier payments.
 *
 *  - A purchase order (PO) moves DRAFT → ORDERED → PARTIALLY_RECEIVED → RECEIVED, or → CANCELLED.
 *  - A delivery is recorded as PENDING and only changes stock when it is confirmed:
 *    a DELIVERY ledger movement into the tank (locked, capacity-checked), and the
 *    PO's received quantities and status are updated. Deliveries against a PO
 *    cannot exceed the quantity still outstanding for that product.
 *  - On confirmation the product's cost price becomes the delivery's unit cost
 *    (last-cost method), and a price-history row records the change.
 *  - A supplier invoice's amountPaid changes only inside recordSupplierPayment, under a row lock.
 *  - Supplier balance = Σ(amount − amountPaid) over UNPAID/PARTIALLY_PAID supplier invoices.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { applyStockMovement } from './stock.js';
import { nextDocNumber } from '../lib/numbering.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';

const D = (v) => new Prisma.Decimal(v);
const round2 = (d) => D(d).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

function assertStation(req, stationId) {
  if (req.user.stationId && req.user.stationId !== stationId) throw forbidden('This record belongs to another station');
}

// SECTION: received liters per product on a PO (confirmed deliveries only)
export async function receivedByProduct(db, purchaseOrderId) {
  const rows = await db.fuelDelivery.groupBy({ by: ['productId'], where: { purchaseOrderId, status: 'CONFIRMED' }, _sum: { quantityDelivered: true } });
  return Object.fromEntries(rows.map((r) => [r.productId, D(r._sum.quantityDelivered ?? 0)]));
}

async function lockPO(tx, id) {
  const rows = await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id} FOR UPDATE`;
  if (!rows.length) throw notFound('Purchase order not found');
  return tx.purchaseOrder.findUnique({ where: { id }, include: { items: true, supplier: true } });
}

// ─── Purchase orders ─────────────────────────────────────────

export async function createPurchaseOrder(req, { supplierId, stationId, expectedDate, notes, items, submit }) {
  const station = req.user.stationId ?? stationId;
  if (!station) throw badRequest('Select the station that will receive the fuel');
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier || supplier.status !== 'ACTIVE') throw badRequest('Choose an active supplier');
  const productIds = [...new Set(items.map((i) => i.productId))];
  if (productIds.length !== items.length) throw badRequest('Each product can appear only once on a purchase order');
  if ((await prisma.fuelProduct.count({ where: { id: { in: productIds } } })) !== productIds.length) throw badRequest('Unknown product on the order');

  const lines = items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitCost: i.unitCost, lineTotal: round2(i.quantity.times(i.unitCost)) }));
  const totalAmount = lines.reduce((s, l) => s.plus(l.lineTotal), D(0));

  return prisma.$transaction(async (tx) => {
    const orderNo = await nextDocNumber(tx, 'purchaseOrder');
    const po = await tx.purchaseOrder.create({
      data: {
        orderNo, supplierId, stationId: station, status: submit ? 'ORDERED' : 'DRAFT', expectedDate: expectedDate ?? null,
        notes: notes ?? null, totalAmount, createdById: req.user.id, items: { create: lines },
      },
    });
    await audit(tx, req, { action: 'po.create', entityType: 'PurchaseOrder', entityId: po.id, details: `${orderNo} to ${supplier.name}: ${totalAmount} (${po.status})` });
    return po;
  });
}

export async function setPurchaseOrderStatus(req, id, action) {
  return prisma.$transaction(async (tx) => {
    const po = await lockPO(tx, id);
    assertStation(req, po.stationId);
    if (action === 'order') {
      if (po.status !== 'DRAFT') throw conflict(`Only draft orders can be sent (this one is ${po.status.toLowerCase()})`);
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'ORDERED', orderDate: new Date() } });
    } else if (action === 'cancel') {
      if (['RECEIVED', 'CANCELLED'].includes(po.status)) throw conflict(`Order is already ${po.status.toLowerCase()}`);
      if (await tx.fuelDelivery.count({ where: { purchaseOrderId: id, status: { in: ['CONFIRMED', 'PENDING'] } } })) {
        throw conflict('This order has deliveries. Reject pending deliveries first; orders with confirmed deliveries cannot be cancelled.');
      }
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    } else if (action === 'close') {
      // accept a short delivery as final
      if (po.status !== 'PARTIALLY_RECEIVED') throw conflict('Only partially received orders can be closed');
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'RECEIVED' } });
    }
    await audit(tx, req, { action: `po.${action}`, entityType: 'PurchaseOrder', entityId: id, details: `${po.orderNo}: ${action}` });
    return tx.purchaseOrder.findUnique({ where: { id } });
  });
}

// ─── Deliveries ──────────────────────────────────────────────

export async function recordDelivery(req, { purchaseOrderId, supplierId, tankId, quantityDelivered, unitCost, deliveryDate, notes }) {
  const tank = await prisma.tank.findUnique({ where: { id: tankId } });
  if (!tank) throw badRequest('Tank not found');
  assertStation(req, tank.stationId);

  return prisma.$transaction(async (tx) => {
    let cost = unitCost;
    let supplier = supplierId;
    if (purchaseOrderId) {
      const po = await lockPO(tx, purchaseOrderId);
      if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status)) throw conflict(`Deliveries can only be recorded against sent orders (this one is ${po.status.toLowerCase()})`);
      if (po.stationId !== tank.stationId) throw badRequest('The tank must be at the station on the purchase order');
      const line = po.items.find((i) => i.productId === tank.productId);
      if (!line) throw badRequest('This tank holds a product that is not on the purchase order');
      const received = (await receivedByProduct(tx, po.id))[tank.productId] ?? D(0);
      const pending = D((await tx.fuelDelivery.aggregate({ where: { purchaseOrderId: po.id, productId: tank.productId, status: 'PENDING' }, _sum: { quantityDelivered: true } }))._sum.quantityDelivered ?? 0);
      const remaining = line.quantity.minus(received).minus(pending);
      if (quantityDelivered.gt(remaining)) throw conflict(`Only ${remaining} L of this product is still outstanding on ${po.orderNo}`);
      cost = cost ?? line.unitCost;
      supplier = po.supplierId;
    }
    if (!supplier) throw badRequest('Choose the supplier');
    if (!cost) throw badRequest('Enter the unit cost');

    const deliveryNo = await nextDocNumber(tx, 'delivery');
    const d = await tx.fuelDelivery.create({
      data: {
        deliveryNo, purchaseOrderId: purchaseOrderId ?? null, supplierId: supplier, tankId, productId: tank.productId,
        quantityDelivered, unitCost: cost, totalCost: round2(quantityDelivered.times(cost)),
        deliveryDate, receivedById: req.user.id, notes: notes ?? null,
      },
    });
    await audit(tx, req, { action: 'delivery.record', entityType: 'FuelDelivery', entityId: d.id, details: `${deliveryNo}: ${quantityDelivered} L into tank ${tank.code} at ${cost}/L (awaiting confirmation)` });
    await notify(tx, { type: 'INFO', title: 'Delivery awaiting confirmation', message: `${deliveryNo}: ${quantityDelivered} L into tank ${tank.code}`, stationId: tank.stationId, link: '#purchases' });
    return d;
  });
}

export async function confirmDelivery(req, id, { quantityDelivered } = {}) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT "id" FROM "FuelDelivery" WHERE "id" = ${id} FOR UPDATE`;
    if (!rows.length) throw notFound('Delivery not found');
    const d = await tx.fuelDelivery.findUnique({ where: { id }, include: { tank: true, product: true } });
    assertStation(req, d.tank.stationId);
    if (d.status !== 'PENDING') throw conflict(`Delivery is already ${d.status.toLowerCase()}`);

    // the measured quantity may be lower than the delivery note (never higher than what was recorded)
    const qty = quantityDelivered ?? d.quantityDelivered;
    if (qty.gt(d.quantityDelivered)) throw badRequest('Confirmed quantity cannot exceed the recorded delivery; record another delivery for extra fuel');

    await applyStockMovement(tx, {
      tankId: d.tankId, type: 'DELIVERY', quantity: qty, unitCost: d.unitCost, userId: req.user.id,
      referenceType: 'FuelDelivery', referenceId: d.id, note: `${d.deliveryNo}${qty.lt(d.quantityDelivered) ? ` (note said ${d.quantityDelivered} L)` : ''}`,
    });
    const confirmed = await tx.fuelDelivery.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), quantityDelivered: qty, totalCost: round2(qty.times(d.unitCost)) },
    });

    // SECTION: last-cost method — product cost price follows the latest confirmed delivery
    if (!d.product.costPrice.equals(d.unitCost)) {
      await tx.fuelProduct.update({ where: { id: d.productId }, data: { costPrice: d.unitCost } });
      await tx.fuelPriceHistory.create({ data: { productId: d.productId, sellingPrice: d.product.sellingPrice, costPrice: d.unitCost, changedById: req.user.id } });
    }

    // SECTION: PO progress
    if (d.purchaseOrderId) {
      const po = await lockPO(tx, d.purchaseOrderId);
      const received = await receivedByProduct(tx, po.id);
      const complete = po.items.every((i) => (received[i.productId] ?? D(0)).gte(i.quantity));
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED' } });
    }
    await audit(tx, req, { action: 'delivery.confirm', entityType: 'FuelDelivery', entityId: d.id, details: `${d.deliveryNo}: ${qty} L ${d.product.name} added to tank ${d.tank.code}` });
    return confirmed;
  });
}

export async function rejectDelivery(req, id, reason) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT "id" FROM "FuelDelivery" WHERE "id" = ${id} FOR UPDATE`;
    if (!rows.length) throw notFound('Delivery not found');
    const d = await tx.fuelDelivery.findUnique({ where: { id }, include: { tank: true } });
    assertStation(req, d.tank.stationId);
    if (d.status !== 'PENDING') throw conflict(`Delivery is already ${d.status.toLowerCase()}`);
    const r = await tx.fuelDelivery.update({ where: { id }, data: { status: 'REJECTED', notes: [d.notes, `Rejected: ${reason}`].filter(Boolean).join(' | ') } });
    await audit(tx, req, { action: 'delivery.reject', entityType: 'FuelDelivery', entityId: id, details: `${d.deliveryNo} rejected: ${reason}` });
    return r;
  });
}

// ─── Supplier invoices & payments (accounts payable) ─────────

export async function createSupplierInvoice(req, body) {
  const supplier = await prisma.supplier.findUnique({ where: { id: body.supplierId } });
  if (!supplier) throw badRequest('Supplier not found');
  if (body.purchaseOrderId) {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: body.purchaseOrderId } });
    if (!po || po.supplierId !== supplier.id) throw badRequest('The purchase order belongs to a different supplier');
  }
  if (body.dueDate && body.dueDate < body.issueDate) throw badRequest('Due date cannot be before the issue date');
  return prisma.$transaction(async (tx) => {
    const inv = await tx.supplierInvoice.create({ data: { ...body, purchaseOrderId: body.purchaseOrderId ?? null } });
    await audit(tx, req, { action: 'supplier_invoice.create', entityType: 'SupplierInvoice', entityId: inv.id, details: `${supplier.name} invoice ${inv.invoiceNumber}: ${inv.amount}` });
    return inv;
  });
}

export async function recordSupplierPayment(req, { supplierInvoiceId, amount, method, reference, paidAt }) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT "id" FROM "SupplierInvoice" WHERE "id" = ${supplierInvoiceId} FOR UPDATE`;
    if (!rows.length) throw notFound('Supplier invoice not found');
    const inv = await tx.supplierInvoice.findUnique({ where: { id: supplierInvoiceId }, include: { supplier: true } });
    if (inv.status === 'CANCELLED' || inv.status === 'PAID') throw conflict(`Invoice ${inv.invoiceNumber} is ${inv.status.toLowerCase()}`);
    const balance = inv.amount.minus(inv.amountPaid);
    if (amount.gt(balance)) throw conflict(`Payment ${amount} exceeds the balance due ${balance}`);

    // duplicate guard: same invoice, amount and reference within 10 minutes is almost certainly a double entry
    if (reference) {
      const dup = await tx.supplierPayment.findFirst({ where: { supplierInvoiceId, amount, reference, createdAt: { gte: new Date(Date.now() - 600000) } } });
      if (dup) throw conflict(`This payment looks like a duplicate of ${dup.paymentNo}`);
    }
    const paymentNo = await nextDocNumber(tx, 'supplierPayment');
    const payment = await tx.supplierPayment.create({
      data: { paymentNo, supplierId: inv.supplierId, supplierInvoiceId, amount, method, reference: reference ?? null, paidAt, recordedById: req.user.id },
    });
    const amountPaid = inv.amountPaid.plus(amount);
    await tx.supplierInvoice.update({ where: { id: inv.id }, data: { amountPaid, status: amountPaid.gte(inv.amount) ? 'PAID' : 'PARTIALLY_PAID' } });
    await audit(tx, req, { action: 'supplier_payment.create', entityType: 'SupplierPayment', entityId: payment.id, details: `${paymentNo}: paid ${inv.supplier.name} ${amount} (${method}) on invoice ${inv.invoiceNumber}` });
    return payment;
  });
}

export async function supplierBalances(supplierIds) {
  if (!supplierIds.length) return {};
  const rows = await prisma.supplierInvoice.groupBy({
    by: ['supplierId'],
    where: { supplierId: { in: supplierIds }, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
    _sum: { amount: true, amountPaid: true },
    _count: true,
  });
  return Object.fromEntries(rows.map((r) => [r.supplierId, { outstanding: D(r._sum.amount ?? 0).minus(r._sum.amountPaid ?? 0), openInvoices: r._count }]));
}

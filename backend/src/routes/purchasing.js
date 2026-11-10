/**
 * /api — suppliers, purchase orders, deliveries, supplier invoices, supplier payments.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { can, requirePermission, stationScope } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { nextDocNumber } from '../lib/numbering.js';
import { badRequest, notFound } from '../lib/errors.js';
import { id, liters, money, optionalText, paging, unitPrice, dayString } from '../lib/validation.js';
import { addDays, parseDay } from '../lib/dates.js';
import {
  confirmDelivery, createPurchaseOrder, createSupplierInvoice, receivedByProduct, recordDelivery,
  recordSupplierPayment, rejectDelivery, setPurchaseOrderStatus, supplierBalances,
} from '../services/purchasing.js';

const router = express.Router();
const day = dayString.transform((v) => parseDay(v, 'date'));

function dateRange(query, field) {
  const where = {};
  if (query.from) (where[field] ||= {}).gte = parseDay(String(query.from), 'from');
  if (query.to) (where[field] ||= {}).lt = addDays(parseDay(String(query.to), 'to'), 1);
  return where;
}

// ─── Suppliers ───────────────────────────────────────────────

router.get('/suppliers', requirePermission('suppliers.view', 'purchases.view'), async (req, res) => {
  const q = req.query.search ? String(req.query.search).trim() : '';
  const suppliers = await prisma.supplier.findMany({
    where: {
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { contactPerson: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    include: { _count: { select: { purchaseOrders: true, deliveries: true } } },
    orderBy: { name: 'asc' },
  });
  const b = await supplierBalances(suppliers.map((s) => s.id));
  res.json({ suppliers: suppliers.map((s) => ({ ...s, outstanding: b[s.id]?.outstanding ?? 0, openInvoices: b[s.id]?.openInvoices ?? 0 })) });
});

router.get('/suppliers/:id', requirePermission('suppliers.view', 'purchases.view'), async (req, res) => {
  const supplier = await prisma.supplier.findUnique({
    where: { id: req.params.id },
    include: {
      purchaseOrders: { orderBy: { orderDate: 'desc' }, take: 10, select: { id: true, orderNo: true, orderDate: true, status: true, totalAmount: true } },
      invoices: { orderBy: { issueDate: 'desc' }, take: 10 },
      payments: { orderBy: { paidAt: 'desc' }, take: 10 },
    },
  });
  if (!supplier) throw notFound('Supplier not found');
  const [b, purchased] = await Promise.all([
    supplierBalances([supplier.id]),
    prisma.fuelDelivery.aggregate({ where: { supplierId: supplier.id, status: 'CONFIRMED' }, _sum: { quantityDelivered: true, totalCost: true } }),
  ]);
  res.json({ supplier: { ...supplier, outstanding: b[supplier.id]?.outstanding ?? 0, litersDelivered: purchased._sum.quantityDelivered ?? 0, totalPurchased: purchased._sum.totalCost ?? 0 } });
});

const supplierBody = z.object({
  name: z.string().trim().min(2).max(120),
  contactPerson: optionalText(100),
  phone: optionalText(30),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email()]).optional().nullable().transform((v) => v || null),
  address: optionalText(250),
  taxId: optionalText(60),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

router.post('/suppliers', requirePermission('suppliers.manage'), async (req, res) => {
  const body = supplierBody.parse(req.body);
  const supplier = await prisma.$transaction(async (tx) => {
    const code = await nextDocNumber(tx, 'supplier');
    const s = await tx.supplier.create({ data: { ...body, code } });
    await audit(tx, req, { action: 'supplier.create', entityType: 'Supplier', entityId: s.id, details: `Added supplier ${code} ${s.name}` });
    return s;
  });
  res.status(201).json({ supplier });
});

router.patch('/suppliers/:id', requirePermission('suppliers.manage'), async (req, res) => {
  const body = supplierBody.partial().parse(req.body);
  const supplier = await prisma.$transaction(async (tx) => {
    const s = await tx.supplier.update({ where: { id: req.params.id }, data: body });
    await audit(tx, req, { action: 'supplier.update', entityType: 'Supplier', entityId: s.id, details: `Updated supplier ${s.name}`, after: body });
    return s;
  });
  res.json({ supplier });
});

// ─── Purchase orders ─────────────────────────────────────────

const poInclude = {
  supplier: { select: { id: true, name: true, code: true } },
  station: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  items: { include: { product: { select: { id: true, name: true, code: true } } } },
};

router.get('/purchase-orders', requirePermission('purchases.view'), async (req, res) => {
  const stationId = stationScope(req);
  const { skip, take, page, pageSize } = paging(req.query);
  const q = req.query.search ? String(req.query.search).trim() : '';
  const where = {
    ...(stationId ? { stationId } : {}),
    ...dateRange(req.query, 'orderDate'),
    ...(req.query.status ? { status: { in: String(req.query.status).split(',') } } : {}),
    ...(req.query.supplierId ? { supplierId: String(req.query.supplierId) } : {}),
    ...(q ? { OR: [{ orderNo: { contains: q, mode: 'insensitive' } }, { supplier: { name: { contains: q, mode: 'insensitive' } } }] } : {}),
  };
  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({ where, skip, take, orderBy: { orderDate: 'desc' }, include: poInclude }),
    prisma.purchaseOrder.count({ where }),
  ]);
  res.json({ orders, total, page, pageSize });
});

router.get('/purchase-orders/:id', requirePermission('purchases.view'), async (req, res) => {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id },
    include: { ...poInclude, deliveries: { orderBy: { deliveryDate: 'desc' }, include: { tank: { select: { code: true } } } }, invoices: true },
  });
  if (!po || (req.user.stationId && po.stationId !== req.user.stationId)) throw notFound('Purchase order not found');
  const received = await receivedByProduct(prisma, po.id);
  res.json({ order: { ...po, items: po.items.map((i) => ({ ...i, received: received[i.productId] ?? 0 })) } });
});

router.post('/purchase-orders', requirePermission('purchases.manage'), async (req, res) => {
  const body = z.object({
    supplierId: id,
    stationId: id.optional(),
    expectedDate: day.optional(),
    notes: optionalText(500),
    submit: z.boolean().default(false),
    items: z.array(z.object({ productId: id, quantity: liters({ positive: true, max: 1000000 }), unitCost: unitPrice({ positive: true }) })).min(1).max(10),
  }).parse(req.body);
  const po = await createPurchaseOrder(req, body);
  res.status(201).json({ order: await prisma.purchaseOrder.findUnique({ where: { id: po.id }, include: poInclude }) });
});

for (const action of ['order', 'cancel', 'close']) {
  router.post(`/purchase-orders/:id/${action}`, requirePermission('purchases.manage'), async (req, res) => {
    await setPurchaseOrderStatus(req, req.params.id, action);
    res.json({ order: await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, include: poInclude }) });
  });
}

// ─── Deliveries ──────────────────────────────────────────────

const deliveryInclude = {
  supplier: { select: { name: true } },
  tank: { select: { code: true, stationId: true } },
  product: { select: { name: true } },
  purchaseOrder: { select: { orderNo: true } },
  receivedBy: { select: { name: true } },
};

router.get('/deliveries', requirePermission('purchases.view'), async (req, res) => {
  const stationId = stationScope(req);
  const { skip, take, page, pageSize } = paging(req.query);
  const where = {
    ...(stationId ? { tank: { stationId } } : {}),
    ...dateRange(req.query, 'deliveryDate'),
    ...(req.query.status ? { status: String(req.query.status) } : {}),
    ...(req.query.purchaseOrderId ? { purchaseOrderId: String(req.query.purchaseOrderId) } : {}),
  };
  const [deliveries, total, sums] = await Promise.all([
    prisma.fuelDelivery.findMany({ where, skip, take, orderBy: { deliveryDate: 'desc' }, include: deliveryInclude }),
    prisma.fuelDelivery.count({ where }),
    prisma.fuelDelivery.aggregate({ where: { ...where, status: 'CONFIRMED' }, _sum: { quantityDelivered: true, totalCost: true } }),
  ]);
  res.json({ deliveries, total, page, pageSize, summary: { liters: sums._sum.quantityDelivered ?? 0, cost: sums._sum.totalCost ?? 0 } });
});

router.post('/deliveries', requirePermission('purchases.manage'), async (req, res) => {
  const body = z.object({
    purchaseOrderId: id.optional().nullable(),
    supplierId: id.optional(),
    tankId: id,
    quantityDelivered: liters({ positive: true, max: 1000000 }),
    unitCost: unitPrice({ positive: true }).optional(),
    deliveryDate: day.optional(),
    notes: optionalText(500),
  }).parse(req.body);
  const d = await recordDelivery(req, { ...body, deliveryDate: body.deliveryDate ?? new Date() });
  res.status(201).json({ delivery: await prisma.fuelDelivery.findUnique({ where: { id: d.id }, include: deliveryInclude }) });
});

router.post('/deliveries/:id/confirm', requirePermission('deliveries.confirm'), async (req, res) => {
  const { quantityDelivered } = z.object({ quantityDelivered: liters({ positive: true }).optional() }).parse(req.body ?? {});
  await confirmDelivery(req, req.params.id, { quantityDelivered });
  res.json({ delivery: await prisma.fuelDelivery.findUnique({ where: { id: req.params.id }, include: deliveryInclude }) });
});

router.post('/deliveries/:id/reject', requirePermission('deliveries.confirm'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(5).max(300) }).parse(req.body);
  await rejectDelivery(req, req.params.id, reason);
  res.json({ delivery: await prisma.fuelDelivery.findUnique({ where: { id: req.params.id }, include: deliveryInclude }) });
});

// ─── Supplier invoices & payments ────────────────────────────

router.get('/supplier-invoices', requirePermission('purchases.view', 'supplier_payments.manage', 'finance.view'), async (req, res) => {
  const where = {
    ...(req.query.supplierId ? { supplierId: String(req.query.supplierId) } : {}),
    ...(req.query.status ? { status: { in: String(req.query.status).split(',') } } : {}),
    ...(req.query.overdue === 'true' ? { status: { in: ['UNPAID', 'PARTIALLY_PAID'] }, dueDate: { lt: new Date() } } : {}),
  };
  const [invoices, open] = await Promise.all([
    prisma.supplierInvoice.findMany({ where, orderBy: [{ status: 'asc' }, { dueDate: 'asc' }], take: 200, include: { supplier: { select: { name: true } }, purchaseOrder: { select: { orderNo: true } } } }),
    prisma.supplierInvoice.aggregate({ where: { ...where, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } }, _sum: { amount: true, amountPaid: true }, _count: true }),
  ]);
  res.json({ invoices, summary: { open: open._count, outstanding: Number(open._sum.amount ?? 0) - Number(open._sum.amountPaid ?? 0) } });
});

router.post('/supplier-invoices', requirePermission('purchases.manage', 'supplier_payments.manage'), async (req, res) => {
  const body = z.object({
    supplierId: id,
    purchaseOrderId: id.optional().nullable(),
    invoiceNumber: z.string().trim().min(1).max(60),
    issueDate: day,
    dueDate: day.optional().nullable(),
    amount: money({ positive: true }),
  }).parse(req.body);
  res.status(201).json({ invoice: await createSupplierInvoice(req, body) });
});

router.get('/supplier-payments', requirePermission('supplier_payments.manage', 'finance.view', 'purchases.view'), async (req, res) => {
  const { skip, take, page, pageSize } = paging(req.query);
  const where = { ...dateRange(req.query, 'paidAt'), ...(req.query.supplierId ? { supplierId: String(req.query.supplierId) } : {}) };
  const [payments, total] = await Promise.all([
    prisma.supplierPayment.findMany({ where, skip, take, orderBy: { paidAt: 'desc' }, include: { supplier: { select: { name: true } }, supplierInvoice: { select: { invoiceNumber: true } }, recordedBy: { select: { name: true } } } }),
    prisma.supplierPayment.count({ where }),
  ]);
  res.json({ payments, total, page, pageSize });
});

router.post('/supplier-payments', requirePermission('supplier_payments.manage'), async (req, res) => {
  const body = z.object({
    supplierInvoiceId: id,
    amount: money({ positive: true }),
    method: z.enum(['CASH', 'BANK_TRANSFER', 'ZAAD', 'EDAHAB']),
    reference: optionalText(100),
    paidAt: day.optional(),
  }).parse(req.body);
  if (body.method !== 'CASH' && !body.reference) throw badRequest('Enter the transfer or transaction reference');
  const payment = await recordSupplierPayment(req, { ...body, paidAt: body.paidAt ?? new Date() });
  res.status(201).json({ payment });
});

export default router;

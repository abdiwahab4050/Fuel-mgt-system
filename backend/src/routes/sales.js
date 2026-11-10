/**
 * /api — sales, invoices, payments (manual), refunds.
 *
 * Visibility:
 *  - sales.view / invoices.view / payments.view → everything at the user's station
 *  - sales.view_own → a cashier's own sales, or a customer's own purchases
 *  - invoices.view_own / payments.view_own → the signed-in customer's records
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { can, requirePermission, stationScope } from '../middleware/auth.js';
import { cancelSale, createSale, decideRefund, recordSettledPayment, requestRefund, SALE_METHODS } from '../services/billing.js';
import { processProviderRefund } from '../services/payments/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { id, liters, money, optionalText, paging } from '../lib/validation.js';
import { addDays, parseDay } from '../lib/dates.js';
import { audit } from '../lib/audit.js';

const router = express.Router();
const NONE = '__none__'; // matches nothing — used when a scoped user has no linked record

// ─── Scoping ─────────────────────────────────────────────────

export function salesScope(req) {
  if (can(req.user, 'sales.view')) {
    const stationId = stationScope(req);
    return stationId ? { stationId } : {};
  }
  if (req.user.role === 'customer') return { customerId: req.user.customerId ?? NONE };
  return { cashierId: req.user.id };
}

export function invoiceScope(req) {
  if (can(req.user, 'invoices.view')) {
    const stationId = stationScope(req);
    return stationId ? { stationId } : {};
  }
  return { customerId: req.user.customerId ?? NONE };
}

function dateRange(query, field) {
  const where = {};
  if (query.from) (where[field] ||= {}).gte = parseDay(String(query.from), 'from');
  if (query.to) (where[field] ||= {}).lt = addDays(parseDay(String(query.to), 'to'), 1);
  return where;
}

// ─── Sales ───────────────────────────────────────────────────

const saleDetail = {
  items: { include: { product: { select: { name: true, code: true } }, tank: { select: { code: true } }, nozzle: { select: { code: true, pump: { select: { code: true } } } } } },
  customer: { select: { id: true, customerNo: true, name: true, phone: true } },
  cashier: { select: { name: true } },
  station: { select: { name: true, code: true, address: true, phone: true } },
  discountApprovedBy: { select: { name: true } },
  invoice: { include: { payments: { orderBy: { createdAt: 'asc' } }, refunds: { orderBy: { createdAt: 'asc' } } } },
};

router.get('/sales', requirePermission('sales.view', 'sales.view_own'), async (req, res) => {
  const { skip, take, page, pageSize } = paging(req.query);
  const q = req.query.search ? String(req.query.search).trim() : '';
  const where = {
    ...salesScope(req),
    ...dateRange(req.query, 'saleDate'),
    ...(req.query.status ? { status: String(req.query.status) } : {}),
    ...(req.query.customerId && can(req.user, 'sales.view') ? { customerId: String(req.query.customerId) } : {}),
    ...(q ? { OR: [
      { saleNo: { contains: q, mode: 'insensitive' } },
      { walkInName: { contains: q, mode: 'insensitive' } },
      { customer: { name: { contains: q, mode: 'insensitive' } } },
      { invoice: { invoiceNo: { contains: q, mode: 'insensitive' } } },
    ] } : {}),
  };
  const [sales, total, sums] = await Promise.all([
    prisma.sale.findMany({
      where, skip, take, orderBy: { saleDate: 'desc' },
      include: {
        items: { select: { quantity: true, unitPrice: true, product: { select: { name: true } } } },
        customer: { select: { name: true } },
        cashier: { select: { name: true } },
        invoice: { select: { id: true, invoiceNo: true, status: true, amountPaid: true, total: true } },
      },
    }),
    prisma.sale.count({ where }),
    prisma.sale.aggregate({ where: { ...where, status: { not: 'CANCELLED' } }, _sum: { total: true }, _count: true }),
  ]);
  const liters = await prisma.saleItem.aggregate({ where: { sale: { ...where, status: { not: 'CANCELLED' } } }, _sum: { quantity: true } });
  res.json({ sales, total, page, pageSize, summary: { revenue: sums._sum.total ?? 0, transactions: sums._count, liters: liters._sum.quantity ?? 0 } });
});

router.get('/sales/:id', requirePermission('sales.view', 'sales.view_own'), async (req, res) => {
  const sale = await prisma.sale.findFirst({ where: { id: req.params.id, ...salesScope(req) }, include: saleDetail });
  if (!sale) throw notFound('Sale not found');
  res.json({ sale });
});

const saleBody = z.object({
  idempotencyKey: z.string().trim().min(8).max(64),
  stationId: id.optional(),
  items: z.array(z.object({
    nozzleId: id.optional(),
    tankId: id.optional(),
    quantity: liters({ positive: true, max: 100000 }),
    discount: money().optional(),
  }).refine((i) => i.nozzleId || i.tankId, 'Choose a pump nozzle or tank')).min(1).max(10),
  customerId: id.optional().nullable(),
  walkInName: optionalText(100),
  walkInPhone: optionalText(30),
  paymentMethod: z.enum(SALE_METHODS),
  amountTendered: money().optional(),
  paymentReference: optionalText(100),
  discountApproval: z.object({ email: z.string().max(200), password: z.string().max(128) }).optional(),
  notes: optionalText(500),
});

router.post('/sales', requirePermission('sales.create'), async (req, res) => {
  const body = saleBody.parse(req.body);
  const { saleId, replayed } = await createSale(req, body);
  const sale = await prisma.sale.findUnique({ where: { id: saleId }, include: saleDetail });
  const change = body.paymentMethod === 'CASH' && body.amountTendered ? body.amountTendered.minus(sale.total) : null;
  res.status(replayed ? 200 : 201).json({ sale, replayed, change });
});

router.post('/sales/:id/cancel', requirePermission('sales.cancel'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500) }).parse(req.body);
  await cancelSale(req, req.params.id, reason);
  res.json({ sale: await prisma.sale.findUnique({ where: { id: req.params.id }, include: saleDetail }) });
});

// ─── Invoices ────────────────────────────────────────────────

router.get('/invoices', requirePermission('invoices.view', 'invoices.view_own'), async (req, res) => {
  const { skip, take, page, pageSize } = paging(req.query);
  const q = req.query.search ? String(req.query.search).trim() : '';
  const status = req.query.status ? String(req.query.status).split(',') : null;
  const where = {
    ...invoiceScope(req),
    ...dateRange(req.query, 'issueDate'),
    ...(status ? { status: { in: status } } : {}),
    ...(req.query.customerId && can(req.user, 'invoices.view') ? { customerId: String(req.query.customerId) } : {}),
    ...(req.query.overdue === 'true' ? { status: { in: ['UNPAID', 'PARTIALLY_PAID'] }, dueDate: { lt: new Date() } } : {}),
    ...(q ? { OR: [
      { invoiceNo: { contains: q, mode: 'insensitive' } },
      { customer: { name: { contains: q, mode: 'insensitive' } } },
      { sale: { walkInName: { contains: q, mode: 'insensitive' } } },
    ] } : {}),
  };
  const [invoices, total, open] = await Promise.all([
    prisma.invoice.findMany({
      where, skip, take, orderBy: { issueDate: 'desc' },
      include: {
        customer: { select: { name: true, customerNo: true } },
        sale: { select: { saleNo: true, walkInName: true } },
        payments: { where: { status: 'PENDING' }, select: { id: true, method: true } },
      },
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where: { ...where, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } }, _sum: { total: true, amountPaid: true }, _count: true }),
  ]);
  res.json({
    invoices, total, page, pageSize,
    summary: { openInvoices: open._count, outstanding: Number(open._sum.total ?? 0) - Number(open._sum.amountPaid ?? 0) },
  });
});

router.get('/invoices/:id', requirePermission('invoices.view', 'invoices.view_own'), async (req, res) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, ...invoiceScope(req) },
    include: {
      sale: { include: { items: { include: { product: { select: { name: true, unit: true } }, nozzle: { select: { code: true, pump: { select: { code: true } } } } } }, cashier: { select: { name: true } } } },
      customer: true,
      station: true,
      payments: { orderBy: { createdAt: 'asc' }, include: { initiatedBy: { select: { name: true } } } },
      refunds: { orderBy: { createdAt: 'asc' }, include: { requestedBy: { select: { name: true } }, approvedBy: { select: { name: true } } } },
    },
  });
  if (!invoice) throw notFound('Invoice not found');
  res.json({ invoice });
});

// Manual settlement (cash / bank transfer), full or partial
router.post('/invoices/:id/payments', requirePermission('payments.receive'), async (req, res) => {
  const body = z.object({
    amount: money({ positive: true }),
    method: z.enum(['CASH', 'BANK_TRANSFER']),
    reference: optionalText(100),
    idempotencyKey: z.string().trim().min(8).max(64),
  }).parse(req.body);
  const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, ...invoiceScope(req) } });
  if (!invoice) throw notFound('Invoice not found');
  if (body.method === 'BANK_TRANSFER' && !body.reference) throw badRequest('Enter the bank transfer reference');

  const result = await prisma.$transaction((tx) => recordSettledPayment(tx, req, {
    invoiceId: invoice.id, amount: body.amount, method: body.method, reference: body.reference, idempotencyKey: `manual:${body.idempotencyKey}`,
  }));
  const updated = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  res.status(result.replayed ? 200 : 201).json({ payment: result.payment, invoice: updated, replayed: result.replayed });
});

// ─── Payments ────────────────────────────────────────────────

router.get('/payments', requirePermission('payments.view', 'payments.view_own'), async (req, res) => {
  const { skip, take, page, pageSize } = paging(req.query);
  const scope = can(req.user, 'payments.view')
    ? (stationScope(req) ? { invoice: { stationId: stationScope(req) } } : {})
    : { customerId: req.user.customerId ?? NONE };
  const where = {
    ...scope,
    ...dateRange(req.query, 'createdAt'),
    ...(req.query.method ? { method: String(req.query.method) } : {}),
    ...(req.query.status ? { status: String(req.query.status) } : {}),
  };
  const [payments, total, byMethod] = await Promise.all([
    prisma.payment.findMany({
      where, skip, take, orderBy: { createdAt: 'desc' },
      include: { invoice: { select: { invoiceNo: true } }, customer: { select: { name: true } }, initiatedBy: { select: { name: true } } },
    }),
    prisma.payment.count({ where }),
    prisma.payment.groupBy({ by: ['method'], where: { ...where, status: 'SUCCESSFUL' }, _sum: { amount: true }, _count: true }),
  ]);
  res.json({ payments, total, page, pageSize, byMethod: byMethod.map((m) => ({ method: m.method, amount: m._sum.amount ?? 0, count: m._count })) });
});

// ─── Refunds ─────────────────────────────────────────────────

router.get('/refunds', requirePermission('refunds.request', 'refunds.approve'), async (req, res) => {
  const stationId = stationScope(req);
  const refunds = await prisma.refund.findMany({
    where: {
      ...(stationId ? { invoice: { stationId } } : {}),
      ...(req.query.status ? { status: String(req.query.status) } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      invoice: { select: { invoiceNo: true, total: true, customer: { select: { name: true } } } },
      payment: { select: { method: true, paymentNo: true } },
      requestedBy: { select: { id: true, name: true } },
      approvedBy: { select: { name: true } },
    },
  });
  res.json({ refunds });
});

router.post('/invoices/:id/refunds', requirePermission('refunds.request'), async (req, res) => {
  const body = z.object({
    amount: money({ positive: true }),
    paymentId: id.optional().nullable(),
    reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500),
  }).parse(req.body);
  const refund = await requestRefund(req, { invoiceId: req.params.id, paymentId: body.paymentId, amount: body.amount, reason: body.reason });
  res.status(201).json({ refund });
});

const decide = (approve) => async (req, res) => {
  const { note } = z.object({ note: optionalText(500) }).parse(req.body ?? {});
  let refund = await decideRefund(req, req.params.id, approve, note);
  let providerError = null;
  // electronic refunds go straight to the provider; if that fails the refund stays APPROVED and can be retried
  if (refund.status === 'APPROVED') {
    try {
      refund = await processProviderRefund(req, refund.id);
    } catch (err) {
      providerError = err.message;
    }
  }
  res.json({ refund, providerError });
};
router.post('/refunds/:id/approve', requirePermission('refunds.approve'), decide(true));
router.post('/refunds/:id/reject', requirePermission('refunds.approve'), decide(false));
router.post('/refunds/:id/process', requirePermission('refunds.approve'), async (req, res) => {
  res.json({ refund: await processProviderRefund(req, req.params.id) });
});

// Receipt reprints are audited so duplicate receipts can be traced
router.post('/invoices/:id/print', requirePermission('invoices.view', 'invoices.view_own'), async (req, res) => {
  const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, ...invoiceScope(req) }, select: { id: true, invoiceNo: true } });
  if (!invoice) throw notFound('Invoice not found');
  await audit(prisma, req, { action: 'invoice.print', entityType: 'Invoice', entityId: invoice.id, details: `Printed ${invoice.invoiceNo}` });
  res.json({ ok: true });
});

export default router;

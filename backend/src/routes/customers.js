/**
 * /api/customers — registration, credit settings, balances, statements, portal logins.
 *
 * Balance = Σ(total − amountPaid) over the customer's non-cancelled invoices.
 * Refunds are a credit note plus a cash payout, so they do not change the balance.
 * Credit fields (creditAllowed, creditLimit) need customers.credit.manage.
 */
import express from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { can, requirePermission } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { nextDocNumber } from '../lib/numbering.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { money, optionalText } from '../lib/validation.js';
import { addDays, parseDay, startOfDay, toDayString } from '../lib/dates.js';
import { hashPassword, passwordSchema } from '../auth/password.js';

const router = express.Router();
const D = (v) => new Prisma.Decimal(v);

async function balances(customerIds) {
  if (!customerIds.length) return {};
  const rows = await prisma.invoice.groupBy({
    by: ['customerId'],
    where: { customerId: { in: customerIds }, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
    _sum: { total: true, amountPaid: true },
    _count: true,
  });
  return Object.fromEntries(rows.map((r) => [r.customerId, { outstanding: D(r._sum.total ?? 0).minus(r._sum.amountPaid ?? 0), openInvoices: r._count }]));
}

const withBalance = (c, b) => ({
  ...c,
  outstanding: b?.outstanding ?? D(0),
  openInvoices: b?.openInvoices ?? 0,
  availableCredit: c.creditAllowed ? Prisma.Decimal.max(D(0), D(c.creditLimit).minus(b?.outstanding ?? 0)) : D(0),
});

// Customers may only read their own account
function assertCustomerAccess(req, customerId) {
  if (can(req.user, 'customers.view')) return;
  if (req.user.customerId && req.user.customerId === customerId) return;
  throw forbidden();
}

router.get('/customers', requirePermission('customers.view'), async (req, res) => {
  const q = req.query.search ? String(req.query.search).trim() : '';
  const customers = await prisma.customer.findMany({
    where: {
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      ...(req.query.credit === 'true' ? { creditAllowed: true } : {}),
      ...(q ? { OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { customerNo: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { email: { contains: q, mode: 'insensitive' } },
      ] } : {}),
    },
    orderBy: { name: 'asc' },
    take: req.query.limit ? Math.min(200, Number(req.query.limit) || 50) : 500,
    include: { user: { select: { email: true, status: true } } },
  });
  const b = await balances(customers.map((c) => c.id));
  res.json({ customers: customers.map((c) => withBalance(c, b[c.id])) });
});

// The signed-in customer's own account
router.get('/customers/me', requirePermission('invoices.view_own'), async (req, res) => {
  if (!req.user.customerId) throw notFound('No customer account is linked to this login');
  const customer = await prisma.customer.findUnique({ where: { id: req.user.customerId } });
  const b = await balances([customer.id]);
  res.json({ customer: withBalance(customer, b[customer.id]) });
});

router.get('/customers/:id', requirePermission('customers.view', 'invoices.view_own'), async (req, res) => {
  assertCustomerAccess(req, req.params.id);
  const customer = await prisma.customer.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { email: true, status: true } }, vehicles: { select: { id: true, registrationNumber: true, name: true } } },
  });
  if (!customer) throw notFound('Customer not found');
  const [b, stats] = await Promise.all([
    balances([customer.id]),
    prisma.sale.aggregate({ where: { customerId: customer.id, status: { not: 'CANCELLED' } }, _sum: { total: true }, _count: true }),
  ]);
  res.json({ customer: { ...withBalance(customer, b[customer.id]), lifetimeSpend: stats._sum.total ?? 0, transactions: stats._count } });
});

const customerBody = z.object({
  type: z.enum(['INDIVIDUAL', 'BUSINESS']).default('INDIVIDUAL'),
  name: z.string().trim().min(2).max(120),
  phone: optionalText(30),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email()]).optional().nullable().transform((v) => v || null),
  address: optionalText(250),
  creditAllowed: z.boolean().optional(),
  creditLimit: money().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

function assertCreditPermission(req, body) {
  if ((body.creditAllowed !== undefined || body.creditLimit !== undefined) && !can(req.user, 'customers.credit.manage')) {
    throw forbidden('Only authorized staff can grant credit or change credit limits');
  }
}

router.post('/customers', requirePermission('customers.manage'), async (req, res) => {
  const body = customerBody.parse(req.body);
  assertCreditPermission(req, body);
  if (body.phone && await prisma.customer.findFirst({ where: { phone: body.phone } })) throw conflict('A customer with this phone number already exists');

  const customer = await prisma.$transaction(async (tx) => {
    const customerNo = await nextDocNumber(tx, 'customer');
    const c = await tx.customer.create({ data: { ...body, customerNo } });
    await audit(tx, req, { action: 'customer.create', entityType: 'Customer', entityId: c.id, details: `Registered ${customerNo} ${c.name}${c.creditAllowed ? ` with credit limit ${c.creditLimit}` : ''}` });
    return c;
  });
  res.status(201).json({ customer: withBalance(customer) });
});

router.patch('/customers/:id', requirePermission('customers.manage', 'customers.credit.manage'), async (req, res) => {
  const body = customerBody.partial().parse(req.body);
  assertCreditPermission(req, body);
  const profileFields = ['type', 'name', 'phone', 'email', 'address', 'status'].filter((k) => body[k] !== undefined);
  if (profileFields.length && !can(req.user, 'customers.manage')) throw forbidden('You can only change credit settings');

  const existing = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!existing) throw notFound('Customer not found');
  const customer = await prisma.$transaction(async (tx) => {
    const c = await tx.customer.update({ where: { id: existing.id }, data: body });
    const creditChanged = c.creditAllowed !== existing.creditAllowed || !c.creditLimit.equals(existing.creditLimit);
    await audit(tx, req, {
      action: creditChanged ? 'customer.credit_change' : 'customer.update', entityType: 'Customer', entityId: c.id,
      details: creditChanged ? `${c.name}: credit ${existing.creditAllowed ? existing.creditLimit : 'off'} → ${c.creditAllowed ? c.creditLimit : 'off'}` : `Updated ${c.name}`,
      before: { name: existing.name, phone: existing.phone, creditAllowed: existing.creditAllowed, creditLimit: existing.creditLimit, status: existing.status },
      after: { name: c.name, phone: c.phone, creditAllowed: c.creditAllowed, creditLimit: c.creditLimit, status: c.status },
    });
    return c;
  });
  const b = await balances([customer.id]);
  res.json({ customer: withBalance(customer, b[customer.id]) });
});

// SECTION: statement — opening balance, invoices (debit), payments (credit), running balance
router.get('/customers/:id/statement', requirePermission('customers.view', 'invoices.view_own'), async (req, res) => {
  assertCustomerAccess(req, req.params.id);
  const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!customer) throw notFound('Customer not found');
  const to = req.query.to ? parseDay(String(req.query.to), 'to') : startOfDay();
  const from = req.query.from ? parseDay(String(req.query.from), 'from') : addDays(to, -89);
  if (to < from) throw badRequest('"to" must be on or after "from"');
  const end = addDays(to, 1);

  const invoiceWhere = { customerId: customer.id, status: { not: 'CANCELLED' } };
  const paymentWhere = { customerId: customer.id, status: { in: ['SUCCESSFUL', 'REFUNDED'] } };
  const [invBefore, payBefore, invoices, payments] = await Promise.all([
    prisma.invoice.aggregate({ where: { ...invoiceWhere, issueDate: { lt: from } }, _sum: { total: true } }),
    prisma.payment.aggregate({ where: { ...paymentWhere, verifiedAt: { lt: from } }, _sum: { amount: true } }),
    prisma.invoice.findMany({ where: { ...invoiceWhere, issueDate: { gte: from, lt: end } }, select: { id: true, invoiceNo: true, issueDate: true, dueDate: true, total: true, status: true } }),
    prisma.payment.findMany({ where: { ...paymentWhere, verifiedAt: { gte: from, lt: end } }, select: { id: true, paymentNo: true, verifiedAt: true, amount: true, method: true, invoice: { select: { invoiceNo: true } } } }),
  ]);

  const opening = D(invBefore._sum.total ?? 0).minus(payBefore._sum.amount ?? 0);
  const entries = [
    ...invoices.map((i) => ({ date: i.issueDate, type: 'INVOICE', reference: i.invoiceNo, description: `Invoice${i.dueDate ? ` (due ${toDayString(i.dueDate)})` : ''}`, debit: i.total, credit: D(0), status: i.status })),
    ...payments.map((p) => ({ date: p.verifiedAt, type: 'PAYMENT', reference: p.paymentNo, description: `${p.method.replace('_', ' ')} payment — ${p.invoice.invoiceNo}`, debit: D(0), credit: p.amount })),
  ].sort((a, b) => a.date - b.date);
  let running = opening;
  for (const e of entries) {
    running = running.plus(e.debit).minus(e.credit);
    e.balance = running;
  }
  await audit(prisma, req, { action: 'customer.statement', entityType: 'Customer', entityId: customer.id, details: `Statement ${toDayString(from)} – ${toDayString(to)}` });
  res.json({
    customer, from: toDayString(from), to: toDayString(to), opening, closing: running, entries,
    totals: { invoiced: entries.reduce((s, e) => s.plus(e.debit), D(0)), paid: entries.reduce((s, e) => s.plus(e.credit), D(0)) },
  });
});

// SECTION: give a customer a portal login (role "customer") linked to their account
router.post('/customers/:id/portal-access', requirePermission('users.manage'), async (req, res) => {
  const body = z.object({ email: z.string().trim().toLowerCase().email(), password: passwordSchema }).parse(req.body);
  const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!customer) throw notFound('Customer not found');
  if (customer.userId) throw conflict('This customer already has a portal login');
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'customer' } });

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email: body.email, name: customer.name, phone: customer.phone, roleId: role.id, passwordHash: await hashPassword(body.password) } });
    await tx.customer.update({ where: { id: customer.id }, data: { userId: u.id } });
    await audit(tx, req, { action: 'customer.portal_access', entityType: 'Customer', entityId: customer.id, details: `Created portal login ${u.email} for ${customer.name}` });
    return u;
  });
  res.status(201).json({ user: { id: user.id, email: user.email } });
});

export default router;

/**
 * /api — expenses (with approval), expense categories, employees, financial statements.
 *
 * Expenses recorded by someone holding expenses.approve are approved at once;
 * otherwise they wait for approval by a different person (super admins may
 * approve their own). Only APPROVED expenses count in profit and cash reports.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { can, requirePermission, stationScope } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { nextDocNumber } from '../lib/numbering.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { id, money, optionalText, paging, dayString } from '../lib/validation.js';
import { addDays, parseDay, resolveRange, toDayString } from '../lib/dates.js';
import { cashFlow, monthlyTrend, payablesAging, profitAndLoss, receivablesAging } from '../services/finance.js';

const router = express.Router();
const day = dayString.transform((v) => parseDay(v, 'date'));

// ─── Expense categories ──────────────────────────────────────

router.get('/expense-categories', requirePermission('expenses.view', 'expenses.manage'), async (req, res) => {
  res.json({ categories: await prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } }) });
});

router.post('/expense-categories', requirePermission('expenses.approve', 'settings.manage'), async (req, res) => {
  const body = z.object({ name: z.string().trim().min(2).max(60), type: z.enum(['OPERATIONAL', 'EMPLOYEE', 'MAINTENANCE', 'UTILITY', 'OTHER']) }).parse(req.body);
  const category = await prisma.expenseCategory.create({ data: body });
  await audit(prisma, req, { action: 'expense_category.create', entityType: 'ExpenseCategory', entityId: category.id, details: `Added category ${body.name}` });
  res.status(201).json({ category });
});

// ─── Expenses ────────────────────────────────────────────────

const expenseInclude = {
  category: { select: { id: true, name: true, type: true } },
  station: { select: { name: true } },
  employee: { select: { id: true, fullName: true } },
  recordedBy: { select: { id: true, name: true } },
  approvedBy: { select: { name: true } },
};

router.get('/expenses', requirePermission('expenses.view', 'expenses.manage'), async (req, res) => {
  const stationId = stationScope(req);
  const { skip, take, page, pageSize } = paging(req.query);
  const dates = {};
  if (req.query.from) (dates.expenseDate ||= {}).gte = parseDay(String(req.query.from), 'from');
  if (req.query.to) (dates.expenseDate ||= {}).lt = addDays(parseDay(String(req.query.to), 'to'), 1);
  const where = {
    ...(stationId ? { stationId } : {}),
    ...dates,
    ...(req.query.status ? { status: String(req.query.status) } : {}),
    ...(req.query.categoryId ? { categoryId: String(req.query.categoryId) } : {}),
  };
  const [expenses, total, approved, pending, byCategory] = await Promise.all([
    prisma.expense.findMany({ where, skip, take, orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }], include: expenseInclude }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where: { ...where, status: 'APPROVED' }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { ...where, status: 'PENDING' }, _sum: { amount: true }, _count: true }),
    prisma.expense.groupBy({ by: ['categoryId'], where: { ...where, status: 'APPROVED' }, _sum: { amount: true } }),
  ]);
  const cats = Object.fromEntries((await prisma.expenseCategory.findMany()).map((c) => [c.id, c.name]));
  res.json({
    expenses, total, page, pageSize,
    summary: {
      approved: approved._sum.amount ?? 0, pendingCount: pending._count, pending: pending._sum.amount ?? 0,
      byCategory: byCategory.map((c) => ({ category: cats[c.categoryId], amount: c._sum.amount ?? 0 })).sort((a, b) => b.amount - a.amount),
    },
  });
});

const expenseBody = z.object({
  stationId: id.optional(),
  categoryId: id,
  employeeId: id.optional().nullable(),
  amount: money({ positive: true, max: 100000000 }),
  description: z.string().trim().min(3).max(500),
  vendor: optionalText(120),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'ZAAD', 'EDAHAB']).default('CASH'),
  expenseDate: day,
});

router.post('/expenses', requirePermission('expenses.manage'), async (req, res) => {
  const body = expenseBody.parse(req.body);
  const stationId = req.user.stationId ?? body.stationId;
  if (!stationId) throw badRequest('Select the station this expense belongs to');
  if (body.expenseDate > new Date()) throw badRequest('Expense date cannot be in the future');
  if (!(await prisma.expenseCategory.findUnique({ where: { id: body.categoryId } }))) throw badRequest('Unknown category');
  if (body.employeeId) {
    const emp = await prisma.employee.findUnique({ where: { id: body.employeeId } });
    if (!emp || emp.stationId !== stationId) throw badRequest('Employee must belong to the same station');
  }
  const autoApprove = can(req.user, 'expenses.approve');

  const expense = await prisma.$transaction(async (tx) => {
    const expenseNo = await nextDocNumber(tx, 'expense');
    const e = await tx.expense.create({
      data: {
        ...body, stationId, expenseNo, employeeId: body.employeeId ?? null, recordedById: req.user.id,
        status: autoApprove ? 'APPROVED' : 'PENDING', approvedById: autoApprove ? req.user.id : null,
      },
      include: expenseInclude,
    });
    await audit(tx, req, { action: 'expense.create', entityType: 'Expense', entityId: e.id, details: `${expenseNo}: ${e.category.name} ${e.amount} — ${e.description} (${e.status})` });
    if (!autoApprove) await notify(tx, { type: 'INFO', title: 'Expense awaiting approval', message: `${expenseNo}: ${e.category.name} ${e.amount}`, link: '#expenses' });
    return e;
  });
  res.status(201).json({ expense });
});

router.patch('/expenses/:id', requirePermission('expenses.manage'), async (req, res) => {
  const body = expenseBody.omit({ stationId: true }).partial().parse(req.body);
  const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
  if (!existing) throw notFound('Expense not found');
  if (req.user.stationId && existing.stationId !== req.user.stationId) throw forbidden();
  if (existing.status !== 'PENDING') throw conflict('Only pending expenses can be edited');
  if (existing.recordedById !== req.user.id && !can(req.user, 'expenses.approve')) throw forbidden('You can only edit expenses you recorded');
  const expense = await prisma.$transaction(async (tx) => {
    const e = await tx.expense.update({ where: { id: existing.id }, data: body, include: expenseInclude });
    await audit(tx, req, { action: 'expense.update', entityType: 'Expense', entityId: e.id, details: `Edited ${e.expenseNo}`, before: { amount: existing.amount, description: existing.description }, after: { amount: e.amount, description: e.description } });
    return e;
  });
  res.json({ expense });
});

const decide = (approve) => async (req, res) => {
  const { note } = z.object({ note: optionalText(300) }).parse(req.body ?? {});
  const expense = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT "id" FROM "Expense" WHERE "id" = ${req.params.id} FOR UPDATE`;
    if (!rows.length) throw notFound('Expense not found');
    const e = await tx.expense.findUnique({ where: { id: req.params.id } });
    if (req.user.stationId && e.stationId !== req.user.stationId) throw forbidden();
    if (e.status !== 'PENDING') throw conflict(`Expense was already ${e.status.toLowerCase()}`);
    if (e.recordedById === req.user.id && req.user.role !== 'super_admin') throw forbidden('You cannot approve your own expense');
    const updated = await tx.expense.update({ where: { id: e.id }, data: { status: approve ? 'APPROVED' : 'REJECTED', approvedById: req.user.id }, include: expenseInclude });
    await audit(tx, req, { action: approve ? 'expense.approve' : 'expense.reject', entityType: 'Expense', entityId: e.id, details: `${approve ? 'Approved' : 'Rejected'} ${e.expenseNo} (${e.amount})${note ? ` — ${note}` : ''}` });
    await notify(tx, { type: approve ? 'SUCCESS' : 'WARNING', title: `Expense ${approve ? 'approved' : 'rejected'}`, message: `${e.expenseNo}: ${e.amount}`, userId: e.recordedById, link: '#expenses' });
    return updated;
  });
  res.json({ expense });
};
router.post('/expenses/:id/approve', requirePermission('expenses.approve'), decide(true));
router.post('/expenses/:id/reject', requirePermission('expenses.approve'), decide(false));

// ─── Employees ───────────────────────────────────────────────

router.get('/employees', requirePermission('employees.manage', 'expenses.manage', 'users.view'), async (req, res) => {
  const stationId = stationScope(req);
  const showSalary = can(req.user, 'employees.manage', 'finance.view');
  const employees = await prisma.employee.findMany({
    where: { ...(stationId ? { stationId } : {}), ...(req.query.status ? { status: String(req.query.status) } : {}) },
    include: { station: { select: { id: true, name: true } }, user: { select: { email: true, role: { select: { name: true } } } } },
    orderBy: { fullName: 'asc' },
  });
  res.json({ employees: employees.map((e) => (showSalary ? e : { ...e, salary: null })) });
});

const employeeBody = z.object({
  fullName: z.string().trim().min(2).max(120),
  position: z.string().trim().min(2).max(80),
  phone: optionalText(30),
  hireDate: day.optional().nullable(),
  salary: money().optional().nullable(),
  stationId: id.optional(),
  userId: id.optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

router.post('/employees', requirePermission('employees.manage'), async (req, res) => {
  const body = employeeBody.parse(req.body);
  const stationId = req.user.stationId ?? body.stationId;
  if (!stationId) throw badRequest('Select the station');
  const employee = await prisma.$transaction(async (tx) => {
    const employeeNo = await nextDocNumber(tx, 'employee');
    const e = await tx.employee.create({ data: { ...body, stationId, employeeNo } });
    await audit(tx, req, { action: 'employee.create', entityType: 'Employee', entityId: e.id, details: `Added employee ${employeeNo} ${e.fullName} (${e.position})` });
    return e;
  });
  res.status(201).json({ employee });
});

router.patch('/employees/:id', requirePermission('employees.manage'), async (req, res) => {
  const body = employeeBody.omit({ stationId: true }).partial().parse(req.body);
  const existing = await prisma.employee.findUnique({ where: { id: req.params.id } });
  if (!existing) throw notFound('Employee not found');
  if (req.user.stationId && existing.stationId !== req.user.stationId) throw forbidden();
  const employee = await prisma.$transaction(async (tx) => {
    const e = await tx.employee.update({ where: { id: existing.id }, data: body });
    await audit(tx, req, { action: 'employee.update', entityType: 'Employee', entityId: e.id, details: `Updated ${e.fullName}`, before: { position: existing.position, salary: existing.salary, status: existing.status }, after: { position: e.position, salary: e.salary, status: e.status } });
    return e;
  });
  res.json({ employee });
});

// ─── Financial statements ────────────────────────────────────

router.get('/finance/summary', requirePermission('finance.view', 'reports.financial'), async (req, res) => {
  const range = resolveRange(req.query, { maxDays: 1100 });
  const stationId = stationScope(req);
  // trend: the 12 calendar months ending with the selected period
  const trendEnd = range.end;
  const trendStart = new Date(trendEnd.getFullYear(), trendEnd.getMonth() - 11, 1);
  const [pnl, cash, receivables, payables, trend] = await Promise.all([
    profitAndLoss({ start: range.start, end: range.end, stationId }),
    cashFlow({ start: range.start, end: range.end, stationId }),
    receivablesAging({ stationId }),
    payablesAging(),
    monthlyTrend({ start: trendStart, end: trendEnd, stationId }),
  ]);
  res.json({ range: { from: range.from, to: range.to, days: range.days }, generatedAt: toDayString(new Date()), pnl, cash, receivables, payables, trend });
});

export default router;

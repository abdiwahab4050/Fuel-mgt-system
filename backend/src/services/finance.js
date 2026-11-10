/**
 * Financial statements.
 *
 *  Revenue        = Σ (subtotal − discounts) of non-cancelled sales (tax excluded; tax is a liability)
 *  Refunds        = completed refunds in the period
 *  Cost of sales  = Σ liters × unit cost recorded on each SALE stock movement (cost at the time of sale)
 *  Gross profit   = revenue − refunds − cost of sales
 *  Expenses       = approved expenses in the period, by category
 *  Net profit     = gross profit − expenses
 *
 * Aging buckets are measured from the due date (issue date when there is none).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { env } from '../config/env.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const r2 = (d) => D(d).toDecimalPlaces(2).toNumber();

export async function costOfSales(start, end, stationId) {
  const stationSql = stationId ? Prisma.sql`AND s."stationId" = ${stationId}` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(SUM(-m."quantity" * COALESCE(m."unitCost", 0)), 0) AS cost
    FROM "StockMovement" m JOIN "Sale" s ON s."id" = m."referenceId"
    WHERE m."type" = 'SALE' AND m."referenceType" = 'Sale' AND s."status" <> 'CANCELLED'
      AND s."saleDate" >= ${start} AND s."saleDate" < ${end} ${stationSql}`;
  return D(rows[0].cost);
}

export async function profitAndLoss({ start, end, stationId }) {
  const saleWhere = { status: { not: 'CANCELLED' }, saleDate: { gte: start, lt: end }, ...(stationId ? { stationId } : {}) };
  const [sales, refunds, cogs, expenses, categories, deliveries] = await Promise.all([
    prisma.sale.aggregate({ where: saleWhere, _sum: { subtotal: true, discountTotal: true, taxTotal: true, total: true }, _count: true }),
    prisma.refund.aggregate({ where: { status: 'COMPLETED', decidedAt: { gte: start, lt: end }, ...(stationId ? { invoice: { stationId } } : {}) }, _sum: { amount: true } }),
    costOfSales(start, end, stationId),
    prisma.expense.groupBy({ by: ['categoryId'], where: { status: 'APPROVED', expenseDate: { gte: start, lt: end }, ...(stationId ? { stationId } : {}) }, _sum: { amount: true } }),
    prisma.expenseCategory.findMany(),
    prisma.fuelDelivery.aggregate({ where: { status: 'CONFIRMED', deliveryDate: { gte: start, lt: end }, ...(stationId ? { tank: { stationId } } : {}) }, _sum: { totalCost: true, quantityDelivered: true } }),
  ]);
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const revenue = D(sales._sum.subtotal).minus(D(sales._sum.discountTotal));
  const refunded = D(refunds._sum.amount);
  const grossProfit = revenue.minus(refunded).minus(cogs);
  const expenseLines = expenses
    .map((e) => ({ category: catById[e.categoryId]?.name ?? 'Other', type: catById[e.categoryId]?.type ?? 'OTHER', amount: r2(e._sum.amount) }))
    .sort((a, b) => b.amount - a.amount);
  const totalExpenses = expenses.reduce((s, e) => s.plus(D(e._sum.amount)), D(0));
  const netProfit = grossProfit.minus(totalExpenses);
  return {
    revenue: r2(revenue), discounts: r2(sales._sum.discountTotal), taxCollected: r2(sales._sum.taxTotal), grossSales: r2(sales._sum.total),
    transactions: sales._count, refunds: r2(refunded), costOfSales: r2(cogs), grossProfit: r2(grossProfit),
    grossMargin: revenue.isZero() ? 0 : r2(grossProfit.div(revenue).times(100)),
    expenses: expenseLines, totalExpenses: r2(totalExpenses), netProfit: r2(netProfit),
    netMargin: revenue.isZero() ? 0 : r2(netProfit.div(revenue).times(100)),
    purchases: { cost: r2(deliveries._sum.totalCost), liters: r2(deliveries._sum.quantityDelivered) },
  };
}

// SECTION: cash movements in the period (money actually received / paid out)
export async function cashFlow({ start, end, stationId }) {
  const [received, supplierPaid, expensesPaid, refunded] = await Promise.all([
    prisma.payment.groupBy({ by: ['method'], where: { status: { in: ['SUCCESSFUL', 'REFUNDED'] }, verifiedAt: { gte: start, lt: end }, ...(stationId ? { invoice: { stationId } } : {}) }, _sum: { amount: true } }),
    prisma.supplierPayment.groupBy({ by: ['method'], where: { paidAt: { gte: start, lt: end } }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { status: 'APPROVED', expenseDate: { gte: start, lt: end }, ...(stationId ? { stationId } : {}) }, _sum: { amount: true } }),
    prisma.refund.aggregate({ where: { status: 'COMPLETED', decidedAt: { gte: start, lt: end }, ...(stationId ? { invoice: { stationId } } : {}) }, _sum: { amount: true } }),
  ]);
  const inTotal = received.reduce((s, r) => s.plus(D(r._sum.amount)), D(0));
  const supplierTotal = supplierPaid.reduce((s, r) => s.plus(D(r._sum.amount)), D(0));
  const outTotal = supplierTotal.plus(D(expensesPaid._sum.amount)).plus(D(refunded._sum.amount));
  return {
    receivedByMethod: received.map((r) => ({ method: r.method, amount: r2(r._sum.amount) })),
    received: r2(inTotal),
    paidToSuppliers: r2(supplierTotal),
    supplierPaymentsByMethod: supplierPaid.map((r) => ({ method: r.method, amount: r2(r._sum.amount) })),
    expensesPaid: r2(expensesPaid._sum.amount),
    refundsPaid: r2(refunded._sum.amount),
    paidOut: r2(outTotal),
    net: r2(inTotal.minus(outTotal)),
  };
}

// SECTION: aging — receivables (customers) or payables (suppliers)
const BUCKETS = [['current', -Infinity, 0], ['1-30', 1, 30], ['31-60', 31, 60], ['61-90', 61, 90], ['90+', 91, Infinity]];

function bucketize(rows) {
  const now = Date.now();
  const buckets = Object.fromEntries(BUCKETS.map(([k]) => [k, 0]));
  const parties = {};
  for (const r of rows) {
    const days = Math.floor((now - new Date(r.due).getTime()) / 86400000);
    const [key] = BUCKETS.find(([, lo, hi]) => days >= lo && days <= hi);
    buckets[key] += r.balance;
    const p = (parties[r.partyId] ||= { id: r.partyId, name: r.party, total: 0, overdue: 0, oldestDays: 0 });
    p.total += r.balance;
    if (days > 0) p.overdue += r.balance;
    p.oldestDays = Math.max(p.oldestDays, days);
  }
  const round = (n) => Math.round(n * 100) / 100;
  return {
    total: round(rows.reduce((s, r) => s + r.balance, 0)),
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, round(v)])),
    parties: Object.values(parties).map((p) => ({ ...p, total: round(p.total), overdue: round(p.overdue) })).sort((a, b) => b.total - a.total),
  };
}

export async function receivablesAging({ stationId }) {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] }, ...(stationId ? { stationId } : {}) },
    select: { total: true, amountPaid: true, dueDate: true, issueDate: true, customerId: true, customer: { select: { name: true } } },
  });
  return bucketize(invoices.map((i) => ({
    balance: Number(i.total) - Number(i.amountPaid), due: i.dueDate ?? i.issueDate,
    partyId: i.customerId ?? 'walk-in', party: i.customer?.name ?? 'Walk-in customers',
  })));
}

export async function payablesAging() {
  const invoices = await prisma.supplierInvoice.findMany({
    where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
    select: { amount: true, amountPaid: true, dueDate: true, issueDate: true, supplierId: true, supplier: { select: { name: true } } },
  });
  return bucketize(invoices.map((i) => ({
    balance: Number(i.amount) - Number(i.amountPaid), due: i.dueDate ?? i.issueDate, partyId: i.supplierId, party: i.supplier.name,
  })));
}

// SECTION: monthly trend — revenue, cost of sales, expenses, profit per calendar month (station time zone)
export async function monthlyTrend({ start, end, stationId }) {
  const tz = env.APP_TIMEZONE;
  const st = stationId ? Prisma.sql`AND s."stationId" = ${stationId}` : Prisma.empty;
  const ex = stationId ? Prisma.sql`AND e."stationId" = ${stationId}` : Prisma.empty;
  const rf = stationId ? Prisma.sql`AND i."stationId" = ${stationId}` : Prisma.empty;
  const [rev, cogs, exp, refunds] = await Promise.all([
    prisma.$queryRaw`SELECT to_char((s."saleDate" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') AS month,
        SUM(s."subtotal" - s."discountTotal")::float8 AS revenue
      FROM "Sale" s WHERE s."status" <> 'CANCELLED' AND s."saleDate" >= ${start} AND s."saleDate" < ${end} ${st} GROUP BY 1`,
    prisma.$queryRaw`SELECT to_char((s."saleDate" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') AS month,
        SUM(-m."quantity" * COALESCE(m."unitCost", 0))::float8 AS cost
      FROM "StockMovement" m JOIN "Sale" s ON s."id" = m."referenceId"
      WHERE m."type" = 'SALE' AND m."referenceType" = 'Sale' AND s."status" <> 'CANCELLED' AND s."saleDate" >= ${start} AND s."saleDate" < ${end} ${st} GROUP BY 1`,
    prisma.$queryRaw`SELECT to_char(e."expenseDate", 'YYYY-MM') AS month, SUM(e."amount")::float8 AS expenses
      FROM "Expense" e WHERE e."status" = 'APPROVED' AND e."expenseDate" >= ${start} AND e."expenseDate" < ${end} ${ex} GROUP BY 1`,
    prisma.$queryRaw`SELECT to_char((r."decidedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') AS month, SUM(r."amount")::float8 AS refunds
      FROM "Refund" r JOIN "Invoice" i ON i."id" = r."invoiceId"
      WHERE r."status" = 'COMPLETED' AND r."decidedAt" >= ${start} AND r."decidedAt" < ${end} ${rf} GROUP BY 1`,
  ]);
  const months = {};
  const get = (m) => (months[m] ||= { month: m, revenue: 0, refunds: 0, costOfSales: 0, expenses: 0 });
  rev.forEach((r) => { get(r.month).revenue = r.revenue; });
  refunds.forEach((r) => { get(r.month).refunds = r.refunds; });
  cogs.forEach((r) => { get(r.month).costOfSales = r.cost; });
  exp.forEach((r) => { get(r.month).expenses = r.expenses; });
  // fill empty months so charts have no gaps
  for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return Object.values(months).sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({
    ...m,
    revenue: Math.round(m.revenue * 100) / 100,
    refunds: Math.round(m.refunds * 100) / 100,
    costOfSales: Math.round(m.costOfSales * 100) / 100,
    expenses: Math.round(m.expenses * 100) / 100,
    netProfit: Math.round((m.revenue - m.refunds - m.costOfSales - m.expenses) * 100) / 100,
  }));
}

/**
 * /api/dashboard — KPI summary for the selected period and station.
 *
 * Visibility:
 *  - sales.view          → all sales; otherwise (sales.view_own) only the user's own sales
 *  - finance.view / reports.financial → expenses, cost of sales, profit
 *  - customers.view / finance.view    → outstanding customer balances
 *  - fleet.view          → fleet status
 *  - audit.view          → recent activity feed
 */
import express from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { can, requirePermission, stationScope } from '../middleware/auth.js';
import { addDays, resolveRange, startOfDay, toDayString } from '../lib/dates.js';
import { profitAndLoss } from '../services/finance.js';

const router = express.Router();
const num = (d) => (d == null ? 0 : Number(d));

const VALID_SALE = { not: 'CANCELLED' };

async function revenueBetween(saleWhere, start, end) {
  const agg = await prisma.sale.aggregate({
    where: { ...saleWhere, saleDate: { gte: start, lt: end } },
    _sum: { total: true },
    _count: true,
  });
  return { revenue: num(agg._sum.total), transactions: agg._count };
}

router.get('/dashboard/summary', requirePermission('dashboard.view'), async (req, res) => {
  const user = req.user;
  const range = resolveRange(req.query);
  const stationId = stationScope(req);
  const ownOnly = !can(user, 'sales.view');
  const showFinance = can(user, 'finance.view', 'reports.financial');
  const showReceivables = can(user, 'customers.view', 'finance.view');

  const saleWhere = {
    status: VALID_SALE,
    ...(stationId ? { stationId } : {}),
    ...(ownOnly ? { cashierId: user.id } : {}),
  };
  const inRange = { gte: range.start, lt: range.end };
  const today = startOfDay();

  // SECTION: sales in the selected period
  const [periodSales, litersAgg, refundsAgg, periodCustomers, totalCustomers] = await Promise.all([
    revenueBetween(saleWhere, range.start, range.end),
    prisma.saleItem.aggregate({ where: { sale: { ...saleWhere, saleDate: inRange } }, _sum: { quantity: true, refundedQuantity: true } }),
    prisma.refund.aggregate({ where: { status: 'COMPLETED', decidedAt: inRange, ...(stationId ? { invoice: { stationId } } : {}) }, _sum: { amount: true } }),
    prisma.customer.count({ where: { createdAt: inRange } }),
    prisma.customer.count({ where: { status: 'ACTIVE' } }),
  ]);
  const refunds = ownOnly ? 0 : num(refundsAgg._sum.amount);
  const litersSold = num(litersAgg._sum.quantity) - num(litersAgg._sum.refundedQuantity);

  // SECTION: fixed windows — today, last 7 days, this month (independent of the filter)
  const [daily, weekly, monthly] = await Promise.all([
    revenueBetween(saleWhere, today, addDays(today, 1)),
    revenueBetween(saleWhere, addDays(today, -6), addDays(today, 1)),
    revenueBetween(saleWhere, new Date(today.getFullYear(), today.getMonth(), 1), addDays(today, 1)),
  ]);

  // SECTION: fuel purchased (confirmed deliveries) in period
  const deliveriesAgg = await prisma.fuelDelivery.aggregate({
    where: { status: 'CONFIRMED', deliveryDate: inRange, ...(stationId ? { tank: { stationId } } : {}) },
    _sum: { quantityDelivered: true, totalCost: true },
  });

  // SECTION: stock per tank + low-stock list
  const tanks = await prisma.tank.findMany({
    where: { status: { not: 'OUT_OF_SERVICE' }, ...(stationId ? { stationId } : {}) },
    include: { product: { select: { name: true, code: true } }, station: { select: { name: true } } },
    orderBy: [{ stationId: 'asc' }, { code: 'asc' }],
  });
  const stock = tanks.map((t) => ({
    tankId: t.id, tankCode: t.code, station: t.station.name, product: t.product.name, productCode: t.product.code,
    liters: num(t.currentLiters), capacity: num(t.capacityLiters), minLevel: num(t.minLevelLiters),
    percent: num(t.capacityLiters) ? Math.round((num(t.currentLiters) / num(t.capacityLiters)) * 100) : 0,
    low: num(t.currentLiters) <= num(t.minLevelLiters),
  }));

  // SECTION: daily series for charts (revenue + liters sold + liters purchased)
  const tz = env.APP_TIMEZONE;
  const stationSql = stationId ? Prisma.sql`AND s."stationId" = ${stationId}` : Prisma.empty;
  const ownSql = ownOnly ? Prisma.sql`AND s."cashierId" = ${user.id}` : Prisma.empty;
  const salesSeries = await prisma.$queryRaw`
    SELECT to_char(date_trunc('day', (s."saleDate" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day,
           SUM(s."total")::float8 AS revenue,
           COALESCE(SUM(i.liters), 0)::float8 AS liters
    FROM "Sale" s
    LEFT JOIN (SELECT "saleId", SUM("quantity" - "refundedQuantity") AS liters FROM "SaleItem" GROUP BY "saleId") i ON i."saleId" = s."id"
    WHERE s."status" <> 'CANCELLED' AND s."saleDate" >= ${range.start} AND s."saleDate" < ${range.end} ${stationSql} ${ownSql}
    GROUP BY 1`;
  const purchaseStationSql = stationId ? Prisma.sql`AND t."stationId" = ${stationId}` : Prisma.empty;
  const purchaseSeries = await prisma.$queryRaw`
    SELECT to_char(date_trunc('day', (d."deliveryDate" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day,
           SUM(d."quantityDelivered")::float8 AS liters
    FROM "FuelDelivery" d JOIN "Tank" t ON t."id" = d."tankId"
    WHERE d."status" = 'CONFIRMED' AND d."deliveryDate" >= ${range.start} AND d."deliveryDate" < ${range.end} ${purchaseStationSql}
    GROUP BY 1`;
  const salesByDay = Object.fromEntries(salesSeries.map((r) => [r.day, r]));
  const purchasesByDay = Object.fromEntries(purchaseSeries.map((r) => [r.day, r.liters]));
  const series = [];
  for (let d = range.start; d < range.end; d = addDays(d, 1)) {
    const key = toDayString(d);
    series.push({ day: key, revenue: salesByDay[key]?.revenue ?? 0, litersSold: salesByDay[key]?.liters ?? 0, litersPurchased: purchasesByDay[key] ?? 0 });
  }

  // SECTION: recent transactions
  const recentSales = await prisma.sale.findMany({
    where: { ...(stationId ? { stationId } : {}), ...(ownOnly ? { cashierId: user.id } : {}) },
    orderBy: { saleDate: 'desc' },
    take: 8,
    select: {
      id: true, saleNo: true, total: true, status: true, saleDate: true, walkInName: true,
      customer: { select: { name: true } },
      cashier: { select: { name: true } },
      invoice: { select: { invoiceNo: true, status: true } },
      items: { select: { quantity: true, product: { select: { name: true } } } },
    },
  });

  const summary = {
    range: { from: range.from, to: range.to, days: range.days },
    scope: { stationId: stationId ?? null, ownSalesOnly: ownOnly },
    sales: {
      revenue: periodSales.revenue,
      refunds,
      netRevenue: periodSales.revenue - refunds,
      transactions: periodSales.transactions,
      litersSold,
      today: daily, last7Days: weekly, thisMonth: monthly,
    },
    purchases: { liters: num(deliveriesAgg._sum.quantityDelivered), cost: num(deliveriesAgg._sum.totalCost) },
    customers: { total: totalCustomers, newInPeriod: periodCustomers },
    stock,
    lowStock: stock.filter((s) => s.low),
    series,
    recentTransactions: recentSales.map((s) => ({
      id: s.id, saleNo: s.saleNo, date: s.saleDate, status: s.status, total: num(s.total),
      customer: s.customer?.name ?? s.walkInName ?? 'Walk-in',
      cashier: s.cashier.name,
      invoiceNo: s.invoice?.invoiceNo ?? null, invoiceStatus: s.invoice?.status ?? null,
      products: [...new Set(s.items.map((i) => i.product.name))],
      liters: s.items.reduce((sum, i) => sum + num(i.quantity), 0),
    })),
  };

  // SECTION: receivables (customer debt)
  if (showReceivables) {
    const open = await prisma.invoice.aggregate({
      where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] }, ...(stationId ? { stationId } : {}) },
      _sum: { total: true, amountPaid: true },
      _count: true,
    });
    summary.receivables = { outstanding: num(open._sum.total) - num(open._sum.amountPaid), openInvoices: open._count };
  }

  // SECTION: finance — same figures as the Finance page (cost of sales at the cost recorded when each sale happened)
  if (showFinance) {
    const pnl = await profitAndLoss({ start: range.start, end: range.end, stationId });
    summary.finance = {
      costOfSales: pnl.costOfSales,
      grossProfit: pnl.grossProfit,
      expenses: pnl.totalExpenses,
      netProfit: pnl.netProfit,
      note: 'Revenue excludes tax. Cost of sales uses each sale\'s recorded cost.',
    };
  }

  // SECTION: fleet
  if (can(user, 'fleet.view')) {
    const byStatus = await prisma.vehicle.groupBy({ by: ['status'], _count: true });
    const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count]));
    summary.fleet = { total: byStatus.reduce((s, r) => s + r._count, 0), active: counts.ACTIVE ?? 0, maintenance: counts.MAINTENANCE ?? 0 };
  }

  // SECTION: activity feed
  if (can(user, 'audit.view')) {
    const logs = await prisma.auditLog.findMany({
      where: { action: { notIn: ['auth.login_failed'] } },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { id: true, action: true, details: true, createdAt: true, user: { select: { name: true } } },
    });
    summary.activity = logs.map((l) => ({ id: l.id, action: l.action, details: l.details, at: l.createdAt, user: l.user?.name ?? 'System' }));
  }

  const target = await prisma.setting.findUnique({ where: { key: 'dashboard.targetRevenue' } });
  summary.targetRevenue = num(target?.value);

  res.json(summary);
});

export default router;

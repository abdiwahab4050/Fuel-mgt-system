/**
 * Report registry. Every report returns the same shape so the UI, Excel and
 * CSV exports and printing share one renderer:
 *   { title, columns:[{key,label,type}], rows:[...], totals?, chart? }
 * Column types: text | number | money | liters | percent | date.
 *
 * `permissions` — the user needs at least one. Operational reports need reports.view;
 * financial ones need reports.financial or finance.view; the audit trail needs audit.view. Station-bound users are always
 * limited to their own station (ctx.stationId is already scoped by the route).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { payablesAging, profitAndLoss, receivablesAging } from './finance.js';
import { badRequest } from '../lib/errors.js';

const n = (v) => (v == null ? 0 : Number(v));
const r2 = (v) => Math.round(n(v) * 100) / 100;
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const sum = (rows, key) => rows.reduce((s, r) => s + n(r[key]), 0);
const tz = () => env.APP_TIMEZONE;
const stationSql = (alias, stationId) => (stationId ? Prisma.sql`AND ${Prisma.raw(`${alias}."stationId"`)} = ${stationId}` : Prisma.empty);
const METHOD = { CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', CREDIT_ACCOUNT: 'Credit account', ZAAD: 'ZAAD', EDAHAB: 'eDAHAB', MASTERCARD: 'Mastercard' };

const GROUPS = {
  day: { label: 'Daily', trunc: 'day', fmt: 'YYYY-MM-DD' },
  week: { label: 'Weekly', trunc: 'week', fmt: 'IYYY-"W"IW' },
  month: { label: 'Monthly', trunc: 'month', fmt: 'YYYY-MM' },
  year: { label: 'Annual', trunc: 'year', fmt: 'YYYY' },
};

export const REPORTS = {
  // ─── Sales ────────────────────────────────────────────────
  sales: {
    title: 'Sales Report', category: 'Sales', permissions: ['reports.view'], params: ['range', 'groupBy'],
    async run({ start, end, stationId, groupBy = 'day' }) {
      const g = GROUPS[groupBy];
      if (!g) throw badRequest('groupBy must be day, week, month or year');
      const rows = await prisma.$queryRaw`
        SELECT to_char(date_trunc(${g.trunc}, (s."saleDate" AT TIME ZONE 'UTC') AT TIME ZONE ${tz()}), ${g.fmt}) AS period,
               COUNT(*)::int AS transactions,
               SUM(s."subtotal" - s."discountTotal")::float8 AS revenue,
               SUM(s."discountTotal")::float8 AS discounts, SUM(s."taxTotal")::float8 AS tax, SUM(s."total")::float8 AS total,
               COALESCE(SUM(i.liters), 0)::float8 AS liters
        FROM "Sale" s
        LEFT JOIN (SELECT "saleId", SUM("quantity") AS liters FROM "SaleItem" GROUP BY "saleId") i ON i."saleId" = s."id"
        WHERE s."status" <> 'CANCELLED' AND s."saleDate" >= ${start} AND s."saleDate" < ${end} ${stationSql('s', stationId)}
        GROUP BY 1 ORDER BY 1`;
      const out = rows.map((r) => ({ ...r, liters: r3(r.liters), revenue: r2(r.revenue), discounts: r2(r.discounts), tax: r2(r.tax), total: r2(r.total), average: r.transactions ? r2(r.total / r.transactions) : 0 }));
      return {
        title: `${g.label} Sales`,
        columns: [
          { key: 'period', label: 'Period', type: 'text' }, { key: 'transactions', label: 'Sales', type: 'number' },
          { key: 'liters', label: 'Liters', type: 'liters' }, { key: 'revenue', label: 'Revenue (excl. tax)', type: 'money' },
          { key: 'discounts', label: 'Discounts', type: 'money' }, { key: 'tax', label: 'Tax', type: 'money' },
          { key: 'total', label: 'Total Billed', type: 'money' }, { key: 'average', label: 'Avg Sale', type: 'money' },
        ],
        rows: out,
        totals: { transactions: sum(out, 'transactions'), liters: r3(sum(out, 'liters')), revenue: r2(sum(out, 'revenue')), discounts: r2(sum(out, 'discounts')), tax: r2(sum(out, 'tax')), total: r2(sum(out, 'total')) },
        chart: { x: 'period', y: 'total', label: 'Total billed' },
      };
    },
  },

  'sales-by-product': {
    title: 'Sales by Fuel Product', category: 'Sales', permissions: ['reports.view'], params: ['range'],
    async run({ start, end, stationId }) {
      const rows = await prisma.$queryRaw`
        SELECT p."name" AS product, COUNT(DISTINCT s."id")::int AS transactions, SUM(i."quantity")::float8 AS liters,
               SUM(i."lineTotal")::float8 AS revenue
        FROM "SaleItem" i JOIN "Sale" s ON s."id" = i."saleId" JOIN "FuelProduct" p ON p."id" = i."productId"
        WHERE s."status" <> 'CANCELLED' AND s."saleDate" >= ${start} AND s."saleDate" < ${end} ${stationSql('s', stationId)}
        GROUP BY p."name" ORDER BY revenue DESC`;
      const total = sum(rows, 'revenue');
      const out = rows.map((r) => ({ ...r, liters: r3(r.liters), revenue: r2(r.revenue), avgPrice: r.liters ? Math.round((r.revenue / r.liters) * 10000) / 10000 : 0, share: total ? r2((r.revenue / total) * 100) : 0 }));
      return {
        title: 'Sales by Fuel Product',
        columns: [
          { key: 'product', label: 'Product', type: 'text' }, { key: 'transactions', label: 'Sales', type: 'number' },
          { key: 'liters', label: 'Liters', type: 'liters' }, { key: 'revenue', label: 'Revenue (excl. tax)', type: 'money' },
          { key: 'avgPrice', label: 'Avg Price / L', type: 'number' }, { key: 'share', label: 'Share', type: 'percent' },
        ],
        rows: out,
        totals: { liters: r3(sum(out, 'liters')), revenue: r2(total) },
        chart: { x: 'product', y: 'revenue', label: 'Revenue' },
      };
    },
  },

  'payment-methods': {
    title: 'Payment Methods', category: 'Sales', permissions: ['reports.view'], params: ['range'],
    async run({ start, end, stationId }) {
      const where = { verifiedAt: { gte: start, lt: end }, ...(stationId ? { invoice: { stationId } } : {}) };
      const [ok, refunded, failed] = await Promise.all([
        prisma.payment.groupBy({ by: ['method'], where: { ...where, status: { in: ['SUCCESSFUL', 'REFUNDED'] } }, _sum: { amount: true }, _count: true }),
        prisma.refund.groupBy({ by: ['paymentId'], where: { status: 'COMPLETED', decidedAt: { gte: start, lt: end }, ...(stationId ? { invoice: { stationId } } : {}) }, _sum: { amount: true } }),
        prisma.payment.groupBy({ by: ['method'], where: { createdAt: { gte: start, lt: end }, status: { in: ['FAILED', 'CANCELLED'] }, ...(stationId ? { invoice: { stationId } } : {}) }, _count: true }),
      ]);
      const refundPayments = await prisma.payment.findMany({ where: { id: { in: refunded.map((r) => r.paymentId).filter(Boolean) } }, select: { id: true, method: true } });
      const methodOf = Object.fromEntries(refundPayments.map((p) => [p.id, p.method]));
      const refundBy = {};
      for (const r of refunded) {
        const m = methodOf[r.paymentId] ?? 'CASH';
        refundBy[m] = (refundBy[m] ?? 0) + n(r._sum.amount);
      }
      const failedBy = Object.fromEntries(failed.map((f) => [f.method, f._count]));
      const total = ok.reduce((s, r) => s + n(r._sum.amount), 0);
      const rows = ok.map((r) => ({
        method: METHOD[r.method] ?? r.method, count: r._count, amount: r2(r._sum.amount), refunded: r2(refundBy[r.method]),
        net: r2(n(r._sum.amount) - n(refundBy[r.method])), share: total ? r2((n(r._sum.amount) / total) * 100) : 0, failed: failedBy[r.method] ?? 0,
      })).sort((a, b) => b.amount - a.amount);
      return {
        title: 'Payments by Method',
        columns: [
          { key: 'method', label: 'Method', type: 'text' }, { key: 'count', label: 'Payments', type: 'number' },
          { key: 'amount', label: 'Received', type: 'money' }, { key: 'refunded', label: 'Refunded', type: 'money' },
          { key: 'net', label: 'Net', type: 'money' }, { key: 'share', label: 'Share', type: 'percent' },
          { key: 'failed', label: 'Failed / Cancelled', type: 'number' },
        ],
        rows,
        totals: { count: sum(rows, 'count'), amount: r2(sum(rows, 'amount')), refunded: r2(sum(rows, 'refunded')), net: r2(sum(rows, 'net')), failed: sum(rows, 'failed') },
        chart: { x: 'method', y: 'amount', label: 'Received' },
      };
    },
  },

  // ─── Customers ────────────────────────────────────────────
  'customer-payments': {
    title: 'Customer Payments', category: 'Customers', permissions: ['reports.view'], params: ['range'],
    async run({ start, end, stationId }) {
      const payments = await prisma.payment.findMany({
        where: { status: { in: ['SUCCESSFUL', 'REFUNDED'] }, verifiedAt: { gte: start, lt: end }, ...(stationId ? { invoice: { stationId } } : {}) },
        include: { invoice: { select: { invoiceNo: true } }, customer: { select: { name: true, customerNo: true } }, initiatedBy: { select: { name: true } } },
        orderBy: { verifiedAt: 'asc' },
        take: 5000,
      });
      const rows = payments.map((p) => ({
        date: p.verifiedAt.toISOString().slice(0, 16).replace('T', ' '), paymentNo: p.paymentNo, invoiceNo: p.invoice.invoiceNo,
        customer: p.customer ? `${p.customer.name} (${p.customer.customerNo})` : 'Walk-in', method: METHOD[p.method] ?? p.method,
        reference: p.providerReference ?? '', amount: r2(p.amount), status: p.status, by: p.initiatedBy?.name ?? '',
      }));
      return {
        title: 'Customer Payments',
        columns: [
          { key: 'date', label: 'Date', type: 'text' }, { key: 'paymentNo', label: 'Payment #', type: 'text' }, { key: 'invoiceNo', label: 'Invoice #', type: 'text' },
          { key: 'customer', label: 'Customer', type: 'text' }, { key: 'method', label: 'Method', type: 'text' }, { key: 'reference', label: 'Reference', type: 'text' },
          { key: 'amount', label: 'Amount', type: 'money' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'by', label: 'Received by', type: 'text' },
        ],
        rows,
        totals: { amount: r2(sum(rows, 'amount')) },
      };
    },
  },

  'outstanding-debt': {
    title: 'Outstanding Customer Debt', category: 'Customers', permissions: ['reports.financial', 'finance.view'], params: [],
    async run({ stationId }) {
      const aging = await receivablesAging({ stationId });
      const customers = await prisma.customer.findMany({ where: { id: { in: aging.parties.map((p) => p.id).filter((id) => id !== 'walk-in') } }, select: { id: true, customerNo: true, phone: true, creditLimit: true, creditAllowed: true } });
      const byId = Object.fromEntries(customers.map((c) => [c.id, c]));
      const rows = aging.parties.map((p) => ({
        customer: p.name, customerNo: byId[p.id]?.customerNo ?? '', phone: byId[p.id]?.phone ?? '',
        creditLimit: byId[p.id]?.creditAllowed ? r2(byId[p.id].creditLimit) : null,
        outstanding: p.total, overdue: p.overdue, oldestDays: Math.max(0, p.oldestDays),
      }));
      return {
        title: 'Outstanding Customer Debt',
        columns: [
          { key: 'customer', label: 'Customer', type: 'text' }, { key: 'customerNo', label: 'Customer #', type: 'text' }, { key: 'phone', label: 'Phone', type: 'text' },
          { key: 'creditLimit', label: 'Credit Limit', type: 'money' }, { key: 'outstanding', label: 'Outstanding', type: 'money' },
          { key: 'overdue', label: 'Overdue', type: 'money' }, { key: 'oldestDays', label: 'Days Past Due', type: 'number' },
        ],
        rows,
        totals: { outstanding: aging.total, overdue: r2(sum(rows, 'overdue')) },
        summary: Object.entries(aging.buckets).map(([k, v]) => ({ label: k === 'current' ? 'Not due' : `${k} days`, value: v, type: 'money' })),
      };
    },
  },

  // ─── Inventory & operations ───────────────────────────────
  stock: {
    title: 'Stock Reconciliation', category: 'Inventory', permissions: ['reports.view'], params: ['range'],
    async run({ start, end, stationId }) {
      const tanks = await prisma.tank.findMany({ where: stationId ? { stationId } : {}, include: { product: { select: { name: true, costPrice: true } }, station: { select: { name: true } } }, orderBy: [{ stationId: 'asc' }, { code: 'asc' }] });
      const ids = tanks.map((t) => t.id);
      const [inRange, afterEnd] = await Promise.all([
        prisma.stockMovement.groupBy({ by: ['tankId', 'type'], where: { tankId: { in: ids }, createdAt: { gte: start, lt: end } }, _sum: { quantity: true } }),
        prisma.stockMovement.groupBy({ by: ['tankId'], where: { tankId: { in: ids }, createdAt: { gte: end } }, _sum: { quantity: true } }),
      ]);
      const mv = {};
      for (const m of inRange) (mv[m.tankId] ||= {})[m.type] = n(m._sum.quantity);
      const after = Object.fromEntries(afterEnd.map((a) => [a.tankId, n(a._sum.quantity)]));
      const rows = tanks.map((t) => {
        const m = mv[t.id] ?? {};
        const closing = n(t.currentLiters) - (after[t.id] ?? 0); // level at the end of the period
        const change = Object.values(m).reduce((s, v) => s + v, 0);
        return {
          tank: `${t.code}${stationId ? '' : ` · ${t.station.name}`}`, product: t.product.name,
          opening: r3(closing - change), received: r3((m.DELIVERY ?? 0) + (m.OPENING ?? 0)), sold: r3(-(m.SALE ?? 0) - (m.SALE_REVERSAL ?? 0)),
          losses: r3(-(m.LOSS ?? 0)), adjustments: r3(m.ADJUSTMENT ?? 0), transfers: r3((m.TRANSFER_IN ?? 0) + (m.TRANSFER_OUT ?? 0)),
          closing: r3(closing), capacity: r3(t.capacityLiters), value: r2(closing * n(t.product.costPrice)),
        };
      });
      return {
        title: 'Stock Reconciliation',
        columns: [
          { key: 'tank', label: 'Tank', type: 'text' }, { key: 'product', label: 'Product', type: 'text' },
          { key: 'opening', label: 'Opening', type: 'liters' }, { key: 'received', label: 'Received', type: 'liters' },
          { key: 'sold', label: 'Sold', type: 'liters' }, { key: 'losses', label: 'Losses', type: 'liters' },
          { key: 'adjustments', label: 'Adjustments', type: 'liters' }, { key: 'transfers', label: 'Transfers (net)', type: 'liters' },
          { key: 'closing', label: 'Closing', type: 'liters' }, { key: 'capacity', label: 'Capacity', type: 'liters' },
          { key: 'value', label: 'Stock Value (cost)', type: 'money' },
        ],
        rows,
        totals: Object.fromEntries(['opening', 'received', 'sold', 'losses', 'adjustments', 'transfers', 'closing'].map((k) => [k, r3(sum(rows, k))]).concat([['value', r2(sum(rows, 'value'))]])),
        note: 'Opening + received − sold − losses ± adjustments ± transfers = closing. Received includes opening-stock entries made in the period.',
      };
    },
  },

  'pump-variance': {
    title: 'Pump Reconciliation', category: 'Inventory', permissions: ['reports.view'], params: ['range'],
    async run({ start, end, stationId }) {
      const readings = await prisma.pumpReading.findMany({
        where: { readingDate: { gte: start, lt: end }, ...(stationId ? { nozzle: { pump: { stationId } } } : {}) },
        include: { nozzle: { select: { code: true, pump: { select: { code: true } }, tank: { select: { product: { select: { name: true } } } } } }, recordedBy: { select: { name: true } }, reconciledBy: { select: { name: true } } },
        orderBy: [{ readingDate: 'asc' }, { createdAt: 'asc' }],
        take: 5000,
      });
      const rows = readings.map((r) => ({
        date: r.readingDate.toISOString().slice(0, 10), nozzle: `${r.nozzle.pump.code}/${r.nozzle.code}`, product: r.nozzle.tank.product.name,
        opening: r3(r.openingMeter), closing: r.closingMeter == null ? null : r3(r.closingMeter), metered: r.meterLiters == null ? null : r3(r.meterLiters),
        recorded: r.recordedLiters == null ? null : r3(r.recordedLiters), variance: r.varianceLiters == null ? null : r3(r.varianceLiters),
        status: r.status, by: r.recordedBy.name, reconciledBy: r.reconciledBy?.name ?? '', notes: r.notes ?? '',
      }));
      return {
        title: 'Pump Reconciliation',
        columns: [
          { key: 'date', label: 'Date', type: 'text' }, { key: 'nozzle', label: 'Pump/Nozzle', type: 'text' }, { key: 'product', label: 'Product', type: 'text' },
          { key: 'opening', label: 'Opening Meter', type: 'liters' }, { key: 'closing', label: 'Closing Meter', type: 'liters' },
          { key: 'metered', label: 'Metered', type: 'liters' }, { key: 'recorded', label: 'Recorded Sales', type: 'liters' }, { key: 'variance', label: 'Variance', type: 'liters' },
          { key: 'status', label: 'Status', type: 'text' }, { key: 'by', label: 'Recorded by', type: 'text' }, { key: 'reconciledBy', label: 'Reconciled by', type: 'text' }, { key: 'notes', label: 'Notes', type: 'text' },
        ],
        rows,
        totals: { metered: r3(sum(rows, 'metered')), recorded: r3(sum(rows, 'recorded')), variance: r3(sum(rows, 'variance')) },
      };
    },
  },

  purchases: {
    title: 'Purchases & Deliveries', category: 'Inventory', permissions: ['reports.view'], params: ['range'],
    async run({ start, end, stationId }) {
      const deliveries = await prisma.fuelDelivery.findMany({
        where: { status: 'CONFIRMED', deliveryDate: { gte: start, lt: end }, ...(stationId ? { tank: { stationId } } : {}) },
        include: { supplier: { select: { name: true } }, product: { select: { name: true } }, tank: { select: { code: true } }, purchaseOrder: { select: { orderNo: true } } },
        orderBy: { deliveryDate: 'asc' },
      });
      const rows = deliveries.map((d) => ({
        date: d.deliveryDate.toISOString().slice(0, 10), deliveryNo: d.deliveryNo, orderNo: d.purchaseOrder?.orderNo ?? '', supplier: d.supplier.name,
        product: d.product.name, tank: d.tank.code, liters: r3(d.quantityDelivered), unitCost: n(d.unitCost), total: r2(d.totalCost),
      }));
      return {
        title: 'Purchases & Deliveries',
        columns: [
          { key: 'date', label: 'Date', type: 'text' }, { key: 'deliveryNo', label: 'Delivery #', type: 'text' }, { key: 'orderNo', label: 'PO #', type: 'text' },
          { key: 'supplier', label: 'Supplier', type: 'text' }, { key: 'product', label: 'Product', type: 'text' }, { key: 'tank', label: 'Tank', type: 'text' },
          { key: 'liters', label: 'Liters', type: 'liters' }, { key: 'unitCost', label: 'Cost / L', type: 'number' }, { key: 'total', label: 'Total Cost', type: 'money' },
        ],
        rows,
        totals: { liters: r3(sum(rows, 'liters')), total: r2(sum(rows, 'total')) },
      };
    },
  },

  consumption: {
    title: 'Fleet Fuel Consumption', category: 'Fleet', permissions: ['reports.view'], params: ['range'],
    async run({ start, end }) {
      const rows = await prisma.$queryRaw`
        SELECT v."registrationNumber" AS registration, v."name" AS vehicle, v."type" AS type, COALESCE(v."department", '') AS department,
               COUNT(c."id")::int AS fills, SUM(c."quantity")::float8 AS liters,
               (MAX(c."odometerReading") - MIN(c."odometerReading"))::float8 AS distance, AVG(c."mileage")::float8 AS efficiency
        FROM "FuelConsumption" c JOIN "Vehicle" v ON v."id" = c."vehicleId"
        WHERE c."date" >= ${start} AND c."date" < ${end}
        GROUP BY v."id" ORDER BY liters DESC`;
      const out = rows.map((r) => ({ ...r, liters: r3(r.liters), distance: r.distance == null ? null : Math.round(r.distance), efficiency: r.efficiency == null ? null : Math.round(r.efficiency * 100) / 100 }));
      return {
        title: 'Fleet Fuel Consumption',
        columns: [
          { key: 'registration', label: 'Registration', type: 'text' }, { key: 'vehicle', label: 'Vehicle', type: 'text' }, { key: 'type', label: 'Type', type: 'text' },
          { key: 'department', label: 'Department', type: 'text' }, { key: 'fills', label: 'Fills', type: 'number' }, { key: 'liters', label: 'Liters', type: 'liters' },
          { key: 'distance', label: 'Distance (km)', type: 'number' }, { key: 'efficiency', label: 'Avg km / L', type: 'number' },
        ],
        rows: out,
        totals: { fills: sum(out, 'fills'), liters: r3(sum(out, 'liters')), distance: Math.round(sum(out, 'distance')) },
        chart: { x: 'registration', y: 'liters', label: 'Liters' },
      };
    },
  },

  // ─── Finance ──────────────────────────────────────────────
  expenses: {
    title: 'Expenses', category: 'Finance', permissions: ['reports.financial', 'finance.view'], params: ['range'],
    async run({ start, end, stationId }) {
      const expenses = await prisma.expense.findMany({
        where: { status: 'APPROVED', expenseDate: { gte: start, lt: end }, ...(stationId ? { stationId } : {}) },
        include: { category: { select: { name: true } }, station: { select: { name: true } }, employee: { select: { fullName: true } }, approvedBy: { select: { name: true } } },
        orderBy: { expenseDate: 'asc' },
      });
      const rows = expenses.map((e) => ({
        date: e.expenseDate.toISOString().slice(0, 10), expenseNo: e.expenseNo, category: e.category.name, description: e.description,
        vendor: e.vendor ?? '', employee: e.employee?.fullName ?? '', method: METHOD[e.method] ?? e.method, amount: r2(e.amount), station: e.station.name, approvedBy: e.approvedBy?.name ?? '',
      }));
      const byCat = {};
      for (const r of rows) byCat[r.category] = (byCat[r.category] ?? 0) + r.amount;
      return {
        title: 'Approved Expenses',
        columns: [
          { key: 'date', label: 'Date', type: 'text' }, { key: 'expenseNo', label: 'Expense #', type: 'text' }, { key: 'category', label: 'Category', type: 'text' },
          { key: 'description', label: 'Description', type: 'text' }, { key: 'vendor', label: 'Vendor', type: 'text' }, { key: 'employee', label: 'Employee', type: 'text' },
          { key: 'method', label: 'Paid by', type: 'text' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'station', label: 'Station', type: 'text' }, { key: 'approvedBy', label: 'Approved by', type: 'text' },
        ],
        rows,
        totals: { amount: r2(sum(rows, 'amount')) },
        summary: Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value: r2(value), type: 'money' })),
      };
    },
  },

  'profit-loss': {
    title: 'Profit & Loss', category: 'Finance', permissions: ['reports.financial', 'finance.view'], params: ['range'],
    async run({ start, end, stationId }) {
      const p = await profitAndLoss({ start, end, stationId });
      const rows = [
        { line: 'Fuel sales (excl. tax)', amount: p.revenue },
        { line: 'Refunds', amount: -p.refunds },
        { line: 'Cost of fuel sold', amount: -p.costOfSales },
        { line: 'Gross profit', amount: p.grossProfit, bold: true },
        ...p.expenses.map((e) => ({ line: `  ${e.category}`, amount: -e.amount })),
        { line: 'Total expenses', amount: -p.totalExpenses },
        { line: 'Net profit', amount: p.netProfit, bold: true },
      ];
      return {
        title: 'Profit & Loss',
        columns: [{ key: 'line', label: 'Line', type: 'text' }, { key: 'amount', label: 'Amount', type: 'money' }],
        rows,
        summary: [
          { label: 'Gross margin', value: p.grossMargin, type: 'percent' },
          { label: 'Net margin', value: p.netMargin, type: 'percent' },
          { label: 'Tax collected (not revenue)', value: p.taxCollected, type: 'money' },
          { label: 'Fuel purchased', value: p.purchases.cost, type: 'money' },
        ],
      };
    },
  },

  payables: {
    title: 'Supplier Payables', category: 'Finance', permissions: ['reports.financial', 'finance.view'], params: [],
    async run() {
      const aging = await payablesAging();
      const rows = aging.parties.map((p) => ({ supplier: p.name, outstanding: p.total, overdue: p.overdue, oldestDays: Math.max(0, p.oldestDays) }));
      return {
        title: 'Supplier Payables',
        columns: [{ key: 'supplier', label: 'Supplier', type: 'text' }, { key: 'outstanding', label: 'Outstanding', type: 'money' }, { key: 'overdue', label: 'Overdue', type: 'money' }, { key: 'oldestDays', label: 'Days Past Due', type: 'number' }],
        rows,
        totals: { outstanding: aging.total, overdue: r2(sum(rows, 'overdue')) },
        summary: Object.entries(aging.buckets).map(([k, v]) => ({ label: k === 'current' ? 'Not due' : `${k} days`, value: v, type: 'money' })),
      };
    },
  },

  // ─── Staff ────────────────────────────────────────────────
  'employee-performance': {
    title: 'Employee Performance', category: 'Staff', permissions: ['reports.view'], params: ['range'],
    async run({ start, end, stationId }) {
      const [sales, liters, readings, refunds, users] = await Promise.all([
        prisma.sale.groupBy({ by: ['cashierId'], where: { status: { not: 'CANCELLED' }, saleDate: { gte: start, lt: end }, ...(stationId ? { stationId } : {}) }, _sum: { total: true, discountTotal: true }, _count: true }),
        prisma.$queryRaw`SELECT s."cashierId" AS id, SUM(i."quantity")::float8 AS liters FROM "SaleItem" i JOIN "Sale" s ON s."id" = i."saleId"
          WHERE s."status" <> 'CANCELLED' AND s."saleDate" >= ${start} AND s."saleDate" < ${end} ${stationSql('s', stationId)} GROUP BY 1`,
        prisma.pumpReading.groupBy({ by: ['recordedById'], where: { readingDate: { gte: start, lt: end }, status: { not: 'OPEN' }, ...(stationId ? { nozzle: { pump: { stationId } } } : {}) }, _sum: { meterLiters: true, varianceLiters: true }, _count: true }),
        prisma.refund.groupBy({ by: ['requestedById'], where: { createdAt: { gte: start, lt: end }, ...(stationId ? { invoice: { stationId } } : {}) }, _count: true }),
        prisma.user.findMany({ where: stationId ? { stationId } : {}, select: { id: true, name: true, role: { select: { name: true, key: true } } } }),
      ]);
      const by = {};
      const get = (id) => (by[id] ||= { userId: id, sales: 0, revenue: 0, liters: 0, discounts: 0, readings: 0, metered: 0, variance: 0, refunds: 0 });
      sales.forEach((s) => Object.assign(get(s.cashierId), { sales: s._count, revenue: r2(s._sum.total), discounts: r2(s._sum.discountTotal) }));
      liters.forEach((l) => { get(l.id).liters = r3(l.liters); });
      readings.forEach((r) => Object.assign(get(r.recordedById), { readings: r._count, metered: r3(r._sum.meterLiters), variance: r3(r._sum.varianceLiters) }));
      refunds.forEach((r) => { get(r.requestedById).refunds = r._count; });
      const names = Object.fromEntries(users.map((u) => [u.id, u]));
      const rows = Object.values(by).filter((r) => names[r.userId] && names[r.userId].role.key !== 'customer').map((r) => ({
        employee: names[r.userId].name, role: names[r.userId].role.name, ...r, avgSale: r.sales ? r2(r.revenue / r.sales) : 0,
      })).sort((a, b) => b.revenue - a.revenue);
      return {
        title: 'Employee Performance',
        columns: [
          { key: 'employee', label: 'Employee', type: 'text' }, { key: 'role', label: 'Role', type: 'text' }, { key: 'sales', label: 'Sales', type: 'number' },
          { key: 'liters', label: 'Liters Sold', type: 'liters' }, { key: 'revenue', label: 'Amount Billed', type: 'money' }, { key: 'avgSale', label: 'Avg Sale', type: 'money' },
          { key: 'discounts', label: 'Discounts Given', type: 'money' }, { key: 'refunds', label: 'Refunds Requested', type: 'number' },
          { key: 'readings', label: 'Meter Readings', type: 'number' }, { key: 'metered', label: 'Metered Liters', type: 'liters' }, { key: 'variance', label: 'Meter Variance', type: 'liters' },
        ],
        rows,
        totals: { sales: sum(rows, 'sales'), liters: r3(sum(rows, 'liters')), revenue: r2(sum(rows, 'revenue')), discounts: r2(sum(rows, 'discounts')), variance: r3(sum(rows, 'variance')) },
        chart: { x: 'employee', y: 'revenue', label: 'Amount billed' },
      };
    },
  },

  audit: {
    title: 'Audit Trail', category: 'Staff', permissions: ['audit.view'], params: ['range'],
    async run({ start, end, stationId, search }) {
      const logs = await prisma.auditLog.findMany({
        where: {
          createdAt: { gte: start, lt: end },
          ...(stationId ? { user: { stationId } } : {}),
          ...(search ? { OR: [{ action: { contains: search, mode: 'insensitive' } }, { details: { contains: search, mode: 'insensitive' } }] } : {}),
        },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      });
      return {
        title: 'Audit Trail',
        columns: [
          { key: 'time', label: 'Time', type: 'text' }, { key: 'user', label: 'User', type: 'text' }, { key: 'action', label: 'Action', type: 'text' },
          { key: 'details', label: 'Details', type: 'text' }, { key: 'entity', label: 'Record', type: 'text' }, { key: 'ip', label: 'IP', type: 'text' },
        ],
        rows: logs.map((l) => ({
          time: l.createdAt.toISOString().slice(0, 19).replace('T', ' '), user: l.user?.name ?? 'System', action: l.action,
          details: l.details ?? '', entity: l.entityType ? `${l.entityType}${l.entityId ? ` ${l.entityId.slice(-8)}` : ''}` : '', ip: l.ip ?? '',
        })),
        note: logs.length === 2000 ? 'Showing the latest 2,000 entries; narrow the date range or search to see more.' : undefined,
      };
    },
  },
};

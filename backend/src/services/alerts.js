/**
 * Daily alerts — runs at most once per calendar day (station time zone) and
 * posts notifications for things that need attention:
 *   - overdue customer invoices (per station)
 *   - supplier invoices overdue or due within 3 days
 *   - items waiting for approval (adjustments, refunds, expenses, deliveries)
 */
import { prisma } from '../db.js';
import { notify } from '../lib/notify.js';
import { addDays, startOfDay, toDayString } from '../lib/dates.js';

const LAST_RUN_KEY = 'alerts.lastRunDay';
const fmt = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function runDailyAlerts({ force = false } = {}) {
  const today = toDayString(startOfDay());
  const last = await prisma.setting.findUnique({ where: { key: LAST_RUN_KEY } });
  if (!force && last?.value === today) return { skipped: true };
  // claim the day first so two processes cannot both send
  await prisma.setting.upsert({ where: { key: LAST_RUN_KEY }, update: { value: today }, create: { key: LAST_RUN_KEY, value: today } });

  const now = new Date();
  const created = [];

  // SECTION: overdue receivables per station
  const overdue = await prisma.invoice.groupBy({
    by: ['stationId'],
    where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] }, dueDate: { lt: now }, customerId: { not: null } },
    _sum: { total: true, amountPaid: true },
    _count: true,
  });
  for (const o of overdue) {
    const amount = Number(o._sum.total ?? 0) - Number(o._sum.amountPaid ?? 0);
    if (amount <= 0) continue;
    created.push(await notify(prisma, { type: 'WARNING', title: 'Overdue customer invoices', message: `${o._count} invoice(s), ${fmt(amount)} past due`, stationId: o.stationId, link: '#invoices' }));
  }

  // SECTION: supplier bills overdue or due within 3 days (company-wide)
  const payables = await prisma.supplierInvoice.aggregate({
    where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] }, dueDate: { lt: addDays(startOfDay(), 4) } },
    _sum: { amount: true, amountPaid: true },
    _count: true,
  });
  if (payables._count) {
    const amount = Number(payables._sum.amount ?? 0) - Number(payables._sum.amountPaid ?? 0);
    created.push(await notify(prisma, { type: 'WARNING', title: 'Supplier payments due', message: `${payables._count} supplier invoice(s), ${fmt(amount)} overdue or due within 3 days`, link: '#purchases' }));
  }

  // SECTION: approvals waiting (station-scoped where the record has a station)
  const stations = await prisma.station.findMany({ select: { id: true } });
  for (const s of stations) {
    const [adjustments, refunds, expenses, deliveries] = await Promise.all([
      prisma.stockAdjustment.count({ where: { status: 'PENDING', tank: { stationId: s.id } } }),
      prisma.refund.count({ where: { status: 'PENDING', invoice: { stationId: s.id } } }),
      prisma.expense.count({ where: { status: 'PENDING', stationId: s.id } }),
      prisma.fuelDelivery.count({ where: { status: 'PENDING', tank: { stationId: s.id } } }),
    ]);
    const parts = [[adjustments, 'stock adjustment'], [refunds, 'refund'], [expenses, 'expense'], [deliveries, 'delivery']].filter(([c]) => c > 0).map(([c, l]) => `${c} ${l}${c > 1 ? 's' : ''}`);
    if (parts.length) created.push(await notify(prisma, { type: 'INFO', title: 'Waiting for approval', message: parts.join(', '), stationId: s.id }));
  }
  return { skipped: false, created: created.length };
}

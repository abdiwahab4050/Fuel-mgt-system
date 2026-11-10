/**
 * Billing — sales, invoices, payments, cancellations and refunds.
 *
 * Money rules:
 *  - Line total = round2(liters × price per liter) − line discount.
 *  - Tax = round2((subtotal − discounts) × taxRate%). Total = subtotal − discounts + tax.
 *  - Prices come from the product at the moment of sale, never from the client.
 *  - Every sale creates exactly one invoice. Invoice.amountPaid changes only
 *    inside applyPaymentToInvoice, under a row lock.
 *  - Customer balance = Σ(total − amountPaid) over UNPAID/PARTIALLY_PAID invoices.
 *  - Cancelling voids an unpaid sale and returns its fuel to the tank.
 *    Refunds return money on a paid sale; fuel is not returned to stock.
 *  - Cancellations and refunds need permissions; refunds need a second person to approve.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { applyStockMovement } from './stock.js';
import { nextDocNumber } from '../lib/numbering.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { verifyPassword } from '../auth/password.js';
import { LOCK_MINUTES, MAX_FAILED_LOGINS } from '../auth/lockout.js';
import { can } from '../middleware/auth.js';
import { getSettings } from '../routes/settings.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { addDays } from '../lib/dates.js';

const D = (v) => new Prisma.Decimal(v);
export const round2 = (d) => D(d).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export const ELECTRONIC_METHODS = ['ZAAD', 'EDAHAB', 'MASTERCARD'];
export const SALE_METHODS = ['CASH', 'BANK_TRANSFER', 'CREDIT_ACCOUNT', ...ELECTRONIC_METHODS];

export function invoiceStatusFor(total, paid) {
  if (D(paid).lte(0)) return 'UNPAID';
  if (D(paid).lt(total)) return 'PARTIALLY_PAID';
  return 'PAID';
}

// SECTION: outstanding balance of a customer (credit exposure)
export async function customerOutstanding(db, customerId) {
  const agg = await db.invoice.aggregate({
    where: { customerId, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
    _sum: { total: true, amountPaid: true },
  });
  return D(agg._sum.total ?? 0).minus(agg._sum.amountPaid ?? 0);
}

// SECTION: resolve sale lines — nozzle or tank → tank, product and current price
async function resolveLines(tx, stationId, items) {
  const lines = [];
  for (const item of items) {
    let tank;
    let nozzleId = null;
    if (item.nozzleId) {
      const nozzle = await tx.nozzle.findUnique({ where: { id: item.nozzleId }, include: { pump: true, tank: true } });
      if (!nozzle) throw badRequest('Nozzle not found');
      if (nozzle.status !== 'ACTIVE' || nozzle.pump.status !== 'ACTIVE') throw conflict(`Pump ${nozzle.pump.code} nozzle ${nozzle.code} is not active`);
      tank = nozzle.tank;
      nozzleId = nozzle.id;
    } else {
      tank = await tx.tank.findUnique({ where: { id: item.tankId } });
      if (!tank) throw badRequest('Tank not found');
    }
    if (tank.stationId !== stationId) throw badRequest('Fuel must come from a tank at this station');
    const product = await tx.fuelProduct.findUnique({ where: { id: tank.productId } });
    if (product.status !== 'ACTIVE') throw conflict(`${product.name} is not currently sold`);

    const gross = round2(item.quantity.times(product.sellingPrice));
    const discount = item.discount ?? D(0);
    if (discount.gt(gross)) throw badRequest(`Discount on ${product.name} exceeds the line amount`);
    lines.push({ tank, product, nozzleId, quantity: item.quantity, unitPrice: product.sellingPrice, gross, discount, lineTotal: gross.minus(discount) });
  }
  return lines;
}

// SECTION: discount authorization — within the free limit, or by a user holding sales.discount.approve
async function authorizeDiscount(tx, req, { subtotal, discountTotal, stationId, approval, settings }) {
  if (discountTotal.isZero()) return null;
  if (!can(req.user, 'sales.discount.apply', 'sales.discount.approve')) throw forbidden('You are not allowed to give discounts');
  if (can(req.user, 'sales.discount.approve')) return req.user.id;

  const percent = discountTotal.div(subtotal).times(100);
  if (percent.lte(settings['sales.maxDiscountPercentWithoutApproval'] ?? 0)) return null;

  if (!approval?.email || !approval?.password) {
    throw new AppError(403, `A ${percent.toDecimalPlaces(1)}% discount needs a supervisor's approval`, 'DISCOUNT_APPROVAL_REQUIRED');
  }
  const approver = await tx.user.findUnique({
    where: { email: approval.email.trim().toLowerCase() },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (approver?.lockedUntil && approver.lockedUntil > new Date()) {
    throw forbidden('That supervisor account is temporarily locked after repeated failed attempts');
  }
  const ok = await verifyPassword(approval.password, approver?.passwordHash);
  const hasPerm = approver?.role.permissions.some((rp) => rp.permission.key === 'sales.discount.approve');
  if (!approver || !ok || !hasPerm || approver.status !== 'ACTIVE' || approver.id === req.user.id
      || (approver.stationId && approver.stationId !== stationId)) {
    // written outside the sale transaction (which is about to roll back) so the attempt is really recorded;
    // a wrong password counts towards the same lockout as the login screen
    if (approver && !ok) {
      const failed = approver.failedLogins + 1;
      await prisma.user.update({
        where: { id: approver.id },
        data: { failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null },
      });
    }
    await audit(prisma, req, { action: 'sale.discount_approval_failed', entityType: 'User', entityId: approver?.id, details: `Discount approval rejected for ${approval.email}` });
    throw forbidden('Supervisor approval was not accepted');
  }
  if (approver.failedLogins) await prisma.user.update({ where: { id: approver.id }, data: { failedLogins: 0 } });
  return approver.id;
}

// SECTION: the single place an invoice's paid amount changes
export async function applyPaymentToInvoice(tx, invoiceId, amount, { blockIfPendingElectronic = false } = {}) {
  const rows = await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
  if (!rows.length) throw notFound('Invoice not found');
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (blockIfPendingElectronic) {
    const pending = await tx.payment.findFirst({ where: { invoiceId, status: 'PENDING' } });
    if (pending) throw conflict(`A ${pending.method} payment (${pending.paymentNo}) is in progress on this invoice. Wait for it to finish or cancel it before taking another payment.`);
  }
  if (['CANCELLED', 'REFUNDED'].includes(inv.status)) throw conflict(`Invoice ${inv.invoiceNo} is ${inv.status.toLowerCase()}`);
  const balance = inv.total.minus(inv.amountPaid);
  if (D(amount).gt(balance)) throw conflict(`Payment ${amount} exceeds the balance due ${balance}`, { balance: balance.toNumber() });
  const amountPaid = inv.amountPaid.plus(amount);
  return tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid, status: invoiceStatusFor(inv.total, amountPaid) } });
}

// SECTION: record an immediately-settled payment (cash, bank transfer) against an invoice
export async function recordSettledPayment(tx, req, { invoiceId, amount, method, reference = null, idempotencyKey }) {
  if (ELECTRONIC_METHODS.includes(method)) throw badRequest(`${method} payments are confirmed by the payment provider, not entered manually`);
  if (method === 'CREDIT_ACCOUNT') throw badRequest('Credit account is not a payment method for settling invoices');
  const existing = await tx.payment.findUnique({ where: { idempotencyKey } });
  if (existing) return { payment: existing, replayed: true };

  // the invoice row is locked inside applyPaymentToInvoice; check for an in-flight electronic payment after that lock
  const invoice = await applyPaymentToInvoice(tx, invoiceId, amount, { blockIfPendingElectronic: true });
  const paymentNo = await nextDocNumber(tx, 'payment');
  const payment = await tx.payment.create({
    data: {
      paymentNo, reference: paymentNo, idempotencyKey, invoiceId, customerId: invoice.customerId,
      method, amount, currency: invoice.currency, status: 'SUCCESSFUL', providerReference: reference,
      initiatedById: req.user.id, verifiedAt: new Date(),
    },
  });
  await tx.paymentTransaction.create({ data: { paymentId: payment.id, type: 'CALLBACK', providerStatus: 'RECORDED_BY_STAFF', request: { method, amount: amount.toString(), reference } } });
  await audit(tx, req, { action: 'payment.recorded', entityType: 'Payment', entityId: payment.id, details: `${paymentNo}: ${method} ${amount} on ${invoice.invoiceNo}${reference ? ` (ref ${reference})` : ''}` });
  return { payment, invoice, replayed: false };
}

/**
 * Create a sale with its invoice, stock deduction and (for cash/bank) payment.
 * input = { stationId?, items:[{nozzleId|tankId, quantity, discount?}], customerId?, walkInName?, walkInPhone?,
 *           paymentMethod, amountTendered?, paymentReference?, discountApproval?, notes?, idempotencyKey }
 */
export async function createSale(req, input) {
  const replay = await prisma.sale.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, cashierId: true } });
  if (replay) {
    if (replay.cashierId !== req.user.id) throw conflict('Duplicate request key');
    return { saleId: replay.id, replayed: true };
  }

  const stationId = req.user.stationId ?? input.stationId;
  if (!stationId) throw badRequest('Select the station for this sale');
  if (input.paymentMethod === 'CREDIT_ACCOUNT' && !input.customerId) throw badRequest('Credit sales need a registered customer');
  if (input.paymentMethod === 'BANK_TRANSFER' && !input.paymentReference) throw badRequest('Enter the bank transfer reference');
  const settings = await getSettings();

  try {
    const saleId = await prisma.$transaction(async (tx) => {
      // SECTION: customer + credit check (customer row locked so two credit sales cannot both pass the limit)
      let customer = null;
      if (input.customerId) {
        const rows = await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${input.customerId} FOR UPDATE`;
        if (!rows.length) throw badRequest('Customer not found');
        customer = await tx.customer.findUnique({ where: { id: input.customerId } });
        if (customer.status !== 'ACTIVE') throw conflict(`${customer.name}'s account is inactive`);
      }

      const lines = await resolveLines(tx, stationId, input.items);
      const subtotal = lines.reduce((s, l) => s.plus(l.gross), D(0));
      const discountTotal = lines.reduce((s, l) => s.plus(l.discount), D(0));
      const taxRate = D(settings['invoice.taxRate'] ?? 0);
      const taxTotal = round2(subtotal.minus(discountTotal).times(taxRate).div(100));
      const total = subtotal.minus(discountTotal).plus(taxTotal);
      if (total.lte(0)) throw badRequest('Sale total must be greater than zero');

      const discountApprovedById = await authorizeDiscount(tx, req, { subtotal, discountTotal, stationId, approval: input.discountApproval, settings });

      if (input.paymentMethod === 'CREDIT_ACCOUNT') {
        if (!customer.creditAllowed) throw conflict(`${customer.name} is not approved for credit`);
        const exposure = (await customerOutstanding(tx, customer.id)).plus(total);
        if (exposure.gt(customer.creditLimit)) {
          throw conflict(`Credit limit exceeded: limit ${customer.creditLimit}, balance after this sale would be ${exposure}`, { creditLimit: customer.creditLimit.toNumber() });
        }
      }
      if (input.paymentMethod === 'CASH' && input.amountTendered && input.amountTendered.lt(total)) {
        throw badRequest(`Cash tendered (${input.amountTendered}) is less than the total (${total})`);
      }

      // SECTION: sale + items
      const shift = await tx.shift.findFirst({ where: { userId: req.user.id, status: 'OPEN' }, select: { id: true } });
      const saleNo = await nextDocNumber(tx, 'sale');
      const sale = await tx.sale.create({
        data: {
          saleNo, idempotencyKey: input.idempotencyKey, stationId, customerId: customer?.id ?? null,
          walkInName: customer ? null : input.walkInName || null, walkInPhone: customer ? null : input.walkInPhone || null,
          cashierId: req.user.id, shiftId: shift?.id ?? null,
          subtotal, discountTotal, discountApprovedById, taxTotal, total, notes: input.notes || null,
          items: { create: lines.map((l) => ({ productId: l.product.id, tankId: l.tank.id, nozzleId: l.nozzleId, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal })) },
        },
      });

      // SECTION: deduct fuel from the tanks (locked, ledgered, cannot go negative)
      for (const l of lines) {
        await applyStockMovement(tx, {
          tankId: l.tank.id, type: 'SALE', quantity: l.quantity.negated(), unitCost: l.product.costPrice,
          userId: req.user.id, referenceType: 'Sale', referenceId: sale.id, note: saleNo,
        });
      }

      // SECTION: invoice
      const credit = input.paymentMethod === 'CREDIT_ACCOUNT';
      const invoiceNo = await nextDocNumber(tx, 'invoice');
      const invoice = await tx.invoice.create({
        data: {
          invoiceNo, saleId: sale.id, customerId: customer?.id ?? null, stationId,
          currency: settings['currency.code'], subtotal, discount: discountTotal, taxRate, tax: taxTotal, total,
          dueDate: credit ? addDays(new Date(), Number(settings['invoice.creditTermsDays'] ?? 30)) : new Date(),
        },
      });

      // SECTION: immediate settlement for cash / bank; electronic payments are initiated afterwards (Phase 6)
      if (input.paymentMethod === 'CASH' || input.paymentMethod === 'BANK_TRANSFER') {
        await recordSettledPayment(tx, req, {
          invoiceId: invoice.id, amount: total, method: input.paymentMethod,
          reference: input.paymentReference || null, idempotencyKey: `sale:${sale.id}`,
        });
      }

      await audit(tx, req, {
        action: 'sale.create', entityType: 'Sale', entityId: sale.id,
        details: `${saleNo} / ${invoiceNo}: ${lines.map((l) => `${l.quantity} L ${l.product.name}`).join(', ')} = ${total} (${input.paymentMethod})${discountTotal.gt(0) ? `, discount ${discountTotal}` : ''}`,
      });
      return sale.id;
    }, { timeout: 15000 });
    return { saleId, replayed: false };
  } catch (err) {
    // a concurrent duplicate submit hit the unique idempotency key — return the winner
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && String(err.meta?.target).includes('idempotencyKey')) {
      const winner = await prisma.sale.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
      if (winner) return { saleId: winner.id, replayed: true };
    }
    throw err;
  }
}

// SECTION: cancel (void) — only for sales with no money taken; fuel goes back to its tank
export async function cancelSale(req, saleId, reason) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT "id" FROM "Sale" WHERE "id" = ${saleId} FOR UPDATE`;
    if (!rows.length) throw notFound('Sale not found');
    const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { items: true, invoice: { include: { payments: true } } } });
    if (req.user.stationId && sale.stationId !== req.user.stationId) throw forbidden('This sale belongs to another station');
    if (sale.status !== 'COMPLETED') throw conflict(`Sale is already ${sale.status.toLowerCase().replace('_', ' ')}`);
    const paid = sale.invoice.payments.filter((p) => ['SUCCESSFUL', 'PENDING'].includes(p.status));
    if (paid.length) throw conflict('This sale has payments. Request a refund instead of cancelling.');

    for (const item of sale.items) {
      await applyStockMovement(tx, {
        tankId: item.tankId, type: 'SALE_REVERSAL', quantity: item.quantity, userId: req.user.id,
        referenceType: 'Sale', referenceId: sale.id, note: `Cancelled ${sale.saleNo}: ${reason}`,
      });
    }
    await tx.sale.update({ where: { id: sale.id }, data: { status: 'CANCELLED' } });
    await tx.invoice.update({ where: { id: sale.invoice.id }, data: { status: 'CANCELLED' } });
    await audit(tx, req, { action: 'sale.cancel', entityType: 'Sale', entityId: sale.id, details: `Cancelled ${sale.saleNo} (${sale.total}): ${reason}` });
    return sale.id;
  });
}

// SECTION: refunds — requested by staff, approved by someone else; money only (fuel cannot be returned)
async function refundedOrReserved(tx, invoiceId) {
  const agg = await tx.refund.aggregate({ where: { invoiceId, status: { in: ['PENDING', 'APPROVED', 'COMPLETED'] } }, _sum: { amount: true } });
  return D(agg._sum.amount ?? 0);
}

export async function requestRefund(req, { invoiceId, paymentId, amount, reason }) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    if (!rows.length) throw notFound('Invoice not found');
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (req.user.stationId && invoice.stationId !== req.user.stationId) throw forbidden('This invoice belongs to another station');
    if (invoice.amountPaid.lte(0)) throw conflict('Nothing has been paid on this invoice. Cancel the sale instead.');
    if (invoice.status === 'REFUNDED') throw conflict(`${invoice.invoiceNo} has already been fully refunded`);

    let payment = null;
    if (paymentId) {
      payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment || payment.invoiceId !== invoiceId || payment.status !== 'SUCCESSFUL') throw badRequest('Choose a successful payment on this invoice');
    }
    const refundable = invoice.amountPaid.minus(await refundedOrReserved(tx, invoiceId));
    if (amount.gt(refundable)) throw conflict(`At most ${refundable} can still be refunded on ${invoice.invoiceNo}`, { refundable: refundable.toNumber() });

    const refundNo = await nextDocNumber(tx, 'refund');
    const refund = await tx.refund.create({
      data: { refundNo, invoiceId, saleId: invoice.saleId, paymentId: payment?.id ?? null, amount, reason, requestedById: req.user.id },
    });
    await audit(tx, req, { action: 'refund.request', entityType: 'Refund', entityId: refund.id, details: `${refundNo}: ${amount} on ${invoice.invoiceNo} — ${reason}` });
    await notify(tx, { type: 'INFO', title: 'Refund awaiting approval', message: `${refundNo}: ${amount} on ${invoice.invoiceNo}`, link: '#invoices', stationId: invoice.stationId });
    return refund;
  });
}

export async function decideRefund(req, refundId, approve, note) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT "id" FROM "Refund" WHERE "id" = ${refundId} FOR UPDATE`;
    if (!rows.length) throw notFound('Refund not found');
    const refund = await tx.refund.findUnique({ where: { id: refundId }, include: { payment: true, invoice: true } });
    if (refund.status !== 'PENDING') throw conflict(`Refund was already ${refund.status.toLowerCase()}`);
    if (req.user.stationId && refund.invoice.stationId !== req.user.stationId) throw forbidden('This refund belongs to another station');
    if (refund.requestedById === req.user.id && req.user.role !== 'super_admin') throw forbidden('You cannot approve your own refund request');

    if (!approve) {
      const r = await tx.refund.update({ where: { id: refund.id }, data: { status: 'REJECTED', approvedById: req.user.id, decidedAt: new Date() } });
      await audit(tx, req, { action: 'refund.reject', entityType: 'Refund', entityId: refund.id, details: `Rejected ${refund.refundNo}${note ? ` — ${note}` : ''}` });
      return r;
    }

    // Electronic payments are returned through the provider (Phase 6); cash/bank refunds are paid out at the counter
    const viaProvider = refund.payment && ELECTRONIC_METHODS.includes(refund.payment.method);
    const r = await tx.refund.update({
      where: { id: refund.id },
      data: { status: viaProvider ? 'APPROVED' : 'COMPLETED', approvedById: req.user.id, decidedAt: new Date() },
    });
    if (!viaProvider) await finalizeRefund(tx, refund);
    await audit(tx, req, {
      action: 'refund.approve', entityType: 'Refund', entityId: refund.id,
      details: `Approved ${refund.refundNo} (${refund.amount})${viaProvider ? ' — awaiting provider refund' : ' — paid out'}${note ? ` — ${note}` : ''}`,
    });
    await notify(tx, { type: 'SUCCESS', title: 'Refund approved', message: `${refund.refundNo}: ${refund.amount}`, userId: refund.requestedById, link: '#invoices' });
    return r;
  });
}

// SECTION: after money is actually returned — update payment, invoice and sale statuses
export async function finalizeRefund(tx, refund) {
  const completed = D((await tx.refund.aggregate({ where: { invoiceId: refund.invoiceId, status: 'COMPLETED' }, _sum: { amount: true } }))._sum.amount ?? 0);
  const invoice = await tx.invoice.findUnique({ where: { id: refund.invoiceId } });
  if (refund.paymentId) {
    const onPayment = D((await tx.refund.aggregate({ where: { paymentId: refund.paymentId, status: 'COMPLETED' }, _sum: { amount: true } }))._sum.amount ?? 0);
    const payment = await tx.payment.findUnique({ where: { id: refund.paymentId } });
    if (onPayment.gte(payment.amount)) await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
  }
  const full = completed.gte(invoice.amountPaid) && invoice.status === 'PAID';
  if (full) await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'REFUNDED' } });
  if (invoice.saleId) await tx.sale.update({ where: { id: invoice.saleId }, data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
}

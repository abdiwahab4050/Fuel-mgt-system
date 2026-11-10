/**
 * Electronic payments (ZAAD, eDAHAB, Mastercard) — provider-agnostic.
 *
 * Lifecycle:
 *   initiate → Payment PENDING (one per invoice at a time, idempotent by key)
 *   → provider confirms (signed webhook and/or server status check)
 *   → settlePayment: amount + currency verified, invoice updated under lock
 *   → SUCCESSFUL | FAILED | CANCELLED (expired requests are cancelled)
 *
 * The browser can ask for a status refresh, but only the server's call to the
 * provider (or a verified webhook confirmed by that call) changes a payment.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { getProvider } from './providers/index.js';
import { applyPaymentToInvoice, finalizeRefund } from '../billing.js';
import { nextDocNumber } from '../../lib/numbering.js';
import { audit } from '../../lib/audit.js';
import { notify } from '../../lib/notify.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';

const D = (v) => new Prisma.Decimal(v);
const SYSTEM = { user: null, ip: null };
export const PENDING_TIMEOUT_MINUTES = Number(process.env.PAYMENT_PENDING_TIMEOUT_MINUTES || 15);
const STATUS_CHECK_MIN_INTERVAL_MS = 4000;
const lastChecked = new Map();

// SECTION: helpers
export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/[\s\-()]/g, '').replace(/^\+/, '');
  if (!/^\d{7,15}$/.test(digits)) throw badRequest('Enter a valid mobile number (digits only, with country code if required)');
  return digits;
}

const maskPhone = (p) => (p ? `${p.slice(0, 3)}****${p.slice(-2)}` : null);

// Strip anything that looks like a secret or card data before storing provider payloads
function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return raw ?? null;
  return JSON.parse(JSON.stringify(raw, (k, v) => (/secret|password|apikey|api_key|token|cvv|cvc|pan|cardnumber/i.test(k) ? '[redacted]' : v)));
}

async function logEvent(db, paymentId, type, { providerStatus = null, request = null, response = null, httpStatus = null } = {}) {
  return db.paymentTransaction.create({ data: { paymentId, type, providerStatus, request: sanitize(request) ?? undefined, response: sanitize(response) ?? undefined, httpStatus } });
}

// ─── Initiate ────────────────────────────────────────────────

export async function initiatePayment(req, invoiceId, { method, phone, amount, idempotencyKey }) {
  const provider = getProvider(method);
  if (!provider.available) throw new AppError(503, provider.unavailableReason, 'PROVIDER_UNAVAILABLE');
  const payerPhone = provider.flow === 'mobile' ? normalizePhone(phone) : null;

  // SECTION: create the PENDING payment under an invoice lock
  const { payment, replayed } = await prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { idempotencyKey: `pay:${idempotencyKey}` } });
    if (existing) {
      if (existing.invoiceId !== invoiceId) throw conflict('Duplicate request key');
      return { payment: existing, replayed: true };
    }
    const rows = await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    if (!rows.length) throw notFound('Invoice not found');
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!['UNPAID', 'PARTIALLY_PAID'].includes(invoice.status)) throw conflict(`Invoice ${invoice.invoiceNo} is ${invoice.status.toLowerCase().replace('_', ' ')}`);
    const balance = invoice.total.minus(invoice.amountPaid);
    const amt = amount ? D(amount) : balance;
    if (amt.lte(0) || amt.gt(balance)) throw badRequest(`Amount must be between 0.01 and the balance due (${balance})`);
    const pending = await tx.payment.findFirst({ where: { invoiceId, status: 'PENDING' } });
    if (pending) throw conflict(`A ${pending.method} payment (${pending.paymentNo}) is already in progress for this invoice. Wait for it or cancel it first.`, { paymentId: pending.id });

    const paymentNo = await nextDocNumber(tx, 'payment');
    const p = await tx.payment.create({
      data: {
        paymentNo, reference: `FF-${paymentNo}`, idempotencyKey: `pay:${idempotencyKey}`, invoiceId,
        customerId: invoice.customerId, method, amount: amt, currency: invoice.currency, status: 'PENDING',
        payerPhone, initiatedById: req.user.id,
      },
    });
    await audit(tx, req, { action: 'payment.initiated', entityType: 'Payment', entityId: p.id, details: `${paymentNo}: ${method} ${amt} ${invoice.currency} on ${invoice.invoiceNo}${payerPhone ? ` from ${maskPhone(payerPhone)}` : ''} (${provider.mode})` });
    return { payment: p, replayed: false };
  });
  if (replayed) return { payment, replayed: true };

  // SECTION: call the provider outside the DB transaction (network I/O)
  let result;
  try {
    result = await provider.initiate({ payment, phone: payerPhone, returnUrl: null });
  } catch (err) {
    await logEvent(prisma, payment.id, 'INITIATE', { providerStatus: 'ERROR', request: { method, amount: payment.amount.toString(), phone: maskPhone(payerPhone) }, response: { error: err.message } });
    await settlePayment(payment.id, { status: 'FAILED', failureReason: `Could not start ${method} payment: ${err.message}` }, 'initiate');
    throw new AppError(502, `${provider.label} did not accept the payment request: ${err.message}`, 'PROVIDER_ERROR');
  }
  await logEvent(prisma, payment.id, 'INITIATE', {
    providerStatus: result.status,
    request: { method, amount: payment.amount.toString(), currency: payment.currency, phone: maskPhone(payerPhone), reference: payment.reference, mode: provider.mode },
    response: { ...result.raw, redirectUrl: result.redirectUrl ?? null, providerReference: result.providerReference ?? null },
  });
  if (result.status === 'FAILED') {
    await settlePayment(payment.id, { status: 'FAILED', failureReason: result.failureReason || 'Rejected by provider' }, 'initiate');
  }
  return { payment: await prisma.payment.findUnique({ where: { id: payment.id } }), redirectUrl: result.redirectUrl ?? null, instructions: result.instructions ?? null, replayed: false };
}

// ─── Settle (the only place an electronic payment changes state) ─

export async function settlePayment(paymentId, result, source) {
  const outcome = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
    if (!rows.length) throw notFound('Payment not found');
    const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { invoice: { select: { invoiceNo: true, stationId: true } } } });
    if (source !== 'initiate') {
      await logEvent(tx, p.id, source === 'webhook' ? 'CALLBACK' : 'STATUS_CHECK', { providerStatus: result.status, response: result.raw ?? { status: result.status } });
    }
    if (p.status !== 'PENDING' || result.status === 'PENDING') return { payment: p, changed: false };

    if (result.status === 'SUCCESSFUL') {
      // SECTION: verify what the provider says was paid matches what we asked for
      if (result.amount === undefined || !D(result.amount).equals(p.amount) || (result.currency && result.currency !== p.currency)) {
        const reason = `Amount mismatch: requested ${p.amount} ${p.currency}, provider reported ${result.amount} ${result.currency ?? ''}. Manual review required.`;
        const failed = await tx.payment.update({ where: { id: p.id }, data: { status: 'FAILED', failureReason: reason } });
        await audit(tx, SYSTEM, { action: 'payment.amount_mismatch', entityType: 'Payment', entityId: p.id, details: `${p.paymentNo}: ${reason}` });
        await notify(tx, { type: 'DANGER', title: 'Payment needs review', message: `${p.paymentNo} (${p.method}): ${reason}`, stationId: p.invoice.stationId, link: '#invoices' });
        return { payment: failed, changed: true };
      }
      // a provider transaction can only ever settle one payment
      if (result.providerReference) {
        const dup = await tx.payment.findFirst({ where: { method: p.method, providerReference: result.providerReference, NOT: { id: p.id } } });
        if (dup) {
          const failed = await tx.payment.update({ where: { id: p.id }, data: { status: 'FAILED', failureReason: `Provider reference ${result.providerReference} already used by ${dup.paymentNo}` } });
          await audit(tx, SYSTEM, { action: 'payment.duplicate_reference', entityType: 'Payment', entityId: p.id, details: `${p.paymentNo}: provider reference reused` });
          return { payment: failed, changed: true };
        }
      }
      let appliedNote = null;
      try {
        await applyPaymentToInvoice(tx, p.invoiceId, p.amount);
      } catch (err) {
        // money was taken but the invoice cannot absorb it (e.g. paid in cash meanwhile) → flag for refund
        appliedNote = `Not applied to ${p.invoice.invoiceNo}: ${err.message}. Refund required.`;
        await notify(tx, { type: 'DANGER', title: 'Payment not applied', message: `${p.paymentNo}: ${appliedNote}`, stationId: p.invoice.stationId, link: '#invoices' });
      }
      const updated = await tx.payment.update({
        where: { id: p.id },
        data: {
          status: 'SUCCESSFUL', verifiedAt: new Date(), providerReference: result.providerReference ?? null,
          cardBrand: result.cardBrand ?? null, cardLast4: result.cardLast4 ? String(result.cardLast4).slice(-4) : null,
          failureReason: appliedNote,
        },
      });
      await audit(tx, SYSTEM, { action: 'payment.verified', entityType: 'Payment', entityId: p.id, details: `${p.paymentNo}: ${p.method} ${p.amount} confirmed via ${source}${result.providerReference ? ` (${result.providerReference})` : ''}` });
      if (p.initiatedById) await notify(tx, { type: 'SUCCESS', title: 'Payment received', message: `${p.paymentNo}: ${p.method} ${p.amount} for ${p.invoice.invoiceNo}`, userId: p.initiatedById, link: '#invoices' });
      return { payment: updated, changed: true };
    }

    // FAILED / CANCELLED
    const status = result.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
    const updated = await tx.payment.update({ where: { id: p.id }, data: { status, failureReason: result.failureReason ?? (status === 'CANCELLED' ? 'Cancelled' : 'Declined') } });
    await audit(tx, SYSTEM, { action: `payment.${status.toLowerCase()}`, entityType: 'Payment', entityId: p.id, details: `${p.paymentNo}: ${status} via ${source}${result.failureReason ? ` — ${result.failureReason}` : ''}` });
    if (p.initiatedById) await notify(tx, { type: 'WARNING', title: `Payment ${status.toLowerCase()}`, message: `${p.paymentNo}: ${p.method} ${p.amount} — ${result.failureReason ?? status.toLowerCase()}`, userId: p.initiatedById, link: '#invoices' });
    return { payment: updated, changed: true };
  });
  return outcome;
}

// ─── Status check (server → provider) ────────────────────────

export async function refreshPaymentStatus(paymentId, { force = false } = {}) {
  const p = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw notFound('Payment not found');
  if (p.status !== 'PENDING' || !getProvider(p.method).available) return p;
  const last = lastChecked.get(p.id) ?? 0;
  if (!force && Date.now() - last < STATUS_CHECK_MIN_INTERVAL_MS) return p;
  lastChecked.set(p.id, Date.now());
  const result = await getProvider(p.method).checkStatus(p);
  if (result.status === 'PENDING') return p;
  return (await settlePayment(p.id, result, 'status_check')).payment;
}

// ─── Webhooks ────────────────────────────────────────────────

export async function handleWebhook(method, rawBody, headers) {
  const provider = getProvider(method);
  const v = provider.verifyWebhook(rawBody, headers);
  if (!v.valid) {
    const err = new AppError(401, 'Webhook signature verification failed', 'BAD_SIGNATURE');
    err.details = v.error;
    throw err;
  }
  if (!v.eventId || !v.reference) throw badRequest('Webhook missing event id or reference');

  // SECTION: dedupe deliveries — providers retry webhooks
  try {
    await prisma.webhookEvent.create({ data: { provider: method, eventId: String(v.eventId), signatureValid: true, payload: sanitize(v.event ?? {}) } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { duplicate: true };
    throw err;
  }

  const payment = await prisma.payment.findUnique({ where: { reference: String(v.reference) } });
  if (!payment || payment.method !== method) {
    await prisma.webhookEvent.update({ where: { provider_eventId: { provider: method, eventId: String(v.eventId) } }, data: { error: 'Unknown payment reference', processedAt: new Date() } });
    return { ignored: true };
  }
  // SECTION: confirm with the provider before settling (a valid signature alone is not enough)
  const result = provider.confirmWebhookByStatusCheck ? await provider.checkStatus(payment) : { status: v.status, raw: v.event };
  const { payment: updated } = await settlePayment(payment.id, result, 'webhook');
  await prisma.webhookEvent.update({ where: { provider_eventId: { provider: method, eventId: String(v.eventId) } }, data: { processedAt: new Date() } });
  return { paymentId: updated.id, status: updated.status };
}

// ─── Cancel / expire ─────────────────────────────────────────

export async function cancelPayment(req, paymentId) {
  const p = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw notFound('Payment not found');
  if (p.status !== 'PENDING') throw conflict(`Payment is already ${p.status.toLowerCase()}`);
  // the customer may have just approved — ask the provider first so a real payment is never discarded
  const latest = await refreshPaymentStatus(p.id, { force: true });
  if (latest.status !== 'PENDING') return latest;
  const provider = getProvider(p.method);
  try {
    await provider.cancel(p);
  } catch { /* provider may not support cancel; we still stop tracking it */ }
  const { payment } = await settlePayment(p.id, { status: 'CANCELLED', failureReason: `Cancelled by ${req.user.name}` }, 'cancel');
  return payment;
}

export async function expireStalePayments() {
  const cutoff = new Date(Date.now() - PENDING_TIMEOUT_MINUTES * 60000);
  const recent = new Date(Date.now() - 30000);
  const pending = await prisma.payment.findMany({ where: { status: 'PENDING', method: { in: ['ZAAD', 'EDAHAB', 'MASTERCARD'] }, createdAt: { lt: recent } }, take: 100 });
  for (const p of pending) {
    try {
      const latest = await refreshPaymentStatus(p.id, { force: true });
      if (latest.status === 'PENDING' && p.createdAt < cutoff) {
        await settlePayment(p.id, { status: 'CANCELLED', failureReason: `Expired after ${PENDING_TIMEOUT_MINUTES} minutes without confirmation` }, 'expiry');
      }
    } catch (err) {
      console.error(`[payments] status sweep failed for ${p.paymentNo}:`, err.message);
    }
  }
}

// ─── Refunds through the provider ────────────────────────────

export async function processProviderRefund(req, refundId) {
  const refund = await prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
  if (!refund) throw notFound('Refund not found');
  if (refund.status !== 'APPROVED') throw conflict(refund.status === 'COMPLETED' ? 'Refund already completed' : 'Refund must be approved first');
  if (!refund.payment) throw badRequest('Refund is not linked to an electronic payment');
  const provider = getProvider(refund.payment.method);

  const result = await provider.refund(refund.payment, refund.amount);
  await logEvent(prisma, refund.payment.id, 'REFUND', { providerStatus: result.status, request: { refundNo: refund.refundNo, amount: refund.amount.toString() }, response: result.raw });
  if (result.status !== 'SUCCESSFUL') {
    await audit(prisma, req, { action: 'refund.provider_pending', entityType: 'Refund', entityId: refund.id, details: `${refund.refundNo}: provider returned ${result.status}` });
    return prisma.refund.findUnique({ where: { id: refund.id } });
  }
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT "id" FROM "Refund" WHERE "id" = ${refund.id} FOR UPDATE`;
    if (!rows.length) throw notFound('Refund not found');
    const current = await tx.refund.findUnique({ where: { id: refund.id } });
    if (current.status !== 'APPROVED') return current; // processed concurrently
    const done = await tx.refund.update({ where: { id: refund.id }, data: { status: 'COMPLETED', providerReference: result.providerReference ?? null } });
    await finalizeRefund(tx, refund);
    await audit(tx, req, { action: 'refund.completed', entityType: 'Refund', entityId: refund.id, details: `${refund.refundNo}: ${refund.amount} returned via ${refund.payment.method}${result.providerReference ? ` (${result.providerReference})` : ''}` });
    return done;
  });
}

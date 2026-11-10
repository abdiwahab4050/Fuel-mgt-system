/**
 * /api — electronic payments (ZAAD, eDAHAB, Mastercard).
 *
 *  POST /invoices/:id/pay        start a payment (staff, or a customer for their own invoice)
 *  GET  /payments/:id            status; a PENDING payment is re-checked with the provider server-side
 *  POST /payments/:id/cancel     stop waiting for a pending payment
 *  POST /webhooks/:provider      provider notifications (signature-verified, deduplicated, confirmed by status check)
 *  GET  /payments/providers      which methods are usable right now
 *
 * Sandbox only (PAYMENT_MODE=sandbox, refused in production):
 *  GET  /payments/sandbox/checkout/:reference   simulated hosted card page
 *  POST /payments/sandbox/:reference/:action    simulate the customer approving/declining/cancelling
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { can, requireAuth, requirePermission, stationScope } from '../middleware/auth.js';
import { invoiceScope } from './sales.js';
import { cancelPayment, handleWebhook, initiatePayment, refreshPaymentStatus } from '../services/payments/index.js';
import { ELECTRONIC, getProvider, providerSummary } from '../services/payments/providers/index.js';
import { simulateCustomerAction } from '../services/payments/providers/sandbox.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { money, optionalText } from '../lib/validation.js';

const router = express.Router();

// ─── Provider availability ───────────────────────────────────

router.get('/payments/providers', requireAuth, (req, res) => {
  res.json({ mode: env.PAYMENT_MODE, providers: providerSummary() });
});

// Setup checklist for administrators — env var NAMES only, never values
router.get('/payments/providers/status', requirePermission('payments.configure'), (req, res) => {
  res.json({ mode: env.PAYMENT_MODE, providers: providerSummary({ includeRequirements: true }) });
});

// ─── Start a payment ─────────────────────────────────────────

router.post('/invoices/:id/pay', requirePermission('payments.receive', 'invoices.view_own'), async (req, res) => {
  const body = z.object({
    method: z.enum(ELECTRONIC),
    phone: optionalText(20),
    amount: money({ positive: true }).optional(),
    idempotencyKey: z.string().trim().min(8).max(64),
  }).parse(req.body);
  const invoice = await prisma.invoice.findFirst({ where: { id: req.params.id, ...invoiceScope(req) }, select: { id: true } });
  if (!invoice) throw notFound('Invoice not found');
  if (getProvider(body.method).flow === 'mobile' && !body.phone) throw badRequest('Enter the customer\'s mobile number');

  const result = await initiatePayment(req, invoice.id, body);
  res.status(result.replayed ? 200 : 201).json({
    payment: publicPayment(result.payment),
    redirectUrl: result.redirectUrl ?? null,
    instructions: result.instructions ?? null,
    sandbox: env.PAYMENT_MODE === 'sandbox',
  });
});

// ─── Status ──────────────────────────────────────────────────

function publicPayment(p) {
  return {
    id: p.id, paymentNo: p.paymentNo, reference: p.reference, invoiceId: p.invoiceId, method: p.method,
    amount: p.amount, currency: p.currency, status: p.status, failureReason: p.failureReason,
    providerReference: p.providerReference, cardBrand: p.cardBrand, cardLast4: p.cardLast4,
    payerPhone: p.payerPhone ? `${p.payerPhone.slice(0, 3)}****${p.payerPhone.slice(-2)}` : null,
    createdAt: p.createdAt, verifiedAt: p.verifiedAt,
  };
}

async function loadScopedPayment(req, id) {
  const p = await prisma.payment.findUnique({ where: { id }, include: { invoice: { select: { stationId: true, customerId: true } } } });
  if (!p) throw notFound('Payment not found');
  const staffOk = can(req.user, 'payments.view', 'payments.receive') && (!stationScope(req) || p.invoice.stationId === stationScope(req));
  const ownOk = p.initiatedById === req.user.id || (req.user.customerId && p.invoice.customerId === req.user.customerId);
  if (!staffOk && !ownOk) throw notFound('Payment not found');
  return p;
}

// Browser return after a redirect checkout — never settles anything, just takes the user back to the invoice
// (declared before /payments/:id so it is not captured as an id)
router.get('/payments/return', (req, res) => {
  const ref = typeof req.query.ref === 'string' ? req.query.ref.replace(/[^\w-]/g, '') : '';
  res.redirect(`/app.html#invoices${ref ? `?payment=${ref}` : ''}`);
});

router.get('/payments/:id', requireAuth, async (req, res) => {
  const p = await loadScopedPayment(req, req.params.id);
  const latest = p.status === 'PENDING' ? await refreshPaymentStatus(p.id) : p;
  const invoice = await prisma.invoice.findUnique({ where: { id: latest.invoiceId }, select: { id: true, invoiceNo: true, status: true, total: true, amountPaid: true } });
  res.json({ payment: publicPayment(latest), invoice });
});

router.post('/payments/:id/cancel', requireAuth, async (req, res) => {
  const p = await loadScopedPayment(req, req.params.id);
  if (!can(req.user, 'payments.receive') && p.initiatedById !== req.user.id) throw forbidden('You can only cancel payments you started');
  res.json({ payment: publicPayment(await cancelPayment(req, p.id)) });
});

// ─── Sandbox simulator ───────────────────────────────────────

function requireSandbox(req, res, next) {
  if (env.PAYMENT_MODE !== 'sandbox' || env.NODE_ENV === 'production') return next(notFound());
  next();
}

router.get('/payments/sandbox/checkout/:reference', requireSandbox, requireAuth, async (req, res) => {
  const p = await prisma.payment.findUnique({ where: { reference: req.params.reference } });
  if (!p || p.method !== 'MASTERCARD') throw notFound('Payment not found');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sandbox card checkout</title><style>
body{font-family:Inter,Arial,sans-serif;background:#eef1f6;margin:0;padding:24px;color:#0b1c30}
.card{max-width:420px;margin:40px auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 8px 30px rgba(0,0,0,.08)}
.banner{background:#fff3cd;border:1px solid #e0b94a;padding:10px 12px;border-radius:8px;font-size:13px;margin-bottom:18px}
h1{font-size:18px;margin:0 0 4px} .amt{font-size:30px;font-weight:700;margin:14px 0} .muted{color:#5b6070;font-size:13px}
button{width:100%;padding:12px;border-radius:8px;border:0;font-size:15px;font-weight:600;margin-top:10px;cursor:pointer}
.ok{background:#006c49;color:#fff} .no{background:#ba1a1a;color:#fff} .cx{background:#e5e8ef;color:#0b1c30}
.done{display:none;text-align:center;font-weight:600;margin-top:16px}
</style></head><body><div class="card">
<div class="banner"><strong>SANDBOX — NOT A REAL PAYMENT.</strong> This page stands in for the bank's secure Mastercard checkout. No card details are collected.</div>
<h1>Pay with Mastercard</h1><div class="muted">Reference ${esc(p.reference)}</div>
<div class="amt">${esc(p.currency)} ${esc(p.amount.toFixed(2))}</div>
<div class="muted">Test card: MASTERCARD •••• 0008</div>
${p.status === 'PENDING' ? `
<button class="ok" data-a="approve">Approve payment</button>
<button class="no" data-a="decline">Simulate decline</button>
<button class="cx" data-a="cancel">Cancel and return</button>` : `<p class="done" style="display:block">This payment is ${esc(p.status.toLowerCase())}.</p>`}
<p class="done" id="done">Processing… returning to the station app.</p></div>
<script>
document.querySelectorAll('button[data-a]').forEach(function(b){b.addEventListener('click',function(){
  document.querySelectorAll('button').forEach(function(x){x.disabled=true});document.getElementById('done').style.display='block';
  fetch('/api/payments/sandbox/${encodeURIComponent(p.reference)}/'+b.dataset.a,{method:'POST',credentials:'same-origin',headers:{'X-Requested-With':'fuelflow','Content-Type':'application/json'},body:'{}'})
    .finally(function(){ if (window.opener) { window.close(); } else { location.href='/api/payments/return?ref=${encodeURIComponent(p.id)}'; } });
});});
</script></body></html>`);
});

router.post('/payments/sandbox/:reference/:action', requireSandbox, requireAuth, async (req, res) => {
  const { action } = req.params;
  if (!['approve', 'decline', 'cancel'].includes(action)) throw badRequest('Unknown sandbox action');
  const p = await prisma.payment.findUnique({ where: { reference: req.params.reference } });
  if (!p) throw notFound('Payment not found');
  const hook = simulateCustomerAction(p.reference, action);
  if (!hook) throw notFound('Sandbox has no record of this payment (was the server restarted?)');
  // deliver the provider's signed webhook through the same verification path a real one takes
  const result = await handleWebhook(p.method, hook.rawBody, hook.headers);
  res.json({ ok: true, result });
});

export default router;

// ─── Webhooks (mounted before CSRF/session middleware) ───────

export const webhookRouter = express.Router();

webhookRouter.post('/webhooks/:provider', async (req, res) => {
  const method = String(req.params.provider).toUpperCase();
  if (!ELECTRONIC.includes(method)) throw notFound();
  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));
  const result = await handleWebhook(method, rawBody, headers);
  res.json({ received: true, ...result });
});

/**
 * SANDBOX payment provider — a stand-in for ZAAD, eDAHAB and Mastercard
 * during development and testing. It is refused when NODE_ENV=production
 * (see config/env.js), and every reference it issues starts with "SBX-".
 *
 * It behaves like a real provider from the server's point of view:
 *  - its state lives server-side (never in the browser);
 *  - "customer actions" (approve on phone, pay on hosted checkout) change that
 *    state and produce a webhook signed with HMAC-SHA256 over "<timestamp>.<body>";
 *  - the app still confirms every webhook with a server-side status check.
 *
 * Test rules for mobile money: a payer phone ending in 0 is declined
 * ("insufficient balance") when the customer approves.
 */
import crypto from 'node:crypto';
import { env } from '../../../config/env.js';

const SECRET = process.env.SANDBOX_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');
const state = new Map(); // reference → simulated provider-side transaction

export const SIGNATURE_HEADER = 'x-sandbox-signature';
export const TIMESTAMP_HEADER = 'x-sandbox-timestamp';
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function signSandbox(rawBody, timestamp) {
  return crypto.createHmac('sha256', SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const MOBILE = ['ZAAD', 'EDAHAB'];

export function createSandboxProvider(method) {
  return {
    method,
    mode: 'sandbox',
    available: true,
    label: { ZAAD: 'ZAAD', EDAHAB: 'eDAHAB', MASTERCARD: 'Mastercard' }[method],
    flow: MOBILE.includes(method) ? 'mobile' : 'redirect',
    confirmWebhookByStatusCheck: true,

    async initiate({ payment, phone }) {
      const providerReference = `SBX-${method}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
      state.set(payment.reference, {
        method, status: 'PENDING', amount: payment.amount.toString(), currency: payment.currency,
        phone: phone ?? null, providerReference, createdAt: Date.now(),
      });
      return {
        status: 'PENDING',
        providerReference,
        redirectUrl: method === 'MASTERCARD' ? `${env.APP_URL}/api/payments/sandbox/checkout/${encodeURIComponent(payment.reference)}` : null,
        instructions: MOBILE.includes(method)
          ? `A payment request for ${payment.currency} ${payment.amount} was sent to ${phone}. The customer approves it on their phone.`
          : 'The customer completes the card payment on the secure payment page.',
        raw: { sandbox: true, providerReference, status: 'PENDING' },
      };
    },

    // SECTION: authoritative status — read from provider-side state, never from the browser
    async checkStatus(payment) {
      const s = state.get(payment.reference);
      if (!s) return { status: 'PENDING', raw: { sandbox: true, note: 'unknown to sandbox (server restarted?)' } };
      return {
        status: s.status, amount: s.amount, currency: s.currency, providerReference: s.providerReference,
        cardBrand: s.cardBrand ?? null, cardLast4: s.cardLast4 ?? null, failureReason: s.failureReason ?? null,
        raw: { sandbox: true, status: s.status, providerReference: s.providerReference },
      };
    },

    async cancel(payment) {
      const s = state.get(payment.reference);
      if (s && s.status === 'PENDING') s.status = 'CANCELLED';
      return { status: 'CANCELLED', raw: { sandbox: true } };
    },

    async refund(payment, amount) {
      return { status: 'SUCCESSFUL', providerReference: `SBX-RF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, raw: { sandbox: true, amount: amount.toString() } };
    },

    // SECTION: webhook verification — signature over timestamp + raw body, with replay window
    verifyWebhook(rawBody, headers) {
      const ts = Number(headers[TIMESTAMP_HEADER]);
      const sig = headers[SIGNATURE_HEADER];
      if (!ts || !sig) return { valid: false, error: 'Missing signature headers' };
      if (Math.abs(Date.now() / 1000 - ts) > WEBHOOK_TOLERANCE_SECONDS) return { valid: false, error: 'Timestamp outside tolerance' };
      if (!safeEqual(signSandbox(rawBody, ts), sig)) return { valid: false, error: 'Bad signature' };
      let event;
      try {
        event = JSON.parse(rawBody);
      } catch {
        return { valid: false, error: 'Malformed body' };
      }
      return { valid: true, eventId: event.eventId, reference: event.reference, status: event.status, event };
    },
  };
}

// SECTION: simulate the customer acting at the provider (approve on phone / pay on checkout page)
export function simulateCustomerAction(reference, action, { cardLast4 = '0008' } = {}) {
  const s = state.get(reference);
  if (!s) return null;
  if (s.status === 'PENDING') {
    if (action === 'approve') {
      if (s.phone && /0$/.test(s.phone)) {
        s.status = 'FAILED';
        s.failureReason = 'Insufficient balance (sandbox rule: phone ending in 0)';
      } else {
        s.status = 'SUCCESSFUL';
        if (s.method === 'MASTERCARD') {
          s.cardBrand = 'MASTERCARD';
          s.cardLast4 = cardLast4;
        }
      }
    } else if (action === 'decline') {
      s.status = 'FAILED';
      s.failureReason = s.method === 'MASTERCARD' ? 'Card declined by issuer (sandbox)' : 'Customer rejected the request (sandbox)';
    } else if (action === 'cancel') {
      s.status = 'CANCELLED';
    }
  }
  return buildSignedWebhook({ eventId: `evt_${crypto.randomBytes(8).toString('hex')}`, reference, status: s.status, providerReference: s.providerReference });
}

export function buildSignedWebhook(event, timestamp = Math.floor(Date.now() / 1000)) {
  const rawBody = JSON.stringify(event);
  return { rawBody, headers: { [TIMESTAMP_HEADER]: String(timestamp), [SIGNATURE_HEADER]: signSandbox(rawBody, timestamp) } };
}

// test hook: lets tests simulate a provider reporting a different amount
export function _sandboxState() {
  return state;
}

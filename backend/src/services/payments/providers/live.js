/**
 * LIVE provider adapters — ZAAD, eDAHAB, Mastercard.
 *
 * Status: NOT IMPLEMENTED. No official merchant API documentation or
 * credentials were available when this was written, and endpoint paths,
 * request fields and signature schemes must not be guessed for real money.
 * Each adapter therefore reports itself unavailable and lists exactly what
 * is needed. The rest of the system (initiation, verification, settlement,
 * idempotency, webhooks, refunds) is provider-agnostic and already works
 * against the sandbox, so activating a provider means implementing the five
 * functions below against its official documentation:
 *
 *   initiate({ payment, phone, returnUrl })
 *     → { status: 'PENDING'|'FAILED', providerReference?, redirectUrl?, instructions?, raw }
 *   checkStatus(payment)          // server-to-provider; this is the authoritative check
 *     → { status: 'PENDING'|'SUCCESSFUL'|'FAILED'|'CANCELLED', amount, currency, providerReference,
 *         cardBrand?, cardLast4?, failureReason?, raw }
 *   verifyWebhook(rawBody, headers)
 *     → { valid, eventId, reference, status, error? }   // signature/HMAC as the provider specifies
 *   refund(payment, amount)
 *     → { status: 'SUCCESSFUL'|'PENDING'|'FAILED', providerReference?, raw }
 *   cancel(payment)               // optional; void a still-pending request
 *
 * `raw` is stored in PaymentTransaction for audit — strip secrets and never
 * include full card numbers or CVV.
 */

// SECTION: what each provider needs before it can go live
export const LIVE_REQUIREMENTS = {
  ZAAD: {
    label: 'ZAAD',
    flow: 'mobile',
    env: ['ZAAD_API_BASE_URL', 'ZAAD_MERCHANT_ID', 'ZAAD_API_KEY', 'ZAAD_WEBHOOK_SECRET'],
    obtainFrom: 'Telesom ZAAD merchant services',
    documents: [
      'Merchant API specification: payment request (push to customer phone), transaction status query, refund/reversal',
      'Callback/webhook format and how callbacks are signed or authenticated',
      'Sandbox/test environment URL, test merchant credentials and test phone numbers',
      'Allowed currencies, amount limits and phone number format',
    ],
  },
  EDAHAB: {
    label: 'eDAHAB',
    flow: 'mobile',
    env: ['EDAHAB_API_BASE_URL', 'EDAHAB_API_KEY', 'EDAHAB_SECRET', 'EDAHAB_AGENT_CODE', 'EDAHAB_WEBHOOK_SECRET'],
    obtainFrom: 'eDahab (Dahabshil) merchant services',
    documents: [
      'Merchant API specification: invoice/payment request, payment status check, refund',
      'Request signing (hash) method and callback verification',
      'Sandbox/test environment, test merchant account and test wallet numbers',
      'Allowed currencies, limits and phone number format',
    ],
  },
  MASTERCARD: {
    label: 'Mastercard',
    flow: 'redirect',
    env: ['MASTERCARD_GATEWAY_BASE_URL', 'MASTERCARD_MERCHANT_ID', 'MASTERCARD_API_PASSWORD', 'MASTERCARD_WEBHOOK_SECRET'],
    obtainFrom: 'your acquiring bank (merchant agreement + payment gateway account, e.g. Mastercard Gateway hosted checkout)',
    documents: [
      'Gateway API version and base URL assigned by the acquirer',
      'Hosted checkout / session creation, order retrieval (status) and refund operations',
      'Webhook (notification) configuration and secret',
      'Test merchant ID, test cards and 3-D Secure test flows',
      'PCI DSS scope confirmation: card data must be entered only on the gateway-hosted page (SAQ A)',
    ],
  },
};

export function missingEnv(method) {
  return LIVE_REQUIREMENTS[method].env.filter((k) => !process.env[k]);
}

export function createLiveProvider(method) {
  const req = LIVE_REQUIREMENTS[method];
  const missing = missingEnv(method);
  const reason = missing.length
    ? `${req.label} is not configured. Missing: ${missing.join(', ')}.`
    : `${req.label} credentials are present, but the live adapter has not been implemented yet. It must be built from ${req.obtainFrom}'s official API documentation (see src/services/payments/providers/live.js).`;
  const unavailable = () => {
    const err = new Error(reason);
    err.status = 503;
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  };
  return {
    method,
    mode: 'live',
    label: req.label,
    flow: req.flow,
    available: false,
    implemented: false,
    configured: missing.length === 0,
    missingEnv: missing,
    unavailableReason: reason,
    confirmWebhookByStatusCheck: true,
    initiate: unavailable,
    checkStatus: unavailable,
    refund: unavailable,
    cancel: unavailable,
    verifyWebhook: () => ({ valid: false, error: reason }),
  };
}

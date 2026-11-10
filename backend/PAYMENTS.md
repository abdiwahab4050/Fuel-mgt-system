# Electronic Payments: ZAAD, eDAHAB, Mastercard

## Current status

| Provider | Sandbox (development) | Live |
|---|---|---|
| ZAAD | Working (simulated) | **Not implemented.** Needs Telesom merchant API documentation and credentials. |
| eDAHAB | Working (simulated) | **Not implemented.** Needs eDahab merchant API documentation and credentials. |
| Mastercard | Working (simulated hosted checkout) | **Not implemented.** Needs an acquiring bank and its gateway documentation and credentials. |

The live adapters in `src/services/payments/providers/live.js` report themselves unavailable. Without verified documentation, the endpoints and signature schemes have not been guessed.

Everything else is provider-agnostic and tested against the sandbox:
- starting a payment
- verification and settlement
- idempotency
- webhooks
- expiry
- refunds

## How a payment works

1. **The customer selects fuel and the system calculates the amount.** A sale creates an **UNPAID** invoice.
2. **Staff, or a customer on their own invoice, chooses a method.** The API call is `POST /api/invoices/:id/pay`.
   - This creates a **PENDING** payment with a unique merchant reference (`FF-PAY-…`) and an idempotency key.
   - Only one payment can be in flight per invoice. Cash payments and sale cancellations are blocked while it is pending.
3. **The provider receives the request.**
   - ZAAD and eDAHAB push it to the customer's phone.
   - Mastercard opens the bank's hosted card page.
   - Card details are never entered into or stored by this system. Only the card brand and last 4 digits are kept.
4. **The provider confirms.** Either path below leads to the same settlement:
   - **Webhook:** `POST /api/webhooks/{zaad|edahab|mastercard}`. The signature is verified over the raw request body, with a timestamp window to block replays. Each event is processed once (deduplicated by provider and event ID). The webhook is then **confirmed with a server-to-provider status check**; a signed message alone is not trusted.
   - **Status poll:** `GET /api/payments/:id` re-checks with the provider (at most every 4 s). A background sweep runs every minute.
5. **The server settles the payment.** All of this happens in one database transaction with the payment and invoice rows locked:
   - The amount and currency must match what was requested. If not, the payment is marked FAILED and flagged for manual review.
   - A provider transaction ID can settle only one payment.
   - The invoice moves to PAID or PARTIALLY_PAID.
   - If the invoice can no longer accept the money (for example, it was paid in cash in the meantime), the payment is recorded and a "refund required" alert is raised.
6. **The receipt is printed** from the invoice. Sandbox payments are marked "SANDBOX — not a real payment".

Payment statuses: **Pending, Successful, Failed, Cancelled, Refunded.** A pending payment expires after `PAYMENT_PENDING_TIMEOUT_MINUTES` (default 15), but only after a final status check.

**The browser never decides the outcome.** No endpoint accepts a client-declared "success". The card checkout's return URL only sends the user back to the invoice.

## Refunds

- A refund is requested on the invoice.
- It must be approved by someone other than the requester.
- After approval, `provider.refund()` is called.
- If the provider fails, the refund stays APPROVED and can be retried from the Refunds tab.

## Activating a provider for live payments

1. **Obtain from the provider or acquiring bank:**
   - the official API specification
   - sandbox credentials and test numbers or cards
   - the webhook signing method
   - for Mastercard: the PCI DSS scope (use a hosted checkout, so card data stays on the bank's page)

   The admin panel at **Settings → Payment Providers** lists the exact items for each provider.
2. **Implement the adapter's functions** in `live.js`:
   - `initiate`
   - `checkStatus`
   - `verifyWebhook`
   - `refund`
   - `cancel`

   The contract is documented at the top of the file. Set `available: true` only when all of them work.
3. **Add the credentials to the server's `.env`.** They must never go in the frontend. The variable names are in `.env.example`.
4. **Register the webhook URL** with the provider: `<APP_URL>/api/webhooks/<provider>`. It must be HTTPS.
5. **Test in the provider's sandbox** with `PAYMENT_MODE=live`. Run `npm test` and the manual test plan:
   - successful payment
   - declined payment
   - customer cancels
   - timeout
   - duplicate webhook
   - partial payment
   - refund
6. **Go live:** `NODE_ENV=production`, `PAYMENT_MODE=live` and `COOKIE_SECURE=true`. The server refuses to start in production with the sandbox.

## Sandbox test rules

- **Mobile money (ZAAD, eDAHAB):** the payment modal has "Customer approves" and "Customer declines" buttons, which act as the customer's phone. A phone number ending in **0** is declined with "insufficient balance".
- **Mastercard:** opens `/api/payments/sandbox/checkout/<reference>`, a clearly labelled stand-in page with Approve, Decline and Cancel buttons. It collects no card data.
- **How simulations are processed:** they produce a signed webhook that goes through the same verification and settlement code as a real one.

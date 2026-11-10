/**
 * FuelFlow ERP - Electronic payment flow (ZAAD, eDAHAB, Mastercard)
 *
 * The browser only starts a payment and asks the server for its status.
 * The server confirms with the provider; nothing here can mark a payment paid.
 */
const PaymentFlow = {
  providers: null,
  mode: null,
  // SECTION: watch state — one active watch at a time; a new token stops the previous poller
  _token: 0,
  POLL_MS: 3000,
  MAX_WAIT_MS: 16 * 60 * 1000,

  async loadProviders() {
    if (this.providers) return this.providers;
    try {
      const res = await Api.get('/payments/providers');
      this.providers = res.providers;
      this.mode = res.mode;
    } catch {
      this.providers = [];
    }
    return this.providers;
  },

  available() {
    return (this.providers || []).filter((p) => p.available);
  },

  provider(method) {
    return (this.providers || []).find((p) => p.method === method);
  },

  sandboxBanner() {
    return this.mode === 'sandbox'
      ? '<div class="p-3 rounded-lg bg-tertiary-fixed-dim/20 border border-tertiary-fixed-dim text-sm mb-4"><strong>SANDBOX MODE</strong> — simulated provider, no real money moves. Live ZAAD, eDAHAB and Mastercard need merchant credentials and API documentation.</div>'
      : '';
  },

  // SECTION: start — collect phone/amount, then create the payment on the server
  async start(invoice, method, { phone = '', onDone = null } = {}) {
    await this.loadProviders();
    const p = this.provider(method);
    if (!p?.available) return Utils.toast(p?.reason || `${method} payments are not available`, 'error');
    const balance = Billing.balance(invoice);
    this.ctx = { invoice, method, onDone, key: Utils.idempotencyKey() };

    Utils.openModal(`Pay with ${Utils.escapeHtml(p.label)}`, `
      ${this.sandboxBanner()}
      <form id="epay-form" onsubmit="event.preventDefault(); PaymentFlow.submit()">
        <p class="text-sm text-outline mb-4">Invoice <strong>${Utils.escapeHtml(invoice.invoiceNo)}</strong> · balance due <strong>${Utils.formatCurrency(balance)}</strong></p>
        ${p.flow === 'mobile' ? `
          <div class="form-group"><label class="form-label">Customer's ${Utils.escapeHtml(p.label)} number</label>
            <input name="phone" type="tel" inputmode="tel" class="form-input text-lg" required value="${Utils.escapeHtml(phone)}" placeholder="e.g. 252634000000" autocomplete="off"/>
            <p class="text-xs text-outline mt-1">The customer receives a request on their phone and approves it with their PIN.${this.mode === 'sandbox' ? ' Sandbox: numbers ending in 0 are declined.' : ''}</p></div>`
          : '<p class="text-sm mb-4">The customer pays on the bank\'s secure card page. Card details are never typed into or stored by this system.</p>'}
        <div class="form-group"><label class="form-label">Amount</label>
          <input name="amount" type="number" step="0.01" min="0.01" max="${balance.toFixed(2)}" value="${balance.toFixed(2)}" class="form-input" required/></div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button id="epay-submit" onclick="PaymentFlow.submit()" class="px-5 py-2 bg-secondary text-on-secondary rounded font-semibold">${p.flow === 'mobile' ? 'Send Payment Request' : 'Open Secure Checkout'}</button>`);
  },

  async submit() {
    const form = document.getElementById('epay-form');
    const btn = document.getElementById('epay-submit');
    if (!form || btn.disabled) return;
    const d = Utils.getFormData('epay-form');
    const { invoice, method, key } = this.ctx;
    const p = this.provider(method);

    // open the checkout window synchronously (popup blockers allow it only during the click)
    const popup = p.flow === 'redirect' ? window.open('about:blank', 'fuelflow-checkout') : null;
    btn.disabled = true;
    btn.textContent = 'Starting...';
    try {
      const res = await Api.post(`/invoices/${invoice.id}/pay`, { method, phone: d.phone || null, amount: d.amount, idempotencyKey: key });
      if (res.redirectUrl) {
        if (popup) popup.location.href = res.redirectUrl;
        else window.open(res.redirectUrl, 'fuelflow-checkout');
      } else if (popup) popup.close();
      this.watch(res.payment.id, { redirectUrl: res.redirectUrl, instructions: res.instructions });
    } catch (err) {
      if (popup) popup.close();
      btn.disabled = false;
      btn.textContent = 'Try Again';
      if (err.code === 'CONFLICT' && err.details?.paymentId) {
        Utils.toast(err.message, 'error');
        return this.watch(err.details.paymentId, {});
      }
      Utils.toast(err.fullMessage || err.message, 'error');
    }
  },

  // SECTION: watch — poll the server (which asks the provider) until the payment is final
  async watch(paymentId, { redirectUrl = null, instructions = null } = {}) {
    await this.loadProviders();
    const token = ++this._token;
    const started = Date.now();
    this.ctx = { ...(this.ctx || {}), paymentId, redirectUrl, instructions };
    let first = true;

    while (token === this._token) {
      let res;
      try {
        res = await Api.get(`/payments/${paymentId}`);
      } catch (err) {
        if (first) return Utils.toast(err.message, 'error');
        res = null; // transient network error: keep waiting
      }
      if (token !== this._token) return;
      if (res) {
        this.renderStatus(res.payment, res.invoice);
        if (res.payment.status !== 'PENDING') return this.finish(res.payment, res.invoice);
      }
      first = false;
      if (Date.now() - started > this.MAX_WAIT_MS) return;
      await new Promise((r) => setTimeout(r, this.POLL_MS));
      // stop polling if the user closed the modal (closeModal hides the overlay but keeps its content)
      if (!this.statusVisible()) {
        this._token++;
        return;
      }
    }
  },

  statusVisible() {
    return !!document.getElementById('epay-status') && !!document.getElementById('modal-overlay')?.classList.contains('active');
  },

  renderStatus(payment, invoice) {
    const p = this.provider(payment.method) || { label: payment.method, flow: 'mobile' };
    if (this.statusVisible() && payment.status === 'PENDING') {
      document.getElementById('epay-elapsed').textContent = `Checked ${new Date().toLocaleTimeString()}`;
      return;
    }
    if (payment.status !== 'PENDING') return;
    const sandbox = this.mode === 'sandbox';
    Utils.openModal(`${Utils.escapeHtml(p.label)} payment`, `
      ${this.sandboxBanner()}
      <div id="epay-status" class="text-center space-y-3">
        <span class="material-symbols-outlined text-5xl text-secondary animate-pulse">${p.flow === 'mobile' ? 'smartphone' : 'credit_card'}</span>
        <p class="text-headline-md font-headline-md">${Utils.formatCurrency(payment.amount)}</p>
        <p class="font-semibold">${p.flow === 'mobile' ? 'Waiting for the customer to approve on their phone' : 'Waiting for the customer to finish on the secure card page'}</p>
        ${payment.payerPhone ? `<p class="text-sm text-outline">Sent to ${Utils.escapeHtml(payment.payerPhone)}</p>` : ''}
        <p class="text-sm text-outline">${Utils.escapeHtml(payment.paymentNo)} · ${Utils.escapeHtml(invoice.invoiceNo)} · ref ${Utils.escapeHtml(payment.reference)}</p>
        <p class="text-xs text-outline" id="epay-elapsed">Checking with ${Utils.escapeHtml(p.label)}…</p>
        ${this.ctx?.redirectUrl ? `<button type="button" onclick="window.open('${Utils.escapeHtml(this.ctx.redirectUrl)}', 'fuelflow-checkout')" class="text-sm text-secondary font-semibold hover:underline">Re-open secure checkout</button>` : ''}
        ${sandbox && p.flow === 'mobile' ? `
          <div class="pt-3 border-t border-outline-variant">
            <p class="text-xs text-outline mb-2">SANDBOX: act as the customer's phone</p>
            <div class="flex gap-2 justify-center">
              <button type="button" onclick="PaymentFlow.simulate('${Utils.escapeHtml(payment.reference)}', 'approve')" class="px-3 py-1.5 bg-secondary text-on-secondary rounded text-sm">Customer approves</button>
              <button type="button" onclick="PaymentFlow.simulate('${Utils.escapeHtml(payment.reference)}', 'decline')" class="px-3 py-1.5 bg-error text-on-error rounded text-sm">Customer declines</button>
            </div>
          </div>` : ''}
      </div>`, `
      <button onclick="PaymentFlow.cancel('${payment.id}')" class="px-4 py-2 border border-error/40 text-error rounded">Cancel Payment</button>
      <button onclick="PaymentFlow.refreshNow('${payment.id}')" class="px-4 py-2 border border-outline-variant rounded">Check Now</button>`);
  },

  // SECTION: final screen — success with receipt, or failure with retry
  finish(payment, invoice) {
    const ok = payment.status === 'SUCCESSFUL';
    const p = this.provider(payment.method) || { label: payment.method };
    Utils.openModal(ok ? 'Payment Received' : `Payment ${payment.status.toLowerCase()}`, `
      <div class="text-center space-y-3">
        <span class="material-symbols-outlined text-5xl ${ok ? 'text-secondary' : 'text-error'}">${ok ? 'check_circle' : 'cancel'}</span>
        <p class="text-headline-md font-headline-md">${Utils.formatCurrency(payment.amount)} · ${Utils.escapeHtml(p.label)}</p>
        <p class="text-sm text-outline">${Utils.escapeHtml(payment.paymentNo)}${payment.providerReference ? ` · ${Utils.escapeHtml(payment.providerReference)}` : ''}${payment.cardLast4 ? ` · ${Utils.escapeHtml(payment.cardBrand || 'Card')} ••${Utils.escapeHtml(payment.cardLast4)}` : ''}</p>
        ${payment.failureReason ? `<p class="text-sm ${ok ? 'text-tertiary-fixed-dim' : 'text-error'}">${Utils.escapeHtml(payment.failureReason)}</p>` : ''}
        <p>Invoice ${Utils.escapeHtml(invoice.invoiceNo)}: ${Billing.badge(invoice.status)}</p>
        ${String(payment.providerReference || '').startsWith('SBX-') ? '<p class="text-xs text-outline">Sandbox payment — no real money moved.</p>' : ''}
      </div>`, `
      ${ok ? `<button onclick="Billing.printInvoice('${invoice.id}', 'receipt')" class="px-4 py-2 border border-outline-variant rounded">Print Receipt</button>` : ''}
      <button onclick="Utils.closeModal(); InvoicesPage.openInvoice('${invoice.id}')" class="px-4 py-2 ${ok ? 'border border-outline-variant' : 'bg-secondary text-on-secondary font-semibold'} rounded">${ok ? 'View Invoice' : 'Back to Invoice'}</button>
      ${ok ? '<button onclick="Utils.closeModal()" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Done</button>' : ''}`);
    Utils.toast(ok ? 'Payment confirmed by provider' : `Payment ${payment.status.toLowerCase()}`, ok ? 'success' : 'error');
    // refresh any page data that shows this invoice
    if (typeof InvoicesPage !== 'undefined') InvoicesPage.reload('invoices', 'payments', 'account');
    if (typeof SalesPage !== 'undefined') SalesPage.sales = null;
    this.ctx?.onDone?.(payment);
  },

  async refreshNow(paymentId) {
    const res = await Utils.act(() => Api.get(`/payments/${paymentId}`));
    if (res && res.payment.status !== 'PENDING') {
      this._token++;
      this.finish(res.payment, res.invoice);
    }
  },

  cancel(paymentId) {
    Utils.confirm('Stop this payment? If the customer has already approved it, it will be recorded as paid instead.', async () => {
      this._token++;
      const res = await Utils.act(() => Api.post(`/payments/${paymentId}/cancel`));
      if (!res) return;
      const inv = await Api.get(`/payments/${paymentId}`).catch(() => null);
      if (inv) this.finish(inv.payment, inv.invoice);
    });
  },

  // SECTION: sandbox only — plays the customer's phone; the server still verifies via webhook + status check
  async simulate(reference, action) {
    await Utils.act(() => Api.post(`/payments/sandbox/${encodeURIComponent(reference)}/${action}`));
  },
};

window.PaymentFlow = PaymentFlow;

/**
 * Invoices Page (Billing) — staff billing desk, and "My Account" for customers
 */
// SECTION: Invoices page object — invoices, payments, refunds; invoice detail modal is shared with Sales and Customers
const InvoicesPage = {
  tab: 'invoices',
  search: '',
  status: '',
  page: 1,
  invoices: null,
  total: 0,
  summary: null,
  payments: null,
  paymentsSummary: null,
  refunds: null,
  account: undefined,
  error: null,

  isCustomer() {
    return Auth.getSession()?.role === 'customer';
  },

  tabs() {
    return [
      ['invoices', 'Invoices', true],
      ['payments', 'Payments', Auth.can('payments.view', 'payments.view_own')],
      ['refunds', 'Refunds', Auth.can('refunds.request', 'refunds.approve')],
    ].filter(([, , ok]) => ok);
  },

  onEnter() {
    Object.assign(this, { invoices: null, payments: null, refunds: null, account: undefined, error: null });
  },

  needsLoad() {
    if (this.error) return false;
    if (this.isCustomer() && this.account === undefined) return true;
    return (this.tab === 'invoices' && !this.invoices) || (this.tab === 'payments' && !this.payments) || (this.tab === 'refunds' && !this.refunds);
  },

  async load() {
    try {
      const jobs = [];
      if (this.isCustomer() && this.account === undefined) jobs.push(Api.get('/customers/me').then((r) => { this.account = r.customer; }));
      if (this.tab === 'invoices' && !this.invoices) {
        const params = { search: this.search, page: this.page, pageSize: 20 };
        if (this.status === 'OVERDUE') params.overdue = 'true';
        else if (this.status) params.status = this.status;
        jobs.push(Api.get('/invoices', params).then((r) => Object.assign(this, { invoices: r.invoices, total: r.total, summary: r.summary })));
      }
      if (this.tab === 'payments' && !this.payments) jobs.push(Api.get('/payments', { pageSize: 50 }).then((r) => { this.payments = r.payments; this.paymentsSummary = r.byMethod; }));
      if (this.tab === 'refunds' && !this.refunds) jobs.push(Api.get('/refunds').then((r) => { this.refunds = r.refunds; }));
      await Promise.all(jobs);
      this.error = null;
    } catch (err) {
      this.error = err.message;
    }
    if (Router.currentPage === 'invoices') Router.refresh();
  },

  reload(...keys) {
    (keys.length ? keys : ['invoices', 'payments', 'refunds']).forEach((k) => { this[k] = k === 'account' ? undefined : null; });
    this.error = null;
    if (Router.currentPage === 'invoices') Router.refresh();
  },

  setTab(tab) {
    this.tab = tab;
    Router.refresh();
  },

  setFilter(key, value) {
    this[key] = value;
    this.page = 1;
    this.reload('invoices');
  },

  render() {
    const customer = this.isCustomer();
    const header = `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">${customer ? 'My Account' : 'Billing & Invoices'}</h2>
          <p class="text-body-md text-outline mt-1">${customer ? 'Your invoices, payments and balance' : 'Invoices, payments received and refunds'}</p>
        </div>
      </div>
      ${customer && this.account ? this.renderAccount() : ''}
      ${this.tabs().length > 1 ? `<div class="tab-list mb-6">${this.tabs().map(([k, l]) => `<button class="tab-btn ${this.tab === k ? 'active' : ''}" onclick="InvoicesPage.setTab('${k}')">${l}</button>`).join('')}</div>` : ''}`;
    if (this.error) return header + Utils.errorState(this.error, 'InvoicesPage.reload()');
    if (this.needsLoad()) return header + Utils.loadingState();
    return header + { invoices: () => this.renderInvoices(), payments: () => this.renderPayments(), refunds: () => this.renderRefunds() }[this.tab]();
  },

  afterRender() {
    if (this.needsLoad()) this.load();
    // SECTION: returning from a card checkout — resume watching that payment (the server decides the outcome)
    const returning = Router.hashParams?.get('payment');
    if (returning) {
      Router.hashParams = null;
      history.replaceState(null, '', '#invoices');
      PaymentFlow.watch(returning);
    }
    document.getElementById('inv-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.setFilter('search', e.target.value.trim());
    });
  },

  // SECTION: customer account summary
  renderAccount() {
    const a = this.account;
    return `
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div class="page-section"><span class="text-label-sm text-outline">BALANCE DUE</span><div class="text-headline-lg font-headline-lg mt-1 ${a.outstanding > 0 ? 'text-error' : 'text-secondary'}">${Utils.formatCurrency(a.outstanding)}</div><span class="text-sm text-outline">${a.openInvoices} open invoice(s)</span></div>
        <div class="page-section"><span class="text-label-sm text-outline">CREDIT LIMIT</span><div class="text-headline-md font-headline-md mt-1">${a.creditAllowed ? Utils.formatCurrency(a.creditLimit) : 'No credit'}</div>${a.creditAllowed ? `<span class="text-sm text-outline">${Utils.formatCurrency(a.availableCredit)} available</span>` : ''}</div>
        <div class="page-section flex flex-col justify-between"><span class="text-label-sm text-outline">ACCOUNT</span><div class="font-semibold mt-1">${Utils.escapeHtml(a.name)} · ${Utils.escapeHtml(a.customerNo)}</div>
          <button onclick="CustomersPage.openStatement('${a.id}')" class="mt-2 self-start text-sm font-semibold text-secondary hover:underline flex items-center gap-1"><span class="material-symbols-outlined text-base">description</span> Statement</button></div>
      </div>`;
  },

  renderInvoices() {
    const customer = this.isCustomer();
    const statuses = [['', 'All'], ['UNPAID', 'Unpaid'], ['PARTIALLY_PAID', 'Partially paid'], ['OVERDUE', 'Overdue'], ['PAID', 'Paid'], ['REFUNDED', 'Refunded'], ['CANCELLED', 'Cancelled']];
    const now = new Date();
    const rows = this.invoices.map((i) => {
      const bal = Billing.balance(i);
      const overdue = bal > 0 && i.dueDate && new Date(i.dueDate) < now && ['UNPAID', 'PARTIALLY_PAID'].includes(i.status);
      return `
      <tr>
        <td class="font-semibold text-data-mono whitespace-nowrap">${Utils.escapeHtml(i.invoiceNo)}</td>
        <td class="whitespace-nowrap">${Utils.formatDate(i.issueDate)}</td>
        ${customer ? '' : `<td>${Utils.escapeHtml(i.customer?.name || i.sale?.walkInName || 'Walk-in')}</td>`}
        <td class="text-data-mono">${Utils.formatCurrency(i.total)}</td>
        <td class="text-data-mono">${Utils.formatCurrency(i.amountPaid)}</td>
        <td class="text-data-mono font-semibold ${bal > 0 ? 'text-error' : ''}">${Utils.formatCurrency(bal)}</td>
        <td class="whitespace-nowrap ${overdue ? 'text-error font-semibold' : ''}">${i.dueDate && bal > 0 ? Utils.formatDate(i.dueDate) : '—'}${overdue ? ' (overdue)' : ''}</td>
        <td>${Billing.badge(i.status)}${i.payments?.length ? ` ${Utils.badge('Payment pending', 'info')}` : ''}</td>
        <td class="whitespace-nowrap">
          <button onclick="InvoicesPage.openInvoice('${i.id}')" class="text-secondary hover:underline text-sm mr-2">View</button>
          <button onclick="Billing.printInvoice('${i.id}')" class="text-primary hover:underline text-sm">Print</button>
        </td>
      </tr>`;
    });
    return `
      ${!customer && this.summary ? `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div class="page-section"><span class="text-label-sm text-outline">OUTSTANDING (FILTERED)</span><div class="text-headline-md font-headline-md mt-1 text-error">${Utils.formatCurrency(this.summary.outstanding)}</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">OPEN INVOICES</span><div class="text-headline-md font-headline-md mt-1">${this.summary.openInvoices}</div></div>
      </div>` : ''}
      <div class="flex flex-wrap gap-3 mb-4 items-center">
        ${!customer ? `<div class="relative flex-1 min-w-[200px]"><span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg">search</span>
          <input id="inv-search" type="search" placeholder="Invoice # or customer, then Enter" class="form-input pl-10" value="${Utils.escapeHtml(this.search)}"/></div>` : ''}
        <select class="form-select w-auto" onchange="InvoicesPage.setFilter('status', this.value)">
          ${statuses.map(([v, l]) => `<option value="${v}" ${this.status === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="page-section">
        ${Utils.renderDataTable(['Invoice #', 'Date', ...(customer ? [] : ['Customer']), 'Total', 'Paid', 'Balance', 'Due', 'Status', ''], rows, 'No invoices')}
        ${Utils.renderPagination(this.page, Math.max(1, Math.ceil(this.total / 20)), 'InvoicesPage.goToPage')}
      </div>`;
  },

  goToPage(p) {
    this.page = p;
    this.reload('invoices');
  },

  renderPayments() {
    const rows = this.payments.map((p) => `
      <tr>
        <td class="font-semibold text-data-mono">${Utils.escapeHtml(p.paymentNo)}</td>
        <td class="whitespace-nowrap">${Utils.formatDateTime(p.verifiedAt || p.createdAt)}</td>
        <td class="text-data-mono">${Utils.escapeHtml(p.invoice.invoiceNo)}</td>
        ${this.isCustomer() ? '' : `<td>${Utils.escapeHtml(p.customer?.name || 'Walk-in')}</td>`}
        <td>${Billing.method(p.method)}${p.providerReference ? `<div class="text-xs text-outline">Ref ${Utils.escapeHtml(p.providerReference)}</div>` : ''}</td>
        <td class="text-data-mono font-semibold">${Utils.formatCurrency(p.amount)}</td>
        <td>${Billing.badge(p.status)}</td>
        ${this.isCustomer() ? '' : `<td>${Utils.escapeHtml(p.initiatedBy?.name || '')}</td>`}
      </tr>`);
    const byMethod = (this.paymentsSummary || []).map((m) => `
      <div class="page-section"><span class="text-label-sm text-outline">${Billing.method(m.method).toUpperCase()}</span><div class="text-headline-md font-headline-md mt-1">${Utils.formatCurrency(m.amount)}</div><span class="text-sm text-outline">${m.count} payment(s)</span></div>`).join('');
    return `
      ${byMethod ? `<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">${byMethod}</div>` : ''}
      <div class="page-section">
        ${Utils.renderDataTable(['Payment #', 'Date', 'Invoice', ...(this.isCustomer() ? [] : ['Customer']), 'Method', 'Amount', 'Status', ...(this.isCustomer() ? [] : ['Received by'])], rows, 'No payments yet')}
      </div>`;
  },

  renderRefunds() {
    const session = Auth.getSession();
    const canApprove = Auth.can('refunds.approve');
    const rows = this.refunds.map((r) => {
      const own = r.requestedBy.id === session.userId && session.role !== 'super_admin';
      return `
      <tr>
        <td class="font-semibold text-data-mono">${Utils.escapeHtml(r.refundNo)}</td>
        <td class="whitespace-nowrap">${Utils.formatDateTime(r.createdAt)}</td>
        <td class="text-data-mono">${Utils.escapeHtml(r.invoice.invoiceNo)}</td>
        <td>${Utils.escapeHtml(r.invoice.customer?.name || 'Walk-in')}</td>
        <td class="text-data-mono font-semibold">${Utils.formatCurrency(r.amount)}</td>
        <td>${r.payment ? Billing.method(r.payment.method) : 'Cash'}</td>
        <td class="text-sm">${Utils.escapeHtml(r.reason)}</td>
        <td>${Utils.escapeHtml(r.requestedBy.name)}</td>
        <td>${Billing.badge(r.status)}${r.approvedBy ? `<div class="text-xs text-outline">${Utils.escapeHtml(r.approvedBy.name)}</div>` : ''}</td>
        <td class="whitespace-nowrap">${r.status === 'PENDING' && canApprove && !own ? `
          <button onclick="InvoicesPage.decideRefund('${r.id}', 'approve')" class="text-secondary hover:underline text-sm mr-2">Approve</button>
          <button onclick="InvoicesPage.decideRefund('${r.id}', 'reject')" class="text-error hover:underline text-sm">Reject</button>` : r.status === 'PENDING' && own ? '<span class="text-xs text-outline">Awaiting another approver</span>'
          : r.status === 'APPROVED' && canApprove ? `<button onclick="InvoicesPage.processRefund('${r.id}')" class="text-secondary hover:underline text-sm">Send to provider</button>` : ''}</td>
      </tr>`;
    });
    return `<div class="page-section">
      <p class="text-sm text-outline mb-4">Refunds return money on paid invoices and need approval by someone other than the requester. Cash and bank refunds are paid out when approved; ZAAD, eDAHAB and Mastercard refunds are returned through the provider.</p>
      ${Utils.renderDataTable(['Refund #', 'Requested', 'Invoice', 'Customer', 'Amount', 'Paid by', 'Reason', 'By', 'Status', ''], rows, 'No refunds')}</div>`;
  },

  decideRefund(id, decision) {
    const r = this.refunds.find((x) => x.id === id);
    Utils.confirm(`${decision === 'approve' ? 'Approve' : 'Reject'} refund ${Utils.escapeHtml(r.refundNo)} of ${Utils.formatCurrency(r.amount)}?${decision === 'approve' && !(r.payment && ['ZAAD', 'EDAHAB', 'MASTERCARD'].includes(r.payment.method)) ? ' Pay the customer when you approve.' : ''}`, async () => {
      const res = await Utils.act(() => Api.post(`/refunds/${id}/${decision}`));
      if (!res) return;
      if (res.providerError) Utils.toast(`Approved, but the provider refund did not go through: ${res.providerError}. Retry from the Refunds tab.`, 'error');
      else Utils.toast(decision === 'reject' ? 'Refund rejected' : res.refund.status === 'COMPLETED' ? 'Refund completed' : 'Refund approved — waiting for provider', 'success');
      this.reload('refunds', 'invoices', 'payments');
    });
  },

  // SECTION: retry an approved electronic refund with the provider
  async processRefund(id) {
    const res = await Utils.act(() => Api.post(`/refunds/${id}/process`));
    if (!res) return;
    Utils.toast(res.refund.status === 'COMPLETED' ? 'Refund completed through the provider' : 'Provider has not completed the refund yet', res.refund.status === 'COMPLETED' ? 'success' : 'info');
    this.reload('refunds', 'invoices', 'payments');
  },

  // ─── Invoice detail (shared) ────────────────────────────────

  // SECTION: openInvoice — full detail with payment and refund actions; usable from any page
  async openInvoice(id) {
    const [res] = await Promise.all([Utils.act(() => Api.get(`/invoices/${id}`)), PaymentFlow.loadProviders()]);
    if (!res) return;
    const inv = res.invoice;
    const pendingPay = inv.payments.find((p) => p.status === 'PENDING');
    const canPayElectronic = Auth.can('payments.receive') || this.isCustomer();
    const electronic = canPayElectronic && !pendingPay ? PaymentFlow.available() : [];
    this.current = inv;
    const bal = Billing.balance(inv);
    const open = ['UNPAID', 'PARTIALLY_PAID'].includes(inv.status);
    const refundable = Number(inv.amountPaid) - (inv.refunds || []).filter((r) => r.status !== 'REJECTED').reduce((a, r) => a + Number(r.amount), 0);
    const items = inv.sale?.items || [];

    Utils.openModal(`Invoice ${Utils.escapeHtml(inv.invoiceNo)}`, `
      <div class="space-y-4">
        <div class="flex flex-wrap justify-between gap-3">
          <div><p class="text-label-sm text-outline">CUSTOMER</p><p class="font-semibold">${Utils.escapeHtml(Billing.customerName(inv))}</p>
            ${inv.customer ? `<p class="text-sm text-outline">${Utils.escapeHtml(inv.customer.customerNo)} · ${Utils.escapeHtml(inv.customer.phone || '')}</p>` : ''}</div>
          <div class="text-right"><div>${Billing.badge(inv.status)}</div>
            <p class="text-sm text-outline mt-1">Issued ${Utils.formatDate(inv.issueDate)}${inv.dueDate && bal > 0 ? ` · due ${Utils.formatDate(inv.dueDate)}` : ''}</p>
            ${inv.sale ? `<p class="text-sm text-outline">${Utils.escapeHtml(inv.sale.saleNo)} · ${Utils.escapeHtml(inv.sale.cashier?.name || '')}</p>` : ''}</div>
        </div>
        <div class="overflow-x-auto"><table class="data-table w-full text-sm"><thead><tr><th>Fuel</th><th class="text-right">Liters</th><th class="text-right">Price</th><th class="text-right">Discount</th><th class="text-right">Amount</th></tr></thead><tbody>
          ${items.map((i) => `<tr><td>${Utils.escapeHtml(i.product.name)}</td><td class="text-right text-data-mono">${Utils.formatNumber(i.quantity, 3)}</td><td class="text-right text-data-mono">${Billing.price(i.unitPrice)}</td><td class="text-right text-data-mono">${Number(i.discount) ? Utils.formatCurrency(-i.discount) : '—'}</td><td class="text-right text-data-mono">${Utils.formatCurrency(i.lineTotal)}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="ml-auto max-w-xs space-y-1 text-sm">
          <div class="flex justify-between"><span>Subtotal</span><span class="text-data-mono">${Utils.formatCurrency(inv.subtotal)}</span></div>
          ${Number(inv.discount) ? `<div class="flex justify-between"><span>Discount</span><span class="text-data-mono">${Utils.formatCurrency(-inv.discount)}</span></div>` : ''}
          ${Number(inv.tax) ? `<div class="flex justify-between"><span>Tax (${Number(inv.taxRate)}%)</span><span class="text-data-mono">${Utils.formatCurrency(inv.tax)}</span></div>` : ''}
          <div class="flex justify-between font-semibold text-base border-t border-outline-variant pt-1"><span>Total</span><span class="text-data-mono">${Utils.formatCurrency(inv.total)}</span></div>
          <div class="flex justify-between"><span>Paid</span><span class="text-data-mono">${Utils.formatCurrency(inv.amountPaid)}</span></div>
          <div class="flex justify-between font-semibold ${bal > 0 ? 'text-error' : 'text-secondary'}"><span>Balance due</span><span class="text-data-mono">${Utils.formatCurrency(bal)}</span></div>
        </div>
        ${inv.payments.length ? `<div><p class="text-label-sm text-outline mb-2">PAYMENTS</p>${inv.payments.map((p) => `
          <div class="flex justify-between gap-2 text-sm py-1 border-b border-outline-variant/50"><span>${Utils.escapeHtml(p.paymentNo)} · ${Billing.method(p.method)}${p.providerReference ? ` · ${Utils.escapeHtml(p.providerReference)}` : ''}</span><span>${Billing.badge(p.status)} <span class="text-data-mono ml-2">${Utils.formatCurrency(p.amount)}</span></span></div>`).join('')}</div>` : ''}
        ${inv.refunds.length ? `<div><p class="text-label-sm text-outline mb-2">REFUNDS</p>${inv.refunds.map((r) => `
          <div class="flex justify-between gap-2 text-sm py-1 border-b border-outline-variant/50"><span>${Utils.escapeHtml(r.refundNo)} · ${Utils.escapeHtml(r.reason)}</span><span>${Billing.badge(r.status)} <span class="text-data-mono ml-2">${Utils.formatCurrency(r.amount)}</span></span></div>`).join('')}</div>` : ''}
        ${pendingPay ? `
          <div class="p-3 rounded-lg bg-surface-container-low border border-secondary/30 flex flex-wrap justify-between items-center gap-2">
            <span class="text-sm"><strong>${Billing.method(pendingPay.method)}</strong> payment ${Utils.escapeHtml(pendingPay.paymentNo)} of ${Utils.formatCurrency(pendingPay.amount)} is waiting for confirmation.</span>
            <button onclick="PaymentFlow.watch('${pendingPay.id}')" class="text-sm font-semibold text-secondary hover:underline">Check status</button>
          </div>` : ''}
        ${open && bal > 0 && electronic.length ? `
          <div>
            <p class="text-label-sm text-outline mb-2">${this.isCustomer() ? 'PAY NOW' : 'COLLECT ELECTRONIC PAYMENT'}${PaymentFlow.mode === 'sandbox' ? ' <span class="text-tertiary-fixed-dim">(sandbox)</span>' : ''}</p>
            <div class="flex flex-wrap gap-2">
              ${electronic.map((p) => `<button onclick="InvoicesPage.payElectronic('${p.method}')" class="px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container-low font-semibold flex items-center gap-2">
                <span class="material-symbols-outlined text-lg">${p.flow === 'mobile' ? 'smartphone' : 'credit_card'}</span>${Utils.escapeHtml(p.label)}</button>`).join('')}
            </div>
          </div>` : ''}
        <div id="inv-action"></div>
      </div>`, `
      <button onclick="Billing.printInvoice('${inv.id}', 'receipt')" class="px-3 py-2 border border-outline-variant rounded text-sm">Receipt</button>
      <button onclick="Billing.printInvoice('${inv.id}')" class="px-3 py-2 border border-outline-variant rounded text-sm">Print / PDF</button>
      ${Auth.can('refunds.request') && refundable > 0.004 ? '<button onclick="InvoicesPage.showRefundForm()" class="px-3 py-2 border border-error/40 text-error rounded text-sm">Request Refund</button>' : ''}
      ${Auth.can('payments.receive') && open && bal > 0 && !pendingPay ? '<button onclick="InvoicesPage.showPaymentForm()" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Record Cash / Bank</button>' : ''}`);
  },

  payElectronic(method) {
    const inv = this.current;
    PaymentFlow.start(inv, method, { phone: inv.customer?.phone || inv.sale?.walkInPhone || '' });
  },

  showPaymentForm() {
    const inv = this.current;
    this.paymentKey = Utils.idempotencyKey();
    document.getElementById('inv-action').innerHTML = `
      <form id="pay-form" class="p-4 rounded-xl bg-surface-container-low" onsubmit="event.preventDefault(); InvoicesPage.savePayment()">
        <p class="font-semibold mb-3">Record payment</p>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label class="form-label">Amount</label><input name="amount" type="number" step="0.01" min="0.01" max="${Billing.balance(inv)}" value="${Billing.balance(inv).toFixed(2)}" class="form-input" required/></div>
          <div><label class="form-label">Method</label><select name="method" class="form-select"><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option></select></div>
          <div><label class="form-label">Reference</label><input name="reference" class="form-input" maxlength="100" placeholder="Required for bank"/></div>
        </div>
        <p class="text-xs text-outline mt-2">ZAAD, eDAHAB and Mastercard payments are confirmed by the provider and cannot be entered by hand.</p>
        <button id="pay-save" type="submit" class="mt-3 px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Save Payment</button>
      </form>`;
  },

  async savePayment() {
    const d = Utils.getFormData('pay-form');
    const btn = document.getElementById('pay-save');
    btn.disabled = true;
    const res = await Utils.act(() => Api.post(`/invoices/${this.current.id}/payments`, { ...d, idempotencyKey: this.paymentKey }), 'Payment recorded');
    btn.disabled = false;
    if (!res) return;
    this.reload('invoices', 'payments', 'account');
    if (typeof SalesPage !== 'undefined') SalesPage.sales = null;
    this.openInvoice(this.current.id);
  },

  showRefundForm() {
    const inv = this.current;
    const paid = inv.payments.filter((p) => p.status === 'SUCCESSFUL');
    document.getElementById('inv-action').innerHTML = `
      <form id="refund-form" class="p-4 rounded-xl bg-error-container/30" onsubmit="event.preventDefault(); InvoicesPage.saveRefund()">
        <p class="font-semibold mb-3">Request refund</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="form-label">Amount</label><input name="amount" type="number" step="0.01" min="0.01" class="form-input" required/></div>
          <div><label class="form-label">Original payment</label><select name="paymentId" class="form-select">${paid.map((p) => `<option value="${p.id}">${Utils.escapeHtml(p.paymentNo)} · ${Billing.method(p.method)} · ${Utils.formatCurrency(p.amount)}</option>`).join('')}</select></div>
        </div>
        <div class="mt-3"><label class="form-label">Reason</label><input name="reason" class="form-input" required minlength="5" maxlength="500"/></div>
        <p class="text-xs text-outline mt-2">A manager must approve the refund before money is returned. Fuel is not returned to stock.</p>
        <button type="submit" class="mt-3 px-4 py-2 bg-error text-on-error rounded font-semibold">Submit Request</button>
      </form>`;
  },

  async saveRefund() {
    const d = Utils.getFormData('refund-form');
    const res = await Utils.act(() => Api.post(`/invoices/${this.current.id}/refunds`, { ...d, paymentId: d.paymentId || null }), 'Refund requested — awaiting approval');
    if (!res) return;
    this.reload('refunds');
    this.openInvoice(this.current.id);
  },
};

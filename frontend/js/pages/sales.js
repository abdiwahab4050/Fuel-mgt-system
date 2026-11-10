/**
 * Sales Page
 */
// SECTION: Sales page object — point-of-sale form and sales history from /api/sales
const SalesPage = {
  search: '',
  from: Utils.today(),
  to: Utils.today(),
  status: '',
  page: 1,
  sales: null,
  total: 0,
  summary: null,
  error: null,
  // POS state
  pumps: null,
  pos: null,

  onEnter() {
    this.sales = null;
    this.error = null;
  },

  async load() {
    try {
      const res = await Api.get('/sales', { search: this.search, from: this.from, to: this.to, status: this.status, page: this.page, pageSize: 20 });
      Object.assign(this, { sales: res.sales, total: res.total, summary: res.summary, error: null });
    } catch (err) {
      this.error = err.message;
    }
    if (Router.currentPage === 'sales') Router.refresh();
  },

  reload() {
    this.sales = null;
    this.error = null;
    Router.refresh();
  },

  setFilter(key, value) {
    this[key] = value;
    this.page = 1;
    this.reload();
  },

  goToPage(p) {
    this.page = p;
    this.reload();
  },

  // SECTION: render — summary cards, filters, history table
  render() {
    const canSell = Auth.can('sales.create');
    const isCustomer = Auth.getSession()?.role === 'customer';
    const header = `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">${isCustomer ? 'My Fuel Purchases' : 'Fuel Sales'}</h2>
          <p class="text-body-md text-outline mt-1">${isCustomer ? 'Every fill-up on your account' : Auth.can('sales.view') ? 'Record sales, print receipts and review history' : 'Record sales and review your own transactions'}</p>
        </div>
        ${canSell ? `<button onclick="SalesPage.openAdd()" class="px-5 py-2.5 bg-secondary text-on-secondary rounded-lg text-body-md font-semibold flex items-center gap-2 shadow-sm">
          <span class="material-symbols-outlined">point_of_sale</span> New Sale</button>` : ''}
      </div>`;

    const filters = `
      <div class="flex flex-wrap gap-3 mb-6 items-center">
        <div class="relative flex-1 min-w-[200px]">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg">search</span>
          <input id="sal-search" type="search" placeholder="Sale #, invoice #, customer..." class="form-input pl-10" value="${Utils.escapeHtml(this.search)}"/>
        </div>
        <input type="date" class="form-input w-auto" value="${this.from}" onchange="SalesPage.setFilter('from', this.value)" aria-label="From"/>
        <span class="text-outline">to</span>
        <input type="date" class="form-input w-auto" value="${this.to}" onchange="SalesPage.setFilter('to', this.value)" aria-label="To"/>
        <select class="form-select w-auto" onchange="SalesPage.setFilter('status', this.value)">
          ${[['', 'All statuses'], ['COMPLETED', 'Completed'], ['PARTIALLY_REFUNDED', 'Partly refunded'], ['REFUNDED', 'Refunded'], ['CANCELLED', 'Cancelled']].map(([v, l]) => `<option value="${v}" ${this.status === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        ${!isCustomer ? `<button onclick="SalesPage.exportCSV()" class="px-4 py-2 border border-outline-variant rounded-lg text-body-md hover:bg-surface-container-low flex items-center gap-2"><span class="material-symbols-outlined text-lg">download</span> CSV</button>` : ''}
      </div>`;

    if (this.error) return header + filters + Utils.errorState(this.error, 'SalesPage.reload()');
    if (!this.sales) return header + filters + Utils.loadingState('Loading sales...');

    const canCancel = Auth.can('sales.cancel');
    const rows = this.sales.map((s) => `
      <tr>
        <td class="font-semibold text-data-mono whitespace-nowrap">${Utils.escapeHtml(s.saleNo)}</td>
        <td class="whitespace-nowrap">${Utils.formatDateTime(s.saleDate)}</td>
        <td>${Utils.escapeHtml(s.customer?.name || s.walkInName || 'Walk-in')}</td>
        <td>${Utils.escapeHtml([...new Set(s.items.map((i) => i.product.name))].join(', '))}</td>
        <td class="text-data-mono">${Utils.formatNumber(s.items.reduce((a, i) => a + Number(i.quantity), 0), 2)} L</td>
        <td class="text-data-mono font-semibold">${Utils.formatCurrency(s.total)}</td>
        <td>${s.status === 'COMPLETED' ? Billing.badge(s.invoice?.status) : Billing.badge(s.status)}</td>
        ${!isCustomer ? `<td>${Utils.escapeHtml(s.cashier.name)}</td>` : ''}
        <td class="whitespace-nowrap">
          ${s.invoice ? `<button onclick="InvoicesPage.openInvoice('${s.invoice.id}')" class="text-secondary hover:underline text-sm mr-2">View</button>
          <button onclick="Billing.printInvoice('${s.invoice.id}', 'receipt')" class="text-primary hover:underline text-sm mr-2">Receipt</button>` : ''}
          ${canCancel && s.status === 'COMPLETED' && s.invoice?.status === 'UNPAID' ? `<button onclick="SalesPage.cancel('${s.id}', '${Utils.escapeHtml(s.saleNo)}')" class="text-error hover:underline text-sm">Cancel</button>` : ''}
        </td>
      </tr>`);

    const cards = `
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div class="page-section"><span class="text-label-sm text-outline">${isCustomer ? 'SPENT' : 'REVENUE'}</span><div class="text-headline-md font-headline-md mt-1 text-secondary">${Utils.formatCurrency(this.summary.revenue)}</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">LITERS</span><div class="text-headline-md font-headline-md mt-1">${Utils.formatNumber(this.summary.liters, 1)} L</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">TRANSACTIONS</span><div class="text-headline-md font-headline-md mt-1">${this.summary.transactions}</div></div>
      </div>`;

    return header + cards + filters + `
      <div class="page-section">
        ${Utils.renderDataTable(['Sale #', 'Date', 'Customer', 'Fuel', 'Liters', 'Total', 'Status', ...(isCustomer ? [] : ['Cashier']), ''], rows, 'No sales in this period')}
        ${Utils.renderPagination(this.page, Math.max(1, Math.ceil(this.total / 20)), 'SalesPage.goToPage')}
      </div>`;
  },

  afterRender() {
    if (!this.sales && !this.error) this.load();
    const input = document.getElementById('sal-search');
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.setFilter('search', e.target.value.trim());
    });
    input?.addEventListener('search', (e) => this.setFilter('search', e.target.value.trim()));
  },

  cancel(id, saleNo) {
    Utils.openModal(`Cancel ${saleNo}`, `
      <form id="cancel-form">
        <p class="text-sm text-outline mb-4">Cancelling voids the sale and its invoice and returns the fuel to the tank. Use this only for sales recorded in error. Sales that have been paid must be refunded instead.</p>
        <div class="form-group"><label class="form-label">Reason</label><textarea name="reason" class="form-input" rows="3" required minlength="5"></textarea></div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Keep Sale</button>
      <button onclick="SalesPage.confirmCancel('${id}')" class="px-4 py-2 bg-error text-on-error rounded font-semibold">Cancel Sale</button>`);
  },

  async confirmCancel(id) {
    const { reason } = Utils.getFormData('cancel-form');
    const ok = await Utils.act(() => Api.post(`/sales/${id}/cancel`, { reason }), 'Sale cancelled and fuel returned to stock');
    if (!ok) return;
    Utils.closeModal();
    this.reload();
  },

  async exportCSV() {
    const all = [];
    for (let page = 1; page <= 50; page++) {
      const res = await Utils.act(() => Api.get('/sales', { search: this.search, from: this.from, to: this.to, status: this.status, page, pageSize: 100 }));
      if (!res) return;
      all.push(...res.sales);
      if (all.length >= res.total) break;
    }
    Utils.exportCSV(`sales-${this.from}-to-${this.to}.csv`,
      ['Sale #', 'Invoice #', 'Date', 'Customer', 'Fuel', 'Liters', 'Total', 'Sale status', 'Invoice status', 'Cashier'],
      all.map((s) => [s.saleNo, s.invoice?.invoiceNo || '', new Date(s.saleDate).toISOString(), s.customer?.name || s.walkInName || 'Walk-in',
        [...new Set(s.items.map((i) => i.product.name))].join('; '), s.items.reduce((a, i) => a + Number(i.quantity), 0), s.total, s.status, s.invoice?.status || '', s.cashier.name]));
  },

  // ─── Point of sale ──────────────────────────────────────────

  // SECTION: openAdd — loads active nozzles then shows the POS form; one idempotency key per form
  async openAdd() {
    if (!this.pumps) {
      const res = await Utils.act(() => Api.get('/pumps'));
      if (!res) return;
      this.pumps = res.pumps;
    }
    const nozzles = this.pumps.filter((p) => p.status === 'ACTIVE').flatMap((p) => p.nozzles.filter((n) => n.status === 'ACTIVE').map((n) => ({ ...n, pump: p })));
    if (!nozzles.length) return Utils.toast('No active pump nozzles are configured', 'error');

    this.pos = { key: Utils.idempotencyKey(), nozzles, customer: null, needsApproval: false };
    const canDiscount = Auth.can('sales.discount.apply', 'sales.discount.approve');

    Utils.openModal('New Fuel Sale', `
      <form id="pos-form" onsubmit="event.preventDefault(); SalesPage.submit()">
        <div class="form-group">
          <label class="form-label">Pump / Nozzle</label>
          <select name="nozzleId" class="form-select text-lg" onchange="SalesPage.recalc()">
            ${nozzles.map((n) => `<option value="${n.id}">Pump ${Utils.escapeHtml(n.pump.code)} · ${Utils.escapeHtml(n.code)} — ${Utils.escapeHtml(n.tank.product.name)} (${Billing.price(n.tank.product.sellingPrice)}/L)</option>`).join('')}
          </select>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Sell by</label>
            <div class="flex rounded-lg border border-outline-variant overflow-hidden">
              <label class="flex-1 text-center py-2 cursor-pointer has-[:checked]:bg-primary has-[:checked]:text-on-primary"><input type="radio" name="mode" value="liters" class="hidden" checked onchange="SalesPage.recalc()"/>Liters</label>
              <label class="flex-1 text-center py-2 cursor-pointer has-[:checked]:bg-primary has-[:checked]:text-on-primary"><input type="radio" name="mode" value="amount" class="hidden" onchange="SalesPage.recalc()"/>Amount</label>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" id="pos-qty-label">Liters</label>
            <input name="entry" type="number" step="0.001" min="0.001" class="form-input text-lg" required autofocus oninput="SalesPage.recalc()"/>
          </div>
        </div>

        ${canDiscount ? `<div class="form-group"><label class="form-label">Discount (amount)</label><input name="discount" type="number" step="0.01" min="0" value="0" class="form-input" oninput="SalesPage.recalc()"/></div>` : ''}

        <div id="pos-approval" class="hidden p-3 rounded-lg border border-tertiary-fixed-dim bg-surface-container-low mb-4">
          <p class="text-sm font-semibold mb-2">Supervisor approval required for this discount</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input name="approverEmail" type="email" placeholder="Supervisor email" class="form-input" autocomplete="off"/>
            <input name="approverPassword" type="password" placeholder="Supervisor password" class="form-input" autocomplete="off"/>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Customer</label>
          <div class="flex gap-4 mb-2 text-sm">
            <label class="flex items-center gap-1"><input type="radio" name="custType" value="walkin" checked onchange="SalesPage.toggleCustomer()"/> Walk-in</label>
            <label class="flex items-center gap-1"><input type="radio" name="custType" value="registered" onchange="SalesPage.toggleCustomer()"/> Registered customer</label>
          </div>
          <div id="pos-walkin" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input name="walkInName" placeholder="Name (optional)" class="form-input" maxlength="100"/>
            <input name="walkInPhone" placeholder="Phone (optional)" class="form-input" maxlength="30"/>
          </div>
          <div id="pos-registered" class="hidden">
            <input id="pos-cust-search" type="search" placeholder="Search name, phone or customer #" class="form-input" oninput="SalesPage.searchCustomers(this.value)" autocomplete="off"/>
            <div id="pos-cust-results" class="mt-2 space-y-1"></div>
            <div id="pos-cust-selected" class="mt-2"></div>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Payment Method</label>
            <select name="paymentMethod" class="form-select" onchange="SalesPage.recalc()">
              <option value="CASH">Cash</option>
              <option value="ZAAD">ZAAD</option>
              <option value="EDAHAB">eDAHAB</option>
              <option value="MASTERCARD">Mastercard</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="CREDIT_ACCOUNT">Credit account</option>
            </select>
          </div>
          <div class="form-group" id="pos-extra"></div>
        </div>

        <div id="pos-summary" class="p-4 rounded-xl bg-surface-container-low space-y-1 text-body-md"></div>
        <button type="submit" class="hidden"></button>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button id="pos-submit" onclick="SalesPage.submit()" class="px-6 py-2 bg-secondary text-on-secondary rounded font-semibold">Complete Sale</button>`);
    this.recalc();
  },

  toggleCustomer() {
    const registered = document.querySelector('#pos-form [name="custType"]:checked').value === 'registered';
    document.getElementById('pos-walkin').classList.toggle('hidden', registered);
    document.getElementById('pos-registered').classList.toggle('hidden', !registered);
    if (!registered) this.selectCustomer(null);
    else document.getElementById('pos-cust-search')?.focus();
  },

  async searchCustomers(q) {
    clearTimeout(this._custTimer);
    const box = document.getElementById('pos-cust-results');
    if (!q || q.trim().length < 2) {
      box.innerHTML = '';
      return;
    }
    this._custTimer = setTimeout(async () => {
      try {
        const { customers } = await Api.get('/customers', { search: q.trim(), status: 'ACTIVE', limit: 8 });
        this._custResults = customers;
        box.innerHTML = customers.map((c) => `
          <button type="button" onclick="SalesPage.selectCustomer('${c.id}')" class="w-full text-left p-2 rounded border border-outline-variant hover:bg-surface-container-low text-sm">
            <strong>${Utils.escapeHtml(c.name)}</strong> <span class="text-outline">${Utils.escapeHtml(c.customerNo)} · ${Utils.escapeHtml(c.phone || '')}</span>
            ${c.creditAllowed ? `<span class="float-right text-xs text-secondary">Credit ${Utils.formatCurrency(c.availableCredit)} available</span>` : ''}
          </button>`).join('') || '<p class="text-sm text-outline">No customers found</p>';
      } catch (err) {
        box.innerHTML = `<p class="text-sm text-error">${Utils.escapeHtml(err.message)}</p>`;
      }
    }, 250);
  },

  selectCustomer(id) {
    this.pos.customer = id ? this._custResults.find((c) => c.id === id) : null;
    const c = this.pos.customer;
    const results = document.getElementById('pos-cust-results');
    if (results) results.innerHTML = '';
    const sel = document.getElementById('pos-cust-selected');
    if (sel) {
      sel.innerHTML = c ? `<div class="p-3 rounded-lg bg-secondary/10 border border-secondary/30 text-sm flex justify-between gap-2">
        <div><strong>${Utils.escapeHtml(c.name)}</strong> · ${Utils.escapeHtml(c.customerNo)}<br><span class="text-outline">Balance ${Utils.formatCurrency(c.outstanding)}${c.creditAllowed ? ` · credit available ${Utils.formatCurrency(c.availableCredit)}` : ' · no credit'}</span></div>
        <button type="button" class="text-outline" onclick="SalesPage.selectCustomer(null)"><span class="material-symbols-outlined">close</span></button></div>` : '';
    }
    this.recalc();
  },

  // SECTION: live preview — same rounding as the server (round2 of liters × price), server stays authoritative
  recalc() {
    const form = document.getElementById('pos-form');
    if (!form || !this.pos) return;
    const nozzle = this.pos.nozzles.find((n) => n.id === form.nozzleId.value);
    const price = Number(nozzle.tank.product.sellingPrice);
    const mode = form.querySelector('[name="mode"]:checked').value;
    document.getElementById('pos-qty-label').textContent = mode === 'liters' ? 'Liters' : `Amount (${App.settings?.['currency.symbol'] || '$'})`;
    form.entry.step = mode === 'liters' ? '0.001' : '0.01';

    const entry = Number(form.entry.value) || 0;
    const liters = mode === 'liters' ? entry : Math.floor((entry / price) * 1000) / 1000;
    const gross = Math.round(liters * price * 100) / 100;
    const discount = Math.min(Number(form.discount?.value) || 0, gross);
    const taxRate = Number(App.settings?.['invoice.taxRate'] || 0);
    const tax = Math.round((gross - discount) * taxRate) / 100;
    const total = Math.round((gross - discount + tax) * 100) / 100;
    this.pos.calc = { liters, gross, discount, tax, total, price };

    // payment-specific field — rebuilt only when the method or customer changes so typing keeps focus
    const method = form.paymentMethod.value;
    const extraKey = `${method}:${this.pos.customer?.id || ''}`;
    if (this.pos.extraKey !== extraKey) {
      this.pos.extraKey = extraKey;
      document.getElementById('pos-extra').innerHTML = method === 'CASH'
        ? '<label class="form-label">Cash Received (optional)</label><input name="amountTendered" type="number" step="0.01" min="0" class="form-input" oninput="SalesPage.recalc()"/>'
        : method === 'BANK_TRANSFER'
          ? '<label class="form-label">Transfer Reference</label><input name="paymentReference" class="form-input" maxlength="100"/>'
          : method === 'CREDIT_ACCOUNT'
            ? `<label class="form-label">&nbsp;</label><p class="text-sm ${this.pos.customer?.creditAllowed ? 'text-outline' : 'text-error'}">${this.pos.customer ? (this.pos.customer.creditAllowed ? `Available credit ${Utils.formatCurrency(this.pos.customer.availableCredit)}` : 'This customer has no credit account') : 'Select a registered customer'}</p>`
            : `<label class="form-label">&nbsp;</label><p class="text-sm text-outline">The invoice is created unpaid. Collect the ${Billing.method(method)} payment from the invoice screen.</p>`;
    }

    const tendered = Number(form.amountTendered?.value) || 0;
    const change = method === 'CASH' && tendered ? tendered - total : null;
    document.getElementById('pos-summary').innerHTML = `
      <div class="flex justify-between"><span class="text-outline">Quantity</span><span class="text-data-mono">${Utils.formatNumber(liters, 3)} L × ${Billing.price(price)}</span></div>
      <div class="flex justify-between"><span class="text-outline">Subtotal</span><span class="text-data-mono">${Utils.formatCurrency(gross)}</span></div>
      ${discount ? `<div class="flex justify-between"><span class="text-outline">Discount</span><span class="text-data-mono">${Utils.formatCurrency(-discount)}</span></div>` : ''}
      ${tax ? `<div class="flex justify-between"><span class="text-outline">${Utils.escapeHtml(App.settings?.['invoice.taxLabel'] || 'Tax')} (${taxRate}%)</span><span class="text-data-mono">${Utils.formatCurrency(tax)}</span></div>` : ''}
      <div class="flex justify-between text-headline-md font-headline-md pt-2 border-t border-outline-variant"><span>Total</span><span>${Utils.formatCurrency(total)}</span></div>
      ${change !== null ? `<div class="flex justify-between font-semibold ${change < 0 ? 'text-error' : 'text-secondary'}"><span>${change < 0 ? 'Short by' : 'Change'}</span><span>${Utils.formatCurrency(Math.abs(change))}</span></div>` : ''}
      ${nozzle.tank.currentLiters < liters ? `<p class="text-error text-sm">Only ${Utils.formatNumber(nozzle.tank.currentLiters, 1)} L in tank ${Utils.escapeHtml(nozzle.tank.code)}</p>` : ''}`;
  },

  // SECTION: submit — server computes the real amounts; a retried click reuses the same idempotency key
  async submit() {
    const form = document.getElementById('pos-form');
    const btn = document.getElementById('pos-submit');
    if (!form || btn?.disabled) return;
    this.recalc();
    const c = this.pos.calc;
    if (!(c.liters > 0)) return Utils.toast('Enter the liters or amount', 'error');
    const method = form.paymentMethod.value;
    if (method === 'CREDIT_ACCOUNT' && !this.pos.customer) return Utils.toast('Select a registered customer for a credit sale', 'error');
    if (method === 'BANK_TRANSFER' && !form.paymentReference.value.trim()) return Utils.toast('Enter the transfer reference', 'error');
    if (method === 'CASH' && form.amountTendered.value && Number(form.amountTendered.value) < c.total) return Utils.toast('Cash received is less than the total', 'error');

    const nozzle = this.pos.nozzles.find((n) => n.id === form.nozzleId.value);
    const body = {
      idempotencyKey: this.pos.key,
      stationId: nozzle.pump.station.id,
      items: [{ nozzleId: nozzle.id, quantity: c.liters.toFixed(3), ...(c.discount ? { discount: c.discount.toFixed(2) } : {}) }],
      paymentMethod: method,
      ...(this.pos.customer ? { customerId: this.pos.customer.id } : { walkInName: form.walkInName.value, walkInPhone: form.walkInPhone.value }),
      ...(method === 'CASH' && form.amountTendered.value ? { amountTendered: Number(form.amountTendered.value).toFixed(2) } : {}),
      ...(method === 'BANK_TRANSFER' ? { paymentReference: form.paymentReference.value.trim() } : {}),
      ...(this.pos.needsApproval ? { discountApproval: { email: form.approverEmail.value, password: form.approverPassword.value } } : {}),
    };

    btn.disabled = true;
    btn.textContent = 'Processing...';
    try {
      const res = await Api.post('/sales', body);
      this.pumps = null; // tank levels changed
      this.showComplete(res, method);
      this.reload();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Complete Sale';
      if (err.code === 'DISCOUNT_APPROVAL_REQUIRED') {
        this.pos.needsApproval = true;
        document.getElementById('pos-approval').classList.remove('hidden');
        form.approverEmail.focus();
      }
      Utils.toast(err.fullMessage || err.message, 'error');
    }
  },

  // SECTION: completion screen — print receipt/invoice or start the next sale
  showComplete({ sale, change, replayed }, method = null) {
    const inv = sale.invoice;
    const paid = inv.status === 'PAID';
    const electronic = ['ZAAD', 'EDAHAB', 'MASTERCARD'].includes(method) && inv.status === 'UNPAID';
    this.lastSale = sale;
    Utils.openModal(replayed ? 'Sale already recorded' : 'Sale Complete', `
      <div class="text-center space-y-3">
        <span class="material-symbols-outlined text-5xl ${paid ? 'text-secondary' : 'text-tertiary-fixed-dim'}">${paid ? 'check_circle' : 'receipt_long'}</span>
        <div class="text-display-metrics font-display-metrics">${Utils.formatCurrency(sale.total)}</div>
        <p class="text-outline">${Utils.escapeHtml(sale.saleNo)} · ${Utils.escapeHtml(inv.invoiceNo)}</p>
        <p>${sale.items.map((i) => `${Utils.formatNumber(i.quantity, 3)} L ${Utils.escapeHtml(i.product.name)}`).join(', ')}</p>
        <div>${Billing.badge(inv.status)}</div>
        ${change !== null && change !== undefined && Number(change) > 0 ? `<p class="text-headline-md font-headline-md text-secondary">Change: ${Utils.formatCurrency(change)}</p>` : ''}
        ${!paid ? `<p class="text-sm text-outline">Balance due ${Utils.formatCurrency(Billing.balance(inv))}. ${inv.dueDate && sale.customer ? `Due ${Utils.formatDate(inv.dueDate)}.` : 'Collect payment from the invoice.'}</p>` : ''}
      </div>`, `
      <button onclick="Billing.printInvoice('${inv.id}', 'receipt')" class="px-4 py-2 border border-outline-variant rounded flex items-center gap-1"><span class="material-symbols-outlined text-base">print</span> Receipt</button>
      <button onclick="Billing.printInvoice('${inv.id}')" class="px-4 py-2 border border-outline-variant rounded">Invoice</button>
      ${!paid && !electronic && Auth.can('payments.receive') ? `<button onclick="InvoicesPage.openInvoice('${inv.id}')" class="px-4 py-2 border border-outline-variant rounded">Take Payment</button>` : ''}
      ${electronic ? `<button onclick="SalesPage.collect('${method}')" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Collect ${Billing.method(method)} Payment</button>`
        : '<button onclick="SalesPage.openAdd()" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Next Sale</button>'}`);
  },

  // SECTION: collect — start the electronic payment for the sale just completed
  collect(method) {
    const sale = this.lastSale;
    PaymentFlow.start(sale.invoice, method, { phone: sale.customer?.phone || sale.walkInPhone || '' });
  },
};

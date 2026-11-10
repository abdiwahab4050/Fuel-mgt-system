/**
 * Purchases Page
 */
// SECTION: Purchases page object — purchase orders, fuel deliveries, supplier invoices and payments (accounts payable)
const PurchasesPage = {
  tab: 'orders',
  from: '',
  to: '',
  status: '',
  page: 1,
  orders: null,
  ordersTotal: 0,
  deliveries: null,
  deliveriesSummary: null,
  invoices: null,
  invoicesSummary: null,
  payments: null,
  ref: null, // suppliers, products, tanks, stations for forms
  error: null,

  tabs() {
    return [
      ['orders', 'Purchase Orders', Auth.can('purchases.view')],
      ['deliveries', 'Deliveries', Auth.can('purchases.view')],
      ['invoices', 'Supplier Invoices', Auth.can('purchases.view', 'supplier_payments.manage')],
      ['payments', 'Supplier Payments', Auth.can('supplier_payments.manage', 'purchases.view')],
    ].filter(([, , ok]) => ok);
  },

  onEnter() {
    Object.assign(this, { orders: null, deliveries: null, invoices: null, payments: null, error: null });
  },

  needsLoad() {
    if (this.error) return false;
    return !this[this.tab];
  },

  async load() {
    try {
      const range = { from: this.from, to: this.to };
      if (this.tab === 'orders') {
        const r = await Api.get('/purchase-orders', { ...range, status: this.status, page: this.page, pageSize: 20 });
        Object.assign(this, { orders: r.orders, ordersTotal: r.total });
      } else if (this.tab === 'deliveries') {
        const r = await Api.get('/deliveries', { ...range, status: this.status, pageSize: 50 });
        Object.assign(this, { deliveries: r.deliveries, deliveriesSummary: r.summary });
      } else if (this.tab === 'invoices') {
        const r = await Api.get('/supplier-invoices', this.status === 'OVERDUE' ? { overdue: 'true' } : { status: this.status });
        Object.assign(this, { invoices: r.invoices, invoicesSummary: r.summary });
      } else {
        this.payments = (await Api.get('/supplier-payments', { ...range, pageSize: 50 })).payments;
      }
      this.error = null;
    } catch (err) {
      this.error = err.message;
    }
    if (Router.currentPage === 'purchases') Router.refresh();
  },

  reload(...keys) {
    (keys.length ? keys : ['orders', 'deliveries', 'invoices', 'payments']).forEach((k) => { this[k] = null; });
    this.error = null;
    if (Router.currentPage === 'purchases') Router.refresh();
  },

  setTab(tab) {
    this.tab = tab;
    this.status = '';
    this.page = 1;
    Router.refresh();
  },

  setFilter(key, value) {
    this[key] = value;
    this.page = 1;
    this.reload(this.tab);
  },

  // SECTION: reference data for forms, loaded once per visit
  async refData() {
    if (this.ref) return this.ref;
    const [s, p, t, st] = await Promise.all([Api.get('/suppliers', { status: 'ACTIVE' }), Api.get('/products'), Api.get('/tanks'), Api.get('/stations')]);
    this.ref = { suppliers: s.suppliers, products: p.products, tanks: t.tanks, stations: st.stations };
    return this.ref;
  },

  render() {
    const canManage = Auth.can('purchases.manage');
    const header = `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Purchases</h2>
          <p class="text-body-md text-outline mt-1">Order fuel, receive deliveries into tanks, and pay suppliers</p>
        </div>
        <div class="flex flex-wrap gap-2">
          ${canManage ? `
            <button onclick="PurchasesPage.openDeliveryForm()" class="px-4 py-2 border border-outline-variant rounded-lg text-body-md hover:bg-surface-container-low flex items-center gap-2"><span class="material-symbols-outlined text-lg">local_shipping</span> Record Delivery</button>
            <button onclick="PurchasesPage.openOrderForm()" class="px-4 py-2 bg-secondary text-on-secondary rounded-lg text-body-md font-semibold flex items-center gap-2"><span class="material-symbols-outlined text-lg">add_shopping_cart</span> New Order</button>` : ''}
        </div>
      </div>
      <div class="tab-list mb-6">${this.tabs().map(([k, l]) => `<button class="tab-btn ${this.tab === k ? 'active' : ''}" onclick="PurchasesPage.setTab('${k}')">${l}</button>`).join('')}</div>`;

    const statusOptions = {
      orders: [['', 'All'], ['DRAFT', 'Draft'], ['ORDERED', 'Ordered'], ['PARTIALLY_RECEIVED', 'Partly received'], ['RECEIVED', 'Received'], ['CANCELLED', 'Cancelled']],
      deliveries: [['', 'All'], ['PENDING', 'Awaiting confirmation'], ['CONFIRMED', 'Confirmed'], ['REJECTED', 'Rejected']],
      invoices: [['', 'All'], ['UNPAID,PARTIALLY_PAID', 'Open'], ['OVERDUE', 'Overdue'], ['PAID', 'Paid']],
      payments: null,
    }[this.tab];
    const filters = `
      <div class="flex flex-wrap gap-3 mb-4 items-center">
        ${this.tab !== 'invoices' ? `
          <input type="date" class="form-input w-auto" value="${this.from}" onchange="PurchasesPage.setFilter('from', this.value)" aria-label="From"/>
          <span class="text-outline">to</span>
          <input type="date" class="form-input w-auto" value="${this.to}" onchange="PurchasesPage.setFilter('to', this.value)" aria-label="To"/>` : ''}
        ${statusOptions ? `<select class="form-select w-auto" onchange="PurchasesPage.setFilter('status', this.value)">${statusOptions.map(([v, l]) => `<option value="${v}" ${this.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
        ${this.tab === 'orders' ? '<button onclick="PurchasesPage.exportCSV()" class="ml-auto px-4 py-2 border border-outline-variant rounded-lg text-body-md hover:bg-surface-container-low flex items-center gap-2"><span class="material-symbols-outlined text-lg">download</span> CSV</button>' : ''}
        ${this.tab === 'invoices' && Auth.can('purchases.manage', 'supplier_payments.manage') ? '<button onclick="PurchasesPage.openInvoiceForm()" class="ml-auto px-4 py-2 bg-primary text-on-primary rounded-lg text-body-md font-semibold">Add Supplier Invoice</button>' : ''}
      </div>`;

    if (this.error) return header + filters + Utils.errorState(this.error, 'PurchasesPage.reload()');
    if (this.needsLoad()) return header + filters + Utils.loadingState();
    return header + filters + { orders: () => this.renderOrders(), deliveries: () => this.renderDeliveries(), invoices: () => this.renderInvoices(), payments: () => this.renderPayments() }[this.tab]();
  },

  afterRender() {
    if (this.needsLoad()) this.load();
  },

  // ─── Orders ─────────────────────────────────────────────────

  renderOrders() {
    const rows = this.orders.map((o) => `
      <tr>
        <td class="font-semibold text-data-mono whitespace-nowrap">${Utils.escapeHtml(o.orderNo)}</td>
        <td class="whitespace-nowrap">${Utils.formatDate(o.orderDate)}</td>
        <td>${Utils.escapeHtml(o.supplier.name)}</td>
        <td>${o.items.map((i) => `${Utils.formatNumber(i.quantity)} L ${Utils.escapeHtml(i.product.name)}`).join('<br>')}</td>
        <td class="text-data-mono font-semibold">${Utils.formatCurrency(o.totalAmount)}</td>
        <td class="whitespace-nowrap">${o.expectedDate ? Utils.formatDate(o.expectedDate) : '—'}</td>
        <td>${Billing.badge(o.status)}</td>
        <td><button onclick="PurchasesPage.openOrder('${o.id}')" class="text-secondary hover:underline text-sm">Open</button></td>
      </tr>`);
    return `<div class="page-section">
      ${Utils.renderDataTable(['Order #', 'Date', 'Supplier', 'Fuel', 'Total', 'Expected', 'Status', ''], rows, 'No purchase orders')}
      ${Utils.renderPagination(this.page, Math.max(1, Math.ceil(this.ordersTotal / 20)), 'PurchasesPage.goToPage')}</div>`;
  },

  goToPage(p) {
    this.page = p;
    this.reload('orders');
  },

  async openOrderForm(supplierId = null) {
    let ref;
    try {
      ref = await this.refData();
    } catch (err) {
      return Utils.toast(err.message, 'error');
    }
    if (!ref.suppliers.length) return Utils.toast('Add a supplier first', 'error');
    const productOptions = ref.products.map((p) => `<option value="${p.id}" data-cost="${p.costPrice}">${Utils.escapeHtml(p.name)}</option>`).join('');
    const line = (i) => `
      <div class="grid grid-cols-12 gap-2 po-line" data-line="${i}">
        <select name="productId" class="form-select col-span-12 sm:col-span-5" onchange="PurchasesPage.poDefaultCost(this)"><option value="">— product —</option>${productOptions}</select>
        <input name="quantity" type="number" step="0.001" min="0.001" placeholder="Liters" class="form-input col-span-6 sm:col-span-3" oninput="PurchasesPage.poTotal()"/>
        <input name="unitCost" type="number" step="0.0001" min="0.0001" placeholder="Cost / L" class="form-input col-span-6 sm:col-span-4" oninput="PurchasesPage.poTotal()"/>
      </div>`;
    Utils.openModal('New Purchase Order', `
      <form id="po-form" class="space-y-1">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Supplier</label><select name="supplierId" class="form-select">${ref.suppliers.map((s) => `<option value="${s.id}" ${s.id === supplierId ? 'selected' : ''}>${Utils.escapeHtml(s.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">Expected Delivery</label><input name="expectedDate" type="date" class="form-input"/></div>
        </div>
        ${!Auth.getSession().stationId ? `<div class="form-group"><label class="form-label">Deliver to Station</label><select name="stationId" class="form-select">${ref.stations.map((s) => `<option value="${s.id}">${Utils.escapeHtml(s.name)}</option>`).join('')}</select></div>` : ''}
        <label class="form-label">Fuel</label>
        <div class="space-y-2" id="po-lines">${line(0)}${line(1)}</div>
        <div class="form-group mt-3"><label class="form-label">Notes</label><input name="notes" class="form-input" maxlength="500"/></div>
        <div class="text-right text-headline-md font-headline-md" id="po-total">${Utils.formatCurrency(0)}</div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="PurchasesPage.saveOrder(false)" class="px-4 py-2 border border-outline-variant rounded">Save Draft</button>
      <button onclick="PurchasesPage.saveOrder(true)" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Send Order</button>`);
  },

  poDefaultCost(select) {
    const cost = select.selectedOptions[0]?.dataset.cost;
    const input = select.closest('.po-line').querySelector('[name="unitCost"]');
    if (cost && !input.value) input.value = cost;
    this.poTotal();
  },

  poLines() {
    return [...document.querySelectorAll('#po-lines .po-line')].map((el) => ({
      productId: el.querySelector('[name="productId"]').value,
      quantity: el.querySelector('[name="quantity"]').value,
      unitCost: el.querySelector('[name="unitCost"]').value,
    })).filter((l) => l.productId);
  },

  poTotal() {
    const total = this.poLines().reduce((a, l) => a + Math.round((Number(l.quantity) || 0) * (Number(l.unitCost) || 0) * 100) / 100, 0);
    const el = document.getElementById('po-total');
    if (el) el.textContent = `Total ${Utils.formatCurrency(total)}`;
  },

  async saveOrder(submit) {
    const form = document.getElementById('po-form');
    const items = this.poLines();
    if (!items.length) return Utils.toast('Add at least one product', 'error');
    if (items.some((l) => !(Number(l.quantity) > 0) || !(Number(l.unitCost) > 0))) return Utils.toast('Enter liters and cost for each product', 'error');
    const body = { supplierId: form.supplierId.value, items, submit, notes: form.notes.value, ...(form.expectedDate.value ? { expectedDate: form.expectedDate.value } : {}), ...(form.stationId ? { stationId: form.stationId.value } : {}) };
    const res = await Utils.act(() => Api.post('/purchase-orders', body), submit ? 'Purchase order sent' : 'Draft saved');
    if (!res) return;
    this.reload('orders');
    this.openOrder(res.order.id);
  },

  // SECTION: order detail — ordered vs received per product, deliveries, actions
  async openOrder(id) {
    const res = await Utils.act(() => Api.get(`/purchase-orders/${id}`));
    if (!res) return;
    const o = res.order;
    const canManage = Auth.can('purchases.manage');
    const open = ['ORDERED', 'PARTIALLY_RECEIVED'].includes(o.status);
    Utils.openModal(`Purchase Order ${Utils.escapeHtml(o.orderNo)}`, `
      <div class="space-y-4">
        <div class="flex flex-wrap justify-between gap-2">
          <div><p class="font-semibold">${Utils.escapeHtml(o.supplier.name)}</p><p class="text-sm text-outline">${Utils.escapeHtml(o.station.name)} · by ${Utils.escapeHtml(o.createdBy.name)} · ${Utils.formatDate(o.orderDate)}${o.expectedDate ? ` · expected ${Utils.formatDate(o.expectedDate)}` : ''}</p></div>
          <div>${Billing.badge(o.status)}</div>
        </div>
        <div class="overflow-x-auto"><table class="data-table w-full text-sm"><thead><tr><th>Fuel</th><th class="text-right">Ordered</th><th class="text-right">Received</th><th class="text-right">Cost / L</th><th class="text-right">Amount</th></tr></thead><tbody>
          ${o.items.map((i) => `<tr><td>${Utils.escapeHtml(i.product.name)}</td><td class="text-right text-data-mono">${Utils.formatNumber(i.quantity)} L</td>
            <td class="text-right text-data-mono ${Number(i.received) >= Number(i.quantity) ? 'text-secondary' : ''}">${Utils.formatNumber(i.received)} L</td>
            <td class="text-right text-data-mono">${Billing.price(i.unitCost)}</td><td class="text-right text-data-mono">${Utils.formatCurrency(i.lineTotal)}</td></tr>`).join('')}
          <tr class="font-semibold"><td colspan="4">Total</td><td class="text-right text-data-mono">${Utils.formatCurrency(o.totalAmount)}</td></tr>
        </tbody></table></div>
        ${o.deliveries.length ? `<div><p class="text-label-sm text-outline mb-1">DELIVERIES</p>${o.deliveries.map((d) => `
          <div class="flex justify-between text-sm py-1.5 border-b border-outline-variant/50"><span>${Utils.escapeHtml(d.deliveryNo)} · ${Utils.formatDate(d.deliveryDate)} · tank ${Utils.escapeHtml(d.tank.code)}</span><span>${Billing.badge(d.status)} <span class="text-data-mono ml-2">${Utils.formatNumber(d.quantityDelivered)} L</span></span></div>`).join('')}</div>` : ''}
        ${o.invoices.length ? `<div><p class="text-label-sm text-outline mb-1">SUPPLIER INVOICES</p>${o.invoices.map((i) => `
          <div class="flex justify-between text-sm py-1.5 border-b border-outline-variant/50"><span>${Utils.escapeHtml(i.invoiceNumber)}</span><span>${Billing.badge(i.status)} <span class="text-data-mono ml-2">${Utils.formatCurrency(i.amount)}</span></span></div>`).join('')}</div>` : ''}
        ${o.notes ? `<p class="text-sm text-outline">${Utils.escapeHtml(o.notes)}</p>` : ''}
      </div>`, canManage ? `
      ${['DRAFT', 'ORDERED'].includes(o.status) ? `<button onclick="PurchasesPage.poAction('${o.id}', 'cancel')" class="px-3 py-2 border border-error/40 text-error rounded text-sm mr-auto">Cancel Order</button>` : ''}
      ${o.status === 'PARTIALLY_RECEIVED' ? `<button onclick="PurchasesPage.poAction('${o.id}', 'close')" class="px-3 py-2 border border-outline-variant rounded text-sm mr-auto">Close (accept short)</button>` : ''}
      ${o.status === 'DRAFT' ? `<button onclick="PurchasesPage.poAction('${o.id}', 'order')" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Send Order</button>` : ''}
      ${!['DRAFT', 'CANCELLED'].includes(o.status) ? `<button onclick="PurchasesPage.openInvoiceForm('${o.supplier.id}', '${o.id}', ${Number(o.totalAmount)})" class="px-3 py-2 border border-outline-variant rounded text-sm">Add Supplier Invoice</button>` : ''}
      ${open ? `<button onclick="PurchasesPage.openDeliveryForm('${o.id}')" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Record Delivery</button>` : ''}` : '');
    this.currentOrder = o;
  },

  poAction(id, action) {
    const msg = { order: 'Send this order to the supplier?', cancel: 'Cancel this purchase order?', close: 'Close this order and accept the quantity received so far?' }[action];
    Utils.confirm(msg, async () => {
      const ok = await Utils.act(() => Api.post(`/purchase-orders/${id}/${action}`), 'Purchase order updated');
      if (!ok) return;
      this.reload('orders');
      this.openOrder(id);
    });
  },

  async exportCSV() {
    const res = await Utils.act(() => Api.get('/purchase-orders', { from: this.from, to: this.to, status: this.status, pageSize: 100 }));
    if (!res) return;
    Utils.exportCSV(`purchase-orders-${Utils.today()}.csv`, ['Order #', 'Date', 'Supplier', 'Station', 'Fuel', 'Liters', 'Total', 'Status'],
      res.orders.map((o) => [o.orderNo, Utils.formatDate(o.orderDate), o.supplier.name, o.station.name, o.items.map((i) => i.product.name).join('; '),
        o.items.reduce((a, i) => a + Number(i.quantity), 0), o.totalAmount, o.status]));
  },

  // ─── Deliveries ─────────────────────────────────────────────

  renderDeliveries() {
    const canConfirm = Auth.can('deliveries.confirm');
    const rows = this.deliveries.map((d) => `
      <tr>
        <td class="font-semibold text-data-mono whitespace-nowrap">${Utils.escapeHtml(d.deliveryNo)}</td>
        <td class="whitespace-nowrap">${Utils.formatDate(d.deliveryDate)}</td>
        <td>${Utils.escapeHtml(d.supplier.name)}${d.purchaseOrder ? `<div class="text-xs text-outline">${Utils.escapeHtml(d.purchaseOrder.orderNo)}</div>` : ''}</td>
        <td>${Utils.escapeHtml(d.product.name)} → ${Utils.escapeHtml(d.tank.code)}</td>
        <td class="text-data-mono">${Utils.formatNumber(d.quantityDelivered, 1)} L</td>
        <td class="text-data-mono">${Utils.formatCurrency(d.totalCost)}</td>
        <td>${Billing.badge(d.status)}<div class="text-xs text-outline">${Utils.escapeHtml(d.receivedBy.name)}</div></td>
        <td class="whitespace-nowrap">${d.status === 'PENDING' && canConfirm ? `
          <button onclick="PurchasesPage.confirmDelivery('${d.id}', ${Number(d.quantityDelivered)})" class="text-secondary hover:underline text-sm mr-2">Confirm</button>
          <button onclick="PurchasesPage.rejectDelivery('${d.id}')" class="text-error hover:underline text-sm">Reject</button>` : ''}</td>
      </tr>`);
    const pending = this.deliveries.filter((d) => d.status === 'PENDING').length;
    return `
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div class="page-section"><span class="text-label-sm text-outline">LITERS RECEIVED</span><div class="text-headline-md font-headline-md mt-1">${Utils.formatNumber(this.deliveriesSummary.liters)} L</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">COST</span><div class="text-headline-md font-headline-md mt-1">${Utils.formatCurrency(this.deliveriesSummary.cost)}</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">AWAITING CONFIRMATION</span><div class="text-headline-md font-headline-md mt-1 ${pending ? 'text-tertiary-fixed-dim' : ''}">${pending}</div></div>
      </div>
      <div class="page-section">
        <p class="text-sm text-outline mb-4">Stock is added to the tank only when a delivery is confirmed, after the fuel has been measured.</p>
        ${Utils.renderDataTable(['Delivery #', 'Date', 'Supplier', 'Fuel → Tank', 'Liters', 'Cost', 'Status', ''], rows, 'No deliveries')}
      </div>`;
  },

  async openDeliveryForm(orderId = null) {
    let ref;
    try {
      ref = await this.refData();
    } catch (err) {
      return Utils.toast(err.message, 'error');
    }
    const order = orderId ? (this.currentOrder?.id === orderId ? this.currentOrder : (await Api.get(`/purchase-orders/${orderId}`)).order) : null;
    const productIds = order ? order.items.map((i) => i.productId) : null;
    const tanks = ref.tanks.filter((t) => (!order || (t.stationId === order.station.id && productIds.includes(t.productId))) && t.status !== 'OUT_OF_SERVICE');
    if (!tanks.length) return Utils.toast('No suitable tank for this delivery', 'error');
    Utils.openModal(order ? `Record Delivery — ${Utils.escapeHtml(order.orderNo)}` : 'Record Delivery', `
      <form id="delivery-form">
        ${order ? `<p class="text-sm text-outline mb-4">${order.items.map((i) => `${Utils.escapeHtml(i.product.name)}: ${Utils.formatNumber(Number(i.quantity) - Number(i.received))} L outstanding at ${Billing.price(i.unitCost)}/L`).join('<br>')}</p>`
          : `<div class="form-group"><label class="form-label">Supplier</label><select name="supplierId" class="form-select">${ref.suppliers.map((s) => `<option value="${s.id}">${Utils.escapeHtml(s.name)}</option>`).join('')}</select></div>`}
        <div class="form-group"><label class="form-label">Into Tank</label><select name="tankId" class="form-select">${tanks.map((t) => `<option value="${t.id}">${Utils.escapeHtml(t.code)} — ${Utils.escapeHtml(t.product.name)} (${Utils.formatNumber(t.currentLiters)} / ${Utils.formatNumber(t.capacityLiters)} L)</option>`).join('')}</select></div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-group"><label class="form-label">Liters (delivery note)</label><input name="quantityDelivered" type="number" step="0.001" min="0.001" class="form-input" required/></div>
          <div class="form-group"><label class="form-label">Cost / L${order ? ' (optional)' : ''}</label><input name="unitCost" type="number" step="0.0001" min="0.0001" class="form-input" ${order ? 'placeholder="From order"' : 'required'}/></div>
          <div class="form-group"><label class="form-label">Date</label><input name="deliveryDate" type="date" class="form-input" value="${Utils.today()}"/></div>
        </div>
        <div class="form-group"><label class="form-label">Notes (truck, driver, seal numbers)</label><input name="notes" class="form-input" maxlength="500"/></div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="PurchasesPage.saveDelivery(${order ? `'${order.id}'` : ''})" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Record</button>`);
  },

  async saveDelivery(orderId) {
    const d = Utils.getFormData('delivery-form');
    const body = { tankId: d.tankId, quantityDelivered: d.quantityDelivered, deliveryDate: d.deliveryDate || undefined, notes: d.notes, ...(orderId ? { purchaseOrderId: orderId } : { supplierId: d.supplierId }), ...(d.unitCost ? { unitCost: d.unitCost } : {}) };
    const res = await Utils.act(() => Api.post('/deliveries', body), 'Delivery recorded — confirm it after measuring the tank');
    if (!res) return;
    Utils.closeModal();
    this.ref = null; // tank levels may change on confirmation
    this.reload('deliveries', 'orders');
  },

  confirmDelivery(id, noted) {
    Utils.openModal('Confirm Delivery', `
      <form id="confirm-form">
        <p class="text-sm text-outline mb-4">Measure the tank before and after offloading. Enter the liters actually received; it can be less than the delivery note (${Utils.formatNumber(noted, 3)} L), never more.</p>
        <div class="form-group"><label class="form-label">Liters received</label><input name="quantityDelivered" type="number" step="0.001" min="0.001" max="${noted}" value="${noted}" class="form-input text-lg" required/></div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="PurchasesPage.saveConfirm('${id}')" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Confirm &amp; Add to Stock</button>`);
  },

  async saveConfirm(id) {
    const d = Utils.getFormData('confirm-form');
    const ok = await Utils.act(() => Api.post(`/deliveries/${id}/confirm`, d), 'Delivery confirmed — stock updated');
    if (!ok) return;
    Utils.closeModal();
    this.ref = null;
    this.reload('deliveries', 'orders');
  },

  rejectDelivery(id) {
    Utils.openModal('Reject Delivery', `
      <form id="reject-form"><div class="form-group"><label class="form-label">Reason</label><input name="reason" class="form-input" required minlength="5" placeholder="Contaminated, wrong product, short..."/></div></form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="PurchasesPage.saveReject('${id}')" class="px-4 py-2 bg-error text-on-error rounded font-semibold">Reject</button>`);
  },

  async saveReject(id) {
    const ok = await Utils.act(() => Api.post(`/deliveries/${id}/reject`, Utils.getFormData('reject-form')), 'Delivery rejected');
    if (!ok) return;
    Utils.closeModal();
    this.reload('deliveries', 'orders');
  },

  // ─── Supplier invoices & payments ───────────────────────────

  renderInvoices() {
    const canPay = Auth.can('supplier_payments.manage');
    const now = new Date();
    const rows = this.invoices.map((i) => {
      const bal = Number(i.amount) - Number(i.amountPaid);
      const overdue = bal > 0 && i.dueDate && new Date(i.dueDate) < now;
      return `
      <tr>
        <td class="font-semibold">${Utils.escapeHtml(i.invoiceNumber)}${i.purchaseOrder ? `<div class="text-xs text-outline">${Utils.escapeHtml(i.purchaseOrder.orderNo)}</div>` : ''}</td>
        <td>${Utils.escapeHtml(i.supplier.name)}</td>
        <td class="whitespace-nowrap">${Utils.formatDate(i.issueDate)}</td>
        <td class="whitespace-nowrap ${overdue ? 'text-error font-semibold' : ''}">${i.dueDate ? Utils.formatDate(i.dueDate) : '—'}${overdue ? ' (overdue)' : ''}</td>
        <td class="text-data-mono">${Utils.formatCurrency(i.amount)}</td>
        <td class="text-data-mono font-semibold ${bal > 0 ? 'text-error' : ''}">${Utils.formatCurrency(bal)}</td>
        <td>${Billing.badge(i.status)}</td>
        <td>${canPay && bal > 0 ? `<button onclick="PurchasesPage.openPayForm('${i.id}')" class="text-secondary hover:underline text-sm">Pay</button>` : ''}</td>
      </tr>`;
    });
    return `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div class="page-section"><span class="text-label-sm text-outline">OWED TO SUPPLIERS</span><div class="text-headline-md font-headline-md mt-1 text-error">${Utils.formatCurrency(this.invoicesSummary.outstanding)}</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">OPEN INVOICES</span><div class="text-headline-md font-headline-md mt-1">${this.invoicesSummary.open}</div></div>
      </div>
      <div class="page-section">${Utils.renderDataTable(['Invoice #', 'Supplier', 'Issued', 'Due', 'Amount', 'Balance', 'Status', ''], rows, 'No supplier invoices')}</div>`;
  },

  async openInvoiceForm(supplierId = null, orderId = null, amount = null) {
    let ref;
    try {
      ref = await this.refData();
    } catch (err) {
      return Utils.toast(err.message, 'error');
    }
    Utils.openModal('Add Supplier Invoice', `
      <form id="sinv-form">
        <div class="form-group"><label class="form-label">Supplier</label><select name="supplierId" class="form-select" ${supplierId ? 'disabled' : ''}>${ref.suppliers.map((s) => `<option value="${s.id}" ${s.id === supplierId ? 'selected' : ''}>${Utils.escapeHtml(s.name)}</option>`).join('')}</select></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Supplier's Invoice No.</label><input name="invoiceNumber" class="form-input" required/></div>
          <div class="form-group"><label class="form-label">Amount</label><input name="amount" type="number" step="0.01" min="0.01" class="form-input" required value="${amount ? amount.toFixed(2) : ''}"/></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Issue Date</label><input name="issueDate" type="date" class="form-input" value="${Utils.today()}" required/></div>
          <div class="form-group"><label class="form-label">Due Date</label><input name="dueDate" type="date" class="form-input"/></div>
        </div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="PurchasesPage.saveInvoice(${supplierId ? `'${supplierId}'` : 'null'}, ${orderId ? `'${orderId}'` : 'null'})" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>`);
  },

  async saveInvoice(supplierId, orderId) {
    const d = Utils.getFormData('sinv-form');
    const body = { supplierId: supplierId || d.supplierId, invoiceNumber: d.invoiceNumber, amount: d.amount, issueDate: d.issueDate, ...(d.dueDate ? { dueDate: d.dueDate } : {}), ...(orderId ? { purchaseOrderId: orderId } : {}) };
    const ok = await Utils.act(() => Api.post('/supplier-invoices', body), 'Supplier invoice added');
    if (!ok) return;
    Utils.closeModal();
    this.reload('invoices');
  },

  openPayForm(invoiceId) {
    const i = this.invoices.find((x) => x.id === invoiceId);
    const bal = Number(i.amount) - Number(i.amountPaid);
    Utils.openModal(`Pay ${Utils.escapeHtml(i.supplier.name)}`, `
      <form id="spay-form">
        <p class="text-sm text-outline mb-4">Invoice ${Utils.escapeHtml(i.invoiceNumber)} · balance ${Utils.formatCurrency(bal)}</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Amount</label><input name="amount" type="number" step="0.01" min="0.01" max="${bal.toFixed(2)}" value="${bal.toFixed(2)}" class="form-input" required/></div>
          <div class="form-group"><label class="form-label">Method</label><select name="method" class="form-select"><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="ZAAD">ZAAD</option><option value="EDAHAB">eDAHAB</option></select></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Reference</label><input name="reference" class="form-input" maxlength="100"/></div>
          <div class="form-group"><label class="form-label">Paid On</label><input name="paidAt" type="date" class="form-input" value="${Utils.today()}"/></div>
        </div>
        <p class="text-xs text-outline">Records a payment you made outside the system (bank or mobile money). It does not send money.</p>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button id="spay-save" onclick="PurchasesPage.savePay('${invoiceId}')" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Record Payment</button>`);
  },

  async savePay(invoiceId) {
    const btn = document.getElementById('spay-save');
    if (btn.disabled) return;
    btn.disabled = true;
    const ok = await Utils.act(() => Api.post('/supplier-payments', { ...Utils.getFormData('spay-form'), supplierInvoiceId: invoiceId }), 'Supplier payment recorded');
    btn.disabled = false;
    if (!ok) return;
    Utils.closeModal();
    this.reload('invoices', 'payments');
  },

  renderPayments() {
    const rows = this.payments.map((p) => `
      <tr>
        <td class="font-semibold text-data-mono">${Utils.escapeHtml(p.paymentNo)}</td>
        <td class="whitespace-nowrap">${Utils.formatDate(p.paidAt)}</td>
        <td>${Utils.escapeHtml(p.supplier.name)}</td>
        <td>${p.supplierInvoice ? Utils.escapeHtml(p.supplierInvoice.invoiceNumber) : '—'}</td>
        <td>${Billing.method(p.method)}${p.reference ? `<div class="text-xs text-outline">${Utils.escapeHtml(p.reference)}</div>` : ''}</td>
        <td class="text-data-mono font-semibold">${Utils.formatCurrency(p.amount)}</td>
        <td>${Utils.escapeHtml(p.recordedBy.name)}</td>
      </tr>`);
    return `<div class="page-section">${Utils.renderDataTable(['Payment #', 'Date', 'Supplier', 'Invoice', 'Method', 'Amount', 'Recorded by'], rows, 'No supplier payments')}</div>`;
  },

  // kept for the global quick-add button
  openAdd() {
    this.openOrderForm();
  },
};

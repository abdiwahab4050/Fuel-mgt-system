/**
 * Suppliers Page
 */
// SECTION: Suppliers page object — supplier register with balances owed and purchase history; data from /api/suppliers
const SuppliersPage = {
  search: '',
  page: 1,
  suppliers: null,
  error: null,

  onEnter() {
    this.suppliers = null;
    this.error = null;
  },

  async load() {
    try {
      this.suppliers = (await Api.get('/suppliers', { search: this.search })).suppliers;
      this.error = null;
    } catch (err) {
      this.error = err.message;
    }
    if (Router.currentPage === 'suppliers') Router.refresh();
  },

  reload() {
    this.suppliers = null;
    this.error = null;
    if (Router.currentPage === 'suppliers') Router.refresh();
  },

  render() {
    const canManage = Auth.can('suppliers.manage');
    const header = `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Suppliers</h2>
          <p class="text-body-md text-outline mt-1">Fuel suppliers, what you owe them and purchase history</p>
        </div>
        ${canManage ? `<button onclick="SuppliersPage.openForm()" class="px-4 py-2 bg-primary text-on-primary rounded-lg text-body-md font-semibold flex items-center gap-2"><span class="material-symbols-outlined text-lg">add_business</span> Add Supplier</button>` : ''}
      </div>
      <div class="flex flex-wrap gap-3 mb-6">
        <div class="relative flex-1 min-w-[200px]"><span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg">search</span>
          <input id="sup-search" type="search" placeholder="Name, code or contact then Enter" class="form-input pl-10" value="${Utils.escapeHtml(this.search)}"/></div>
      </div>`;
    if (this.error) return header + Utils.errorState(this.error, 'SuppliersPage.reload()');
    if (!this.suppliers) return header + Utils.loadingState('Loading suppliers...');

    const owed = this.suppliers.reduce((a, s) => a + Number(s.outstanding), 0);
    const paginated = Utils.paginate(this.suppliers, this.page, 15);
    const rows = paginated.items.map((s) => `
      <tr>
        <td class="font-semibold text-data-mono whitespace-nowrap">${Utils.escapeHtml(s.code)}</td>
        <td class="font-semibold">${Utils.escapeHtml(s.name)}</td>
        <td>${Utils.escapeHtml(s.contactPerson || '')}${s.phone ? `<div class="text-xs text-outline">${Utils.escapeHtml(s.phone)}</div>` : ''}</td>
        <td>${s._count.purchaseOrders} orders · ${s._count.deliveries} deliveries</td>
        <td class="text-data-mono font-semibold ${s.outstanding > 0 ? 'text-error' : ''}">${Utils.formatCurrency(s.outstanding)}${s.openInvoices ? `<div class="text-xs text-outline font-normal">${s.openInvoices} open invoice(s)</div>` : ''}</td>
        <td>${Utils.badge(s.status === 'ACTIVE' ? 'Active' : 'Inactive', s.status === 'ACTIVE' ? 'success' : 'neutral')}</td>
        <td class="whitespace-nowrap">
          <button onclick="SuppliersPage.openDetail('${s.id}')" class="text-secondary hover:underline text-sm mr-2">View</button>
          ${canManage ? `<button onclick="SuppliersPage.openForm('${s.id}')" class="text-primary hover:underline text-sm">Edit</button>` : ''}
        </td>
      </tr>`);
    return header + `
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div class="page-section"><span class="text-label-sm text-outline">SUPPLIERS</span><div class="text-headline-md font-headline-md mt-1">${this.suppliers.length}</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">ACTIVE</span><div class="text-headline-md font-headline-md mt-1">${this.suppliers.filter((s) => s.status === 'ACTIVE').length}</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">OWED TO SUPPLIERS</span><div class="text-headline-md font-headline-md mt-1 text-error">${Utils.formatCurrency(owed)}</div></div>
      </div>
      <div class="page-section">
        ${Utils.renderDataTable(['Code', 'Supplier', 'Contact', 'History', 'Balance Owed', 'Status', ''], rows, 'No suppliers found')}
        ${Utils.renderPagination(paginated.page, paginated.pages, 'SuppliersPage.goToPage')}
      </div>`;
  },

  afterRender() {
    if (!this.suppliers && !this.error) this.load();
    document.getElementById('sup-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.search = e.target.value.trim();
        this.page = 1;
        this.reload();
      }
    });
  },

  goToPage(p) {
    this.page = p;
    Router.refresh();
  },

  // kept for the global quick-add button
  openAdd() {
    this.openForm();
  },

  openForm(id = null) {
    const s = id ? this.suppliers.find((x) => x.id === id) : null;
    const v = (k) => (s?.[k] ? Utils.escapeHtml(s[k]) : '');
    Utils.openModal(s ? `Edit ${Utils.escapeHtml(s.name)}` : 'Add Supplier', `
      <form id="supplier-form">
        <div class="form-group"><label class="form-label">Supplier Name</label><input name="name" class="form-input" required value="${v('name')}"/></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Contact Person</label><input name="contactPerson" class="form-input" value="${v('contactPerson')}"/></div>
          <div class="form-group"><label class="form-label">Phone</label><input name="phone" class="form-input" value="${v('phone')}"/></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Email</label><input name="email" type="email" class="form-input" value="${v('email')}"/></div>
          <div class="form-group"><label class="form-label">Tax / Registration No.</label><input name="taxId" class="form-input" value="${v('taxId')}"/></div>
        </div>
        <div class="form-group"><label class="form-label">Address</label><input name="address" class="form-input" value="${v('address')}"/></div>
        ${s ? `<div class="form-group"><label class="form-label">Status</label><select name="status" class="form-select"><option value="ACTIVE">Active</option><option value="INACTIVE" ${s.status === 'INACTIVE' ? 'selected' : ''}>Inactive</option></select></div>` : ''}
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="SuppliersPage.save(${s ? `'${s.id}'` : ''})" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>`);
  },

  async save(id) {
    const d = Utils.getFormData('supplier-form');
    const ok = id ? await Utils.act(() => Api.patch(`/suppliers/${id}`, d), 'Supplier updated') : await Utils.act(() => Api.post('/suppliers', d), 'Supplier added');
    if (!ok) return;
    Utils.closeModal();
    this.reload();
  },

  async openDetail(id) {
    const res = await Utils.act(() => Api.get(`/suppliers/${id}`));
    if (!res) return;
    const s = res.supplier;
    Utils.openModal(Utils.escapeHtml(s.name), `
      <div class="space-y-4">
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div class="p-3 rounded-lg bg-surface-container-low"><p class="text-label-sm text-outline">OWED</p><p class="font-semibold ${s.outstanding > 0 ? 'text-error' : ''}">${Utils.formatCurrency(s.outstanding)}</p></div>
          <div class="p-3 rounded-lg bg-surface-container-low"><p class="text-label-sm text-outline">DELIVERED</p><p class="font-semibold">${Utils.formatNumber(s.litersDelivered)} L</p></div>
          <div class="p-3 rounded-lg bg-surface-container-low"><p class="text-label-sm text-outline">PURCHASED</p><p class="font-semibold">${Utils.formatCurrency(s.totalPurchased)}</p></div>
        </div>
        <p class="text-sm"><span class="text-outline">${Utils.escapeHtml(s.code)}</span> · ${Utils.escapeHtml([s.contactPerson, s.phone, s.email].filter(Boolean).join(' · ') || 'No contact details')}${s.address ? `<br>${Utils.escapeHtml(s.address)}` : ''}</p>
        ${s.purchaseOrders.length ? `<div><p class="text-label-sm text-outline mb-1">RECENT ORDERS</p>${s.purchaseOrders.map((o) => `
          <button onclick="PurchasesPage.openOrder('${o.id}')" class="w-full flex justify-between text-sm py-1.5 border-b border-outline-variant/50 hover:bg-surface-container-low text-left">
            <span class="text-data-mono">${Utils.escapeHtml(o.orderNo)} · ${Utils.formatDate(o.orderDate)}</span><span>${Billing.badge(o.status)} <span class="text-data-mono ml-2">${Utils.formatCurrency(o.totalAmount)}</span></span></button>`).join('')}</div>` : ''}
        ${s.invoices.length ? `<div><p class="text-label-sm text-outline mb-1">SUPPLIER INVOICES</p>${s.invoices.map((i) => `
          <div class="flex justify-between text-sm py-1.5 border-b border-outline-variant/50"><span>${Utils.escapeHtml(i.invoiceNumber)} · due ${i.dueDate ? Utils.formatDate(i.dueDate) : '—'}</span>
          <span>${Billing.badge(i.status)} <span class="text-data-mono ml-2">${Utils.formatCurrency(Number(i.amount) - Number(i.amountPaid))} / ${Utils.formatCurrency(i.amount)}</span></span></div>`).join('')}</div>` : ''}
        ${s.payments.length ? `<div><p class="text-label-sm text-outline mb-1">PAYMENTS MADE</p>${s.payments.map((p) => `
          <div class="flex justify-between text-sm py-1.5 border-b border-outline-variant/50"><span>${Utils.escapeHtml(p.paymentNo)} · ${Utils.formatDate(p.paidAt)} · ${Billing.method(p.method)}</span><span class="text-data-mono">${Utils.formatCurrency(p.amount)}</span></div>`).join('')}</div>` : ''}
      </div>`, Auth.can('purchases.manage') ? `<button onclick="Utils.closeModal(); PurchasesPage.openOrderForm('${s.id}')" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">New Purchase Order</button>` : '');
  },
};

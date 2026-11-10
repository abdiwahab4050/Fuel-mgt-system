/**
 * Customers Page
 */
// SECTION: Customers page object — registration, credit accounts, balances, statements, portal logins
const CustomersPage = {
  search: '',
  filter: '',
  page: 1,
  customers: null,
  error: null,

  onEnter() {
    this.customers = null;
    this.error = null;
  },

  async load() {
    try {
      const params = { search: this.search };
      if (this.filter === 'credit') params.credit = 'true';
      if (this.filter === 'inactive') params.status = 'INACTIVE';
      this.customers = (await Api.get('/customers', params)).customers;
      if (this.filter === 'owing') this.customers = this.customers.filter((c) => c.outstanding > 0);
      this.error = null;
    } catch (err) {
      this.error = err.message;
    }
    if (Router.currentPage === 'customers') Router.refresh();
  },

  reload() {
    this.customers = null;
    this.error = null;
    if (Router.currentPage === 'customers') Router.refresh();
  },

  setFilter(key, value) {
    this[key] = value;
    this.page = 1;
    this.reload();
  },

  render() {
    const canManage = Auth.can('customers.manage');
    const header = `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Customers</h2>
          <p class="text-body-md text-outline mt-1">Registered customers, credit accounts and balances</p>
        </div>
        ${canManage ? `<button onclick="CustomersPage.openForm()" class="px-4 py-2 bg-secondary text-on-secondary rounded-lg text-body-md font-semibold flex items-center gap-2"><span class="material-symbols-outlined text-lg">person_add</span> New Customer</button>` : ''}
      </div>
      <div class="flex flex-wrap gap-3 mb-6 items-center">
        <div class="relative flex-1 min-w-[200px]"><span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg">search</span>
          <input id="cus-search" type="search" placeholder="Name, phone, email or customer # then Enter" class="form-input pl-10" value="${Utils.escapeHtml(this.search)}"/></div>
        <select class="form-select w-auto" onchange="CustomersPage.setFilter('filter', this.value)">
          ${[['', 'All active & inactive'], ['credit', 'Credit accounts'], ['owing', 'With balance due'], ['inactive', 'Inactive']].map(([v, l]) => `<option value="${v}" ${this.filter === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>`;
    if (this.error) return header + Utils.errorState(this.error, 'CustomersPage.reload()');
    if (!this.customers) return header + Utils.loadingState('Loading customers...');

    const owing = this.customers.reduce((a, c) => a + Number(c.outstanding), 0);
    const paginated = Utils.paginate(this.customers, this.page, 15);
    const rows = paginated.items.map((c) => `
      <tr>
        <td class="font-semibold text-data-mono whitespace-nowrap">${Utils.escapeHtml(c.customerNo)}</td>
        <td><span class="font-semibold">${Utils.escapeHtml(c.name)}</span>${c.type === 'BUSINESS' ? ` ${Utils.badge('Business', 'info')}` : ''}</td>
        <td>${Utils.escapeHtml(c.phone || '')}</td>
        <td class="text-data-mono">${c.creditAllowed ? Utils.formatCurrency(c.creditLimit) : '<span class="text-outline">—</span>'}</td>
        <td class="text-data-mono font-semibold ${c.outstanding > 0 ? 'text-error' : ''}">${Utils.formatCurrency(c.outstanding)}</td>
        <td>${Utils.badge(c.status === 'ACTIVE' ? 'Active' : 'Inactive', c.status === 'ACTIVE' ? 'success' : 'neutral')}</td>
        <td class="whitespace-nowrap">
          <button onclick="CustomersPage.openDetail('${c.id}')" class="text-secondary hover:underline text-sm mr-2">View</button>
          ${Auth.can('customers.manage', 'customers.credit.manage') ? `<button onclick="CustomersPage.openForm('${c.id}')" class="text-primary hover:underline text-sm">Edit</button>` : ''}
        </td>
      </tr>`);
    return header + `
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div class="page-section"><span class="text-label-sm text-outline">CUSTOMERS</span><div class="text-headline-md font-headline-md mt-1">${this.customers.length}</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">CREDIT ACCOUNTS</span><div class="text-headline-md font-headline-md mt-1">${this.customers.filter((c) => c.creditAllowed).length}</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">TOTAL OWED TO YOU</span><div class="text-headline-md font-headline-md mt-1 text-error">${Utils.formatCurrency(owing)}</div></div>
      </div>
      <div class="page-section">
        ${Utils.renderDataTable(['Customer #', 'Name', 'Phone', 'Credit Limit', 'Balance', 'Status', ''], rows, 'No customers found')}
        ${Utils.renderPagination(paginated.page, paginated.pages, 'CustomersPage.goToPage')}
      </div>`;
  },

  afterRender() {
    if (!this.customers && !this.error) this.load();
    document.getElementById('cus-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.setFilter('search', e.target.value.trim());
    });
  },

  goToPage(p) {
    this.page = p;
    Router.refresh();
  },

  openForm(id = null) {
    const c = id ? this.customers.find((x) => x.id === id) : null;
    const canProfile = Auth.can('customers.manage');
    const canCredit = Auth.can('customers.credit.manage');
    const v = (k) => (c?.[k] ? Utils.escapeHtml(c[k]) : '');
    Utils.openModal(c ? `Edit ${Utils.escapeHtml(c.name)}` : 'New Customer', `
      <form id="customer-form">
        <fieldset ${canProfile ? '' : 'disabled'} class="space-y-0">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="form-group sm:col-span-2"><label class="form-label">Name</label><input name="name" class="form-input" required value="${v('name')}"/></div>
            <div class="form-group"><label class="form-label">Type</label><select name="type" class="form-select"><option value="INDIVIDUAL">Individual</option><option value="BUSINESS" ${c?.type === 'BUSINESS' ? 'selected' : ''}>Business / fleet</option></select></div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="form-group"><label class="form-label">Phone</label><input name="phone" class="form-input" value="${v('phone')}"/></div>
            <div class="form-group"><label class="form-label">Email</label><input name="email" type="email" class="form-input" value="${v('email')}"/></div>
          </div>
          <div class="form-group"><label class="form-label">Address</label><input name="address" class="form-input" value="${v('address')}"/></div>
          ${c ? `<div class="form-group"><label class="form-label">Status</label><select name="status" class="form-select"><option value="ACTIVE">Active</option><option value="INACTIVE" ${c.status === 'INACTIVE' ? 'selected' : ''}>Inactive</option></select></div>` : ''}
        </fieldset>
        <div class="p-4 rounded-xl bg-surface-container-low mt-2">
          <p class="font-semibold mb-2">Credit account</p>
          ${canCredit ? `
            <label class="flex items-center gap-2 mb-3"><input type="checkbox" name="creditAllowed" ${c?.creditAllowed ? 'checked' : ''}/> Allow credit (pay later)</label>
            <div class="form-group"><label class="form-label">Credit Limit</label><input name="creditLimit" type="number" step="0.01" min="0" class="form-input" value="${c ? c.creditLimit : 0}"/></div>`
            : `<p class="text-sm text-outline">${c?.creditAllowed ? `Credit limit ${Utils.formatCurrency(c.creditLimit)}.` : 'No credit.'} Only managers and accountants can change credit.</p>`}
        </div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="CustomersPage.save(${c ? `'${c.id}'` : ''})" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>`);
  },

  async save(id) {
    const form = document.getElementById('customer-form');
    const d = Utils.getFormData('customer-form');
    const payload = {};
    if (Auth.can('customers.manage')) Object.assign(payload, { name: d.name, type: d.type, phone: d.phone, email: d.email, address: d.address, ...(d.status ? { status: d.status } : {}) });
    if (Auth.can('customers.credit.manage')) Object.assign(payload, { creditAllowed: form.creditAllowed.checked, creditLimit: d.creditLimit || '0' });
    const ok = id
      ? await Utils.act(() => Api.patch(`/customers/${id}`, payload), 'Customer updated')
      : await Utils.act(() => Api.post('/customers', payload), 'Customer registered');
    if (!ok) return;
    Utils.closeModal();
    this.reload();
  },

  // SECTION: detail — balance, credit, recent invoices, statement and portal access
  async openDetail(id) {
    const [cRes, iRes] = await Promise.all([
      Utils.act(() => Api.get(`/customers/${id}`)),
      Auth.can('invoices.view') ? Utils.act(() => Api.get('/invoices', { customerId: id, pageSize: 10 })) : Promise.resolve({ invoices: [] }),
    ]);
    if (!cRes || !iRes) return;
    const c = cRes.customer;
    Utils.openModal(Utils.escapeHtml(c.name), `
      <div class="space-y-4">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="p-3 rounded-lg bg-surface-container-low"><p class="text-label-sm text-outline">BALANCE</p><p class="font-semibold ${c.outstanding > 0 ? 'text-error' : ''}">${Utils.formatCurrency(c.outstanding)}</p></div>
          <div class="p-3 rounded-lg bg-surface-container-low"><p class="text-label-sm text-outline">CREDIT</p><p class="font-semibold">${c.creditAllowed ? `${Utils.formatCurrency(c.availableCredit)} left` : 'None'}</p></div>
          <div class="p-3 rounded-lg bg-surface-container-low"><p class="text-label-sm text-outline">LIFETIME</p><p class="font-semibold">${Utils.formatCurrency(c.lifetimeSpend)}</p></div>
          <div class="p-3 rounded-lg bg-surface-container-low"><p class="text-label-sm text-outline">PURCHASES</p><p class="font-semibold">${c.transactions}</p></div>
        </div>
        <div class="text-sm space-y-1">
          <p><span class="text-outline">Customer #</span> ${Utils.escapeHtml(c.customerNo)} · ${c.type === 'BUSINESS' ? 'Business' : 'Individual'}</p>
          <p><span class="text-outline">Contact</span> ${Utils.escapeHtml([c.phone, c.email].filter(Boolean).join(' · ') || '—')}</p>
          ${c.address ? `<p><span class="text-outline">Address</span> ${Utils.escapeHtml(c.address)}</p>` : ''}
          <p><span class="text-outline">Portal login</span> ${c.user ? Utils.escapeHtml(c.user.email) : 'None'}</p>
          ${c.vehicles?.length ? `<p><span class="text-outline">Vehicles</span> ${c.vehicles.map((v) => Utils.escapeHtml(v.registrationNumber)).join(', ')}</p>` : ''}
        </div>
        ${iRes.invoices.length ? `<div><p class="text-label-sm text-outline mb-2">RECENT INVOICES</p>
          ${iRes.invoices.map((i) => `<button onclick="InvoicesPage.openInvoice('${i.id}')" class="w-full flex justify-between gap-2 text-sm py-2 border-b border-outline-variant/50 hover:bg-surface-container-low text-left">
            <span class="text-data-mono">${Utils.escapeHtml(i.invoiceNo)} · ${Utils.formatDate(i.issueDate)}</span><span>${Billing.badge(i.status)} <span class="text-data-mono ml-2">${Utils.formatCurrency(i.total)}</span></span></button>`).join('')}</div>` : ''}
        <div id="cus-action"></div>
      </div>`, `
      ${Auth.can('users.manage') && !c.user ? `<button onclick="CustomersPage.showPortalForm('${c.id}')" class="px-3 py-2 border border-outline-variant rounded text-sm">Create Portal Login</button>` : ''}
      <button onclick="CustomersPage.openStatement('${c.id}')" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Statement</button>`);
  },

  // SECTION: statement — pick a period, then print (or save as PDF)
  openStatement(id) {
    const from = new Date();
    from.setDate(from.getDate() - 89);
    const fromStr = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
    Utils.openModal('Customer Statement', `
      <form id="statement-form" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label class="form-label">From</label><input name="from" type="date" class="form-input" value="${fromStr}"/></div>
        <div><label class="form-label">To</label><input name="to" type="date" class="form-input" value="${Utils.today()}"/></div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="CustomersPage.printStatement('${id}')" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Print / PDF</button>`);
  },

  async printStatement(id) {
    const d = Utils.getFormData('statement-form');
    const st = await Utils.act(() => Api.get(`/customers/${id}/statement`, d));
    if (!st) return;
    Utils.closeModal();
    Billing.print(Billing.statementHtml(st));
  },

  showPortalForm(id) {
    document.getElementById('cus-action').innerHTML = `
      <form id="portal-form" class="p-4 rounded-xl bg-surface-container-low" onsubmit="event.preventDefault(); CustomersPage.savePortal('${id}')">
        <p class="font-semibold mb-1">Customer portal login</p>
        <p class="text-xs text-outline mb-3">The customer can sign in to see their invoices, payments, balance and download receipts.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input name="email" type="email" placeholder="Login email" class="form-input" required/>
          <input name="password" type="password" placeholder="Temporary password" class="form-input" required minlength="8" autocomplete="new-password"/>
        </div>
        <button type="submit" class="mt-3 px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Create Login</button>
      </form>`;
  },

  async savePortal(id) {
    const ok = await Utils.act(() => Api.post(`/customers/${id}/portal-access`, Utils.getFormData('portal-form')), 'Portal login created');
    if (!ok) return;
    this.openDetail(id);
  },
};

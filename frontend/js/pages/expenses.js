/**
 * Expenses Page
 */
// SECTION: Expenses page object — record, approve and review station expenses by category
const ExpensesPage = {
  from: Utils.today().slice(0, 8) + '01',
  to: Utils.today(),
  status: '',
  categoryId: '',
  page: 1,
  expenses: null,
  total: 0,
  summary: null,
  categories: null,
  stations: null,
  employees: null,
  error: null,

  onEnter() {
    this.expenses = null;
    this.error = null;
  },

  async load() {
    try {
      const jobs = [Api.get('/expenses', { from: this.from, to: this.to, status: this.status, categoryId: this.categoryId, page: this.page, pageSize: 25 })
        .then((r) => Object.assign(this, { expenses: r.expenses, total: r.total, summary: r.summary }))];
      if (!this.categories) jobs.push(Api.get('/expense-categories').then((r) => { this.categories = r.categories; }));
      await Promise.all(jobs);
      this.error = null;
    } catch (err) {
      this.error = err.message;
    }
    if (Router.currentPage === 'expenses') Router.refresh();
  },

  reload() {
    this.expenses = null;
    this.error = null;
    if (Router.currentPage === 'expenses') Router.refresh();
  },

  setFilter(key, value) {
    this[key] = value;
    this.page = 1;
    this.reload();
  },

  render() {
    const canManage = Auth.can('expenses.manage');
    const header = `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Expenses</h2>
          <p class="text-body-md text-outline mt-1">Operating, staff and maintenance costs. Only approved expenses count in profit.</p>
        </div>
        ${canManage ? `<button onclick="ExpensesPage.openForm()" class="px-4 py-2 bg-secondary text-on-secondary rounded-lg text-body-md font-semibold flex items-center gap-2"><span class="material-symbols-outlined text-lg">add</span> Record Expense</button>` : ''}
      </div>`;
    const filters = `
      <div class="flex flex-wrap gap-3 mb-6 items-center">
        <input type="date" class="form-input w-auto" value="${this.from}" onchange="ExpensesPage.setFilter('from', this.value)" aria-label="From"/>
        <span class="text-outline">to</span>
        <input type="date" class="form-input w-auto" value="${this.to}" onchange="ExpensesPage.setFilter('to', this.value)" aria-label="To"/>
        <select class="form-select w-auto" onchange="ExpensesPage.setFilter('status', this.value)">
          ${[['', 'All statuses'], ['PENDING', 'Awaiting approval'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']].map(([v, l]) => `<option value="${v}" ${this.status === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        ${this.categories ? `<select class="form-select w-auto" onchange="ExpensesPage.setFilter('categoryId', this.value)"><option value="">All categories</option>${this.categories.map((c) => `<option value="${c.id}" ${this.categoryId === c.id ? 'selected' : ''}>${Utils.escapeHtml(c.name)}</option>`).join('')}</select>` : ''}
        <button onclick="ExpensesPage.exportCSV()" class="ml-auto px-4 py-2 border border-outline-variant rounded-lg text-body-md hover:bg-surface-container-low flex items-center gap-2"><span class="material-symbols-outlined text-lg">download</span> CSV</button>
      </div>`;
    if (this.error) return header + filters + Utils.errorState(this.error, 'ExpensesPage.reload()');
    if (!this.expenses) return header + filters + Utils.loadingState('Loading expenses...');

    const session = Auth.getSession();
    const canApprove = Auth.can('expenses.approve');
    const max = Math.max(...this.summary.byCategory.map((c) => c.amount), 1);
    const rows = this.expenses.map((e) => {
      const own = e.recordedBy.id === session.userId && session.role !== 'super_admin';
      return `
      <tr>
        <td class="font-semibold text-data-mono whitespace-nowrap">${Utils.escapeHtml(e.expenseNo)}</td>
        <td class="whitespace-nowrap">${Utils.formatDate(e.expenseDate)}</td>
        <td>${Utils.escapeHtml(e.category.name)}</td>
        <td>${Utils.escapeHtml(e.description)}${e.vendor ? `<div class="text-xs text-outline">${Utils.escapeHtml(e.vendor)}</div>` : ''}${e.employee ? `<div class="text-xs text-outline">Staff: ${Utils.escapeHtml(e.employee.fullName)}</div>` : ''}</td>
        <td>${Billing.method(e.method)}</td>
        <td class="text-data-mono font-semibold">${Utils.formatCurrency(e.amount)}</td>
        <td>${Billing.badge(e.status)}<div class="text-xs text-outline">${Utils.escapeHtml(e.recordedBy.name)}${e.approvedBy && e.status !== 'PENDING' ? ` → ${Utils.escapeHtml(e.approvedBy.name)}` : ''}</div></td>
        <td class="whitespace-nowrap">${e.status === 'PENDING' ? `
          ${canApprove && !own ? `<button onclick="ExpensesPage.decide('${e.id}', 'approve')" class="text-secondary hover:underline text-sm mr-2">Approve</button><button onclick="ExpensesPage.decide('${e.id}', 'reject')" class="text-error hover:underline text-sm mr-2">Reject</button>` : ''}
          ${Auth.can('expenses.manage') && (e.recordedBy.id === session.userId || canApprove) ? `<button onclick="ExpensesPage.openForm('${e.id}')" class="text-primary hover:underline text-sm">Edit</button>` : ''}` : ''}</td>
      </tr>`;
    });
    return header + filters + `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div class="page-section"><span class="text-label-sm text-outline">APPROVED IN PERIOD</span><div class="text-headline-lg font-headline-lg mt-1">${Utils.formatCurrency(this.summary.approved)}</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">AWAITING APPROVAL</span><div class="text-headline-lg font-headline-lg mt-1 ${this.summary.pendingCount ? 'text-tertiary-fixed-dim' : ''}">${Utils.formatCurrency(this.summary.pending)}</div><span class="text-sm text-outline">${this.summary.pendingCount} expense(s)</span></div>
        <div class="page-section"><span class="text-label-sm text-outline">BY CATEGORY</span>
          <div class="space-y-2 mt-2">${this.summary.byCategory.slice(0, 5).map((c) => `
            <div><div class="flex justify-between text-sm"><span>${Utils.escapeHtml(c.category)}</span><span class="text-data-mono">${Utils.formatCurrency(c.amount)}</span></div>
            <div class="h-1.5 bg-surface-container rounded-full"><div class="h-full bg-primary rounded-full" style="width:${(c.amount / max) * 100}%"></div></div></div>`).join('') || '<p class="text-sm text-outline">No approved expenses</p>'}</div></div>
      </div>
      <div class="page-section">
        ${Utils.renderDataTable(['Expense #', 'Date', 'Category', 'Description', 'Paid by', 'Amount', 'Status', ''], rows, 'No expenses in this period')}
        ${Utils.renderPagination(this.page, Math.max(1, Math.ceil(this.total / 25)), 'ExpensesPage.goToPage')}
      </div>`;
  },

  afterRender() {
    if (!this.expenses && !this.error) this.load();
  },

  goToPage(p) {
    this.page = p;
    this.reload();
  },

  async openForm(id = null) {
    const e = id ? this.expenses.find((x) => x.id === id) : null;
    try {
      if (!this.categories) this.categories = (await Api.get('/expense-categories')).categories;
      if (!this.stations && !Auth.getSession().stationId) this.stations = (await Api.get('/stations')).stations;
      if (!this.employees) this.employees = (await Api.get('/employees', { status: 'ACTIVE' }).catch(() => ({ employees: [] }))).employees;
    } catch (err) {
      return Utils.toast(err.message, 'error');
    }
    const v = (k) => (e?.[k] != null ? Utils.escapeHtml(e[k]) : '');
    Utils.openModal(e ? `Edit ${Utils.escapeHtml(e.expenseNo)}` : 'Record Expense', `
      <form id="expense-form">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Category</label><select name="categoryId" class="form-select">${this.categories.map((c) => `<option value="${c.id}" ${e?.category.id === c.id ? 'selected' : ''}>${Utils.escapeHtml(c.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">Amount</label><input name="amount" type="number" step="0.01" min="0.01" class="form-input" required value="${v('amount')}"/></div>
        </div>
        <div class="form-group"><label class="form-label">Description</label><input name="description" class="form-input" required minlength="3" maxlength="500" value="${v('description')}"/></div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-group"><label class="form-label">Date</label><input name="expenseDate" type="date" class="form-input" max="${Utils.today()}" required value="${e ? String(e.expenseDate).slice(0, 10) : Utils.today()}"/></div>
          <div class="form-group"><label class="form-label">Paid by</label><select name="method" class="form-select">${['CASH', 'BANK_TRANSFER', 'ZAAD', 'EDAHAB'].map((m) => `<option value="${m}" ${e?.method === m ? 'selected' : ''}>${Billing.method(m)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">Vendor / Payee</label><input name="vendor" class="form-input" value="${v('vendor')}"/></div>
        </div>
        ${this.employees?.length ? `<div class="form-group"><label class="form-label">Employee (for staff expenses)</label><select name="employeeId" class="form-select"><option value="">—</option>${this.employees.map((m) => `<option value="${m.id}" ${e?.employee?.id === m.id ? 'selected' : ''}>${Utils.escapeHtml(m.fullName)} · ${Utils.escapeHtml(m.position)}</option>`).join('')}</select></div>` : ''}
        ${!e && this.stations ? `<div class="form-group"><label class="form-label">Station</label><select name="stationId" class="form-select">${this.stations.map((s) => `<option value="${s.id}">${Utils.escapeHtml(s.name)}</option>`).join('')}</select></div>` : ''}
        ${!Auth.can('expenses.approve') ? '<p class="text-xs text-outline">This expense will be sent for approval.</p>' : ''}
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button id="expense-save" onclick="ExpensesPage.save(${e ? `'${e.id}'` : ''})" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>`);
  },

  async save(id) {
    const btn = document.getElementById('expense-save');
    if (btn.disabled) return;
    const d = Utils.getFormData('expense-form');
    const body = { ...d, employeeId: d.employeeId || null };
    if (id) delete body.stationId;
    btn.disabled = true;
    const ok = id ? await Utils.act(() => Api.patch(`/expenses/${id}`, body), 'Expense updated') : await Utils.act(() => Api.post('/expenses', body), 'Expense recorded');
    btn.disabled = false;
    if (!ok) return;
    Utils.closeModal();
    this.reload();
  },

  decide(id, decision) {
    const e = this.expenses.find((x) => x.id === id);
    Utils.confirm(`${decision === 'approve' ? 'Approve' : 'Reject'} ${Utils.escapeHtml(e.expenseNo)}: ${Utils.escapeHtml(e.description)} — ${Utils.formatCurrency(e.amount)}?`, async () => {
      const ok = await Utils.act(() => Api.post(`/expenses/${id}/${decision}`), decision === 'approve' ? 'Expense approved' : 'Expense rejected');
      if (ok) this.reload();
    });
  },

  async exportCSV() {
    const res = await Utils.act(() => Api.get('/expenses', { from: this.from, to: this.to, status: this.status, categoryId: this.categoryId, pageSize: 100 }));
    if (!res) return;
    Utils.exportCSV(`expenses-${this.from}-to-${this.to}.csv`, ['Expense #', 'Date', 'Category', 'Description', 'Vendor', 'Method', 'Amount', 'Status', 'Recorded by', 'Station'],
      res.expenses.map((e) => [e.expenseNo, String(e.expenseDate).slice(0, 10), e.category.name, e.description, e.vendor || '', e.method, e.amount, e.status, e.recordedBy.name, e.station.name]));
  },
};

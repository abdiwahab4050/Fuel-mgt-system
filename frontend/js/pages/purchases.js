/**
 * Purchases Page
 */
// SECTION: Purchases page object — purchase orders with filters, KPIs, and CSV export; extend filters or form fields here
const PurchasesPage = {
  searchTerm: '',
  page: 1,
  editingId: null,
  dateFilter: '',

  // SECTION: render — purchase list with summary KPIs, search, date filter, and table; modify KPI cards or columns here
  render() {
    // SECTION: filter and sort purchases — search, date filter, newest first; add supplier or fuel filters here
    let purchases = Store.get('purchases').sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));
    if (this.searchTerm) {
      purchases = purchases.filter((p) =>
        p.purchaseNumber.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        Store.getSupplierName(p.supplierId).toLowerCase().includes(this.searchTerm.toLowerCase())
      );
    }
    if (this.dateFilter) purchases = purchases.filter((p) => p.purchaseDate === this.dateFilter);

    const paginated = Utils.paginate(purchases, this.page, 10);
    // SECTION: KPI calculations — today's purchase total; add weekly/monthly totals here
    const todayTotal = Store.get('purchases').filter((p) => p.purchaseDate === Utils.today()).reduce((s, p) => s + p.totalCost, 0);

    // SECTION: table rows — paginated purchase rows with edit action; add delete or view invoice links here
    const tableRows = paginated.items.map((p) => `
      <tr>
        <td class="font-semibold text-data-mono">${Utils.escapeHtml(p.purchaseNumber)}</td>
        <td>${Utils.escapeHtml(Store.getSupplierName(p.supplierId))}</td>
        <td>${Utils.escapeHtml(Store.getFuelTypeName(p.fuelTypeId))}</td>
        <td class="text-data-mono">${Utils.formatNumber(p.quantity)} L</td>
        <td class="text-data-mono">${Utils.formatCurrency(p.unitCost)}</td>
        <td class="text-data-mono font-semibold">${Utils.formatCurrency(p.totalCost)}</td>
        <td>${Utils.formatDate(p.purchaseDate)}</td>
        <td>${Utils.escapeHtml(p.invoiceNumber || '-')}</td>
        <td>
          <button onclick="PurchasesPage.openEdit('${p.id}')" class="text-secondary hover:underline text-sm mr-2">Edit</button>
        </td>
      </tr>
    `);

    return `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Fuel Purchases</h2>
          <p class="text-body-md text-outline mt-1">Record and manage fuel purchase transactions</p>
        </div>
        <button onclick="PurchasesPage.openAdd()" class="px-4 py-2 bg-secondary text-on-secondary rounded-lg text-body-md font-semibold flex items-center gap-2">
          <span class="material-symbols-outlined text-lg">add</span> New Purchase
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="page-section">
          <span class="text-label-sm text-outline">TODAY'S PURCHASES</span>
          <div class="text-headline-md font-headline-md mt-1">${Utils.formatCurrency(todayTotal)}</div>
        </div>
        <div class="page-section">
          <span class="text-label-sm text-outline">TOTAL ORDERS</span>
          <div class="text-headline-md font-headline-md mt-1">${Store.get('purchases').length}</div>
        </div>
        <div class="page-section">
          <span class="text-label-sm text-outline">ACTIVE SUPPLIERS</span>
          <div class="text-headline-md font-headline-md mt-1">${Store.get('suppliers').length}</div>
        </div>
      </div>

      <div class="flex flex-wrap gap-4 mb-6">
        <div class="relative flex-1 min-w-[200px]">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg">search</span>
          <input id="pur-search" type="text" placeholder="Search purchases..." class="form-input pl-10"/>
        </div>
        <input id="pur-date" type="date" class="form-input w-auto" value="${this.dateFilter}"/>
        <button onclick="PurchasesPage.exportCSV()" class="px-4 py-2 border border-outline-variant rounded-lg text-body-md hover:bg-surface-container-low flex items-center gap-2">
          <span class="material-symbols-outlined text-lg">download</span> Export CSV
        </button>
      </div>

      <div class="page-section">
        ${Utils.renderDataTable(
          ['Purchase #', 'Supplier', 'Fuel Type', 'Qty', 'Unit Cost', 'Total', 'Date', 'Invoice', 'Actions'],
          tableRows
        )}
        ${Utils.renderPagination(paginated.page, paginated.pages, 'PurchasesPage.goToPage')}
      </div>
    `;
  },

  // SECTION: afterRender — binds search and date filter inputs; add debounce or clear-filters button here
  afterRender() {
    document.getElementById('pur-search')?.addEventListener('input', (e) => {
      this.searchTerm = e.target.value;
      this.page = 1;
      Router.refresh();
    });
    document.getElementById('pur-date')?.addEventListener('change', (e) => {
      this.dateFilter = e.target.value;
      this.page = 1;
      Router.refresh();
    });
  },

  // SECTION: goToPage — pagination handler; change page size in render() paginate call
  goToPage(p) { this.page = p; Router.refresh(); },

  // SECTION: openAdd — opens new purchase form; use for create flow
  openAdd() { this.openForm(); },
  // SECTION: openEdit — loads existing purchase into form; adjust inventory rollback on edit here
  openEdit(id) { this.openForm(Store.getById('purchases', id)); },

  // SECTION: openForm — add/edit purchase modal with auto total calc; add tax, delivery, or approval fields here
  openForm(purchase = null) {
    this.editingId = purchase?.id || null;
    const suppliers = Store.get('suppliers');
    const fuelTypes = Store.get('fuelTypes');
    Utils.openModal(purchase ? 'Edit Purchase' : 'Create Purchase', `
      <form id="purchase-form">
        <div class="form-group">
          <label class="form-label">Purchase Number</label>
          <input name="purchaseNumber" class="form-input" readonly value="${purchase ? purchase.purchaseNumber : Store.peekNumber('purchase')}"/>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Supplier</label>
            <select name="supplierId" class="form-select" required>
              ${suppliers.map((s) => `<option value="${s.id}" ${purchase?.supplierId === s.id ? 'selected' : ''}>${Utils.escapeHtml(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Fuel Type</label>
            <select name="fuelTypeId" class="form-select" required id="pur-fuel-type">
              ${fuelTypes.map((ft) => `<option value="${ft.id}" ${purchase?.fuelTypeId === ft.id ? 'selected' : ''}>${Utils.escapeHtml(ft.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Quantity (L)</label>
            <input name="quantity" type="number" class="form-input" required min="1" value="${purchase?.quantity || ''}" id="pur-qty" oninput="PurchasesPage.calcTotal()"/>
          </div>
          <div class="form-group">
            <label class="form-label">Unit Cost</label>
            <input name="unitCost" type="number" step="0.01" class="form-input" required value="${purchase?.unitCost || ''}" id="pur-unit" oninput="PurchasesPage.calcTotal()"/>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Total Cost</label>
          <input name="totalCost" type="number" step="0.01" class="form-input" readonly id="pur-total" value="${purchase?.totalCost || ''}"/>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Purchase Date</label>
            <input name="purchaseDate" type="date" class="form-input" required value="${purchase?.purchaseDate || Utils.today()}"/>
          </div>
          <div class="form-group">
            <label class="form-label">Invoice Number</label>
            <input name="invoiceNumber" class="form-input" value="${purchase ? Utils.escapeHtml(purchase.invoiceNumber || '') : ''}"/>
          </div>
        </div>
      </form>
    `, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="PurchasesPage.save()" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">${purchase ? 'Update' : 'Create'}</button>
    `);
  },

  // SECTION: calcTotal — live qty × unit cost into total field; add discount or tax lines here
  calcTotal() {
    const qty = +document.getElementById('pur-qty')?.value || 0;
    const unit = +document.getElementById('pur-unit')?.value || 0;
    const total = document.getElementById('pur-total');
    if (total) total.value = (qty * unit).toFixed(2);
  },

  // SECTION: save — create/update purchase and sync inventory; adjust rollback logic on edit here
  save() {
    const data = Utils.getFormData('purchase-form');
    data.quantity = +data.quantity;
    data.unitCost = +data.unitCost;
    data.totalCost = +data.totalCost;

    if (this.editingId) {
      const old = Store.getById('purchases', this.editingId);
      Store.updateInventory(old.fuelTypeId, -(old.quantity));
      Store.update('purchases', this.editingId, data);
      Store.updateInventory(data.fuelTypeId, data.quantity, { purchasePrice: data.unitCost });
      Utils.toast('Purchase updated', 'success');
    } else {
      data.purchaseNumber = Store.nextNumber('purchase');
      Store.add('purchases', data);
      Store.updateInventory(data.fuelTypeId, data.quantity, { purchasePrice: data.unitCost, supplierId: data.supplierId });
      const session = Auth.getSession();
      Store.addAuditLog(session.userId, 'Purchase Created', `${Store.getSupplierName(data.supplierId)} - ${Utils.formatCurrency(data.totalCost)}`);
      Store.addNotification('info', 'New Purchase', `${data.purchaseNumber} from ${Store.getSupplierName(data.supplierId)}`);
      Utils.toast('Purchase created', 'success');
    }
    Utils.closeModal();
    Router.refresh();
  },

  // SECTION: exportCSV — downloads all purchases as CSV; apply current filters to export if needed
  exportCSV() {
    const purchases = Store.get('purchases');
    Utils.exportCSV('purchases.csv',
      ['Purchase #', 'Supplier', 'Fuel Type', 'Quantity', 'Unit Cost', 'Total', 'Date', 'Invoice'],
      purchases.map((p) => [
        p.purchaseNumber, Store.getSupplierName(p.supplierId), Store.getFuelTypeName(p.fuelTypeId),
        p.quantity, p.unitCost, p.totalCost, p.purchaseDate, p.invoiceNumber || '',
      ])
    );
  },
};

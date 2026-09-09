/**
 * Sales Page
 */
// SECTION: Sales page object — fuel sales recording, daily KPIs, and export; extend filters or stock rules here
const SalesPage = {
  searchTerm: '',
  page: 1,
  dateFilter: Utils.today(),

  // SECTION: render — sales list with daily revenue KPIs and filters; modify summary metrics or table here
  render() {
    // SECTION: filter and sort sales — search, date filter, newest first; add attendant or fuel filters here
    let sales = Store.get('sales').sort((a, b) => b.date.localeCompare(a.date));
    if (this.searchTerm) {
      sales = sales.filter((s) =>
        s.saleNumber.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        Store.getFuelTypeName(s.fuelTypeId).toLowerCase().includes(this.searchTerm.toLowerCase())
      );
    }
    if (this.dateFilter) sales = sales.filter((s) => s.date === this.dateFilter);

    const paginated = Utils.paginate(sales, this.page, 10);
    // SECTION: daily KPI calculations — revenue, liters, transaction count for selected date; change date scope here
    const dailySales = Store.get('sales').filter((s) => s.date === (this.dateFilter || Utils.today()));
    const dailyTotal = dailySales.reduce((sum, s) => sum + s.totalAmount, 0);
    const dailyQty = dailySales.reduce((sum, s) => sum + s.quantity, 0);

    // SECTION: table rows — paginated sale rows; add void/refund actions or payment method column here
    const tableRows = paginated.items.map((s) => `
      <tr>
        <td class="font-semibold text-data-mono">${Utils.escapeHtml(s.saleNumber)}</td>
        <td>${Utils.escapeHtml(Store.getFuelTypeName(s.fuelTypeId))}</td>
        <td class="text-data-mono">${Utils.formatNumber(s.quantity)} L</td>
        <td class="text-data-mono">${Utils.formatCurrency(s.unitPrice)}</td>
        <td class="text-data-mono font-semibold">${Utils.formatCurrency(s.totalAmount)}</td>
        <td>${Utils.escapeHtml(Store.getUserName(s.attendantId))}</td>
        <td>${Utils.formatDate(s.date)}</td>
      </tr>
    `);

    return `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Fuel Sales</h2>
          <p class="text-body-md text-outline mt-1">Record fuel sales and view daily reports</p>
        </div>
        <button onclick="SalesPage.openAdd()" class="px-4 py-2 bg-secondary text-on-secondary rounded-lg text-body-md font-semibold flex items-center gap-2">
          <span class="material-symbols-outlined text-lg">add</span> New Sale
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="page-section">
          <span class="text-label-sm text-outline">DAILY REVENUE</span>
          <div class="text-headline-md font-headline-md mt-1 text-secondary">${Utils.formatCurrency(dailyTotal)}</div>
        </div>
        <div class="page-section">
          <span class="text-label-sm text-outline">LITERS SOLD</span>
          <div class="text-headline-md font-headline-md mt-1">${Utils.formatNumber(dailyQty)} L</div>
        </div>
        <div class="page-section">
          <span class="text-label-sm text-outline">TRANSACTIONS</span>
          <div class="text-headline-md font-headline-md mt-1">${dailySales.length}</div>
        </div>
      </div>

      <div class="flex flex-wrap gap-4 mb-6">
        <div class="relative flex-1 min-w-[200px]">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg">search</span>
          <input id="sal-search" type="text" placeholder="Search sales..." class="form-input pl-10"/>
        </div>
        <input id="sal-date" type="date" class="form-input w-auto" value="${this.dateFilter}"/>
        <button onclick="SalesPage.exportCSV()" class="px-4 py-2 border border-outline-variant rounded-lg text-body-md hover:bg-surface-container-low flex items-center gap-2">
          <span class="material-symbols-outlined text-lg">download</span> Export CSV
        </button>
      </div>

      <div class="page-section">
        ${Utils.renderDataTable(
          ['Sale #', 'Fuel Type', 'Quantity', 'Unit Price', 'Total', 'Attendant', 'Date'],
          tableRows
        )}
        ${Utils.renderPagination(paginated.page, paginated.pages, 'SalesPage.goToPage')}
      </div>
    `;
  },

  // SECTION: afterRender — binds search and date filter; add default date reset behavior here
  afterRender() {
    document.getElementById('sal-search')?.addEventListener('input', (e) => {
      this.searchTerm = e.target.value;
      this.page = 1;
      Router.refresh();
    });
    document.getElementById('sal-date')?.addEventListener('change', (e) => {
      this.dateFilter = e.target.value;
      this.page = 1;
      Router.refresh();
    });
  },

  // SECTION: goToPage — pagination handler; change page size in render() paginate call
  goToPage(p) { this.page = p; Router.refresh(); },

  // SECTION: openAdd — new sale modal with fuel select and price from inventory; add payment type or customer fields here
  openAdd() {
    const fuelTypes = Store.get('fuelTypes');
    const inventory = Store.get('inventory');
    const session = Auth.getSession();
    Utils.openModal('Record Fuel Sale', `
      <form id="sale-form">
        <div class="form-group">
          <label class="form-label">Sale Number</label>
          <input name="saleNumber" class="form-input" readonly value="${Store.peekNumber('sale')}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Fuel Type</label>
          <select name="fuelTypeId" class="form-select" required id="sal-fuel" onchange="SalesPage.updatePrice()">
            ${fuelTypes.map((ft) => {
              const inv = inventory.find((i) => i.fuelTypeId === ft.id);
              return `<option value="${ft.id}" data-price="${inv?.sellingPrice || 0}">${Utils.escapeHtml(ft.name)} (${inv?.quantity || 0}L available)</option>`;
            }).join('')}
          </select>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Quantity (L)</label>
            <input name="quantity" type="number" class="form-input" required min="1" id="sal-qty" oninput="SalesPage.calcTotal()"/>
          </div>
          <div class="form-group">
            <label class="form-label">Unit Price</label>
            <input name="unitPrice" type="number" step="0.01" class="form-input" required id="sal-unit" oninput="SalesPage.calcTotal()"/>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Total Amount</label>
          <input name="totalAmount" type="number" step="0.01" class="form-input" readonly id="sal-total"/>
        </div>
        <div class="form-group">
          <label class="form-label">Date</label>
          <input name="date" type="date" class="form-input" required value="${Utils.today()}"/>
        </div>
        <input type="hidden" name="attendantId" value="${session.userId}"/>
      </form>
    `, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="SalesPage.save()" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Record Sale</button>
    `);
    setTimeout(() => this.updatePrice(), 100);
  },

  // SECTION: updatePrice — sets unit price from selected fuel inventory selling price; override pricing rules here
  updatePrice() {
    const select = document.getElementById('sal-fuel');
    const unit = document.getElementById('sal-unit');
    if (select && unit) {
      const opt = select.options[select.selectedIndex];
      unit.value = opt.dataset.price || 0;
      this.calcTotal();
    }
  },

  // SECTION: calcTotal — live qty × unit price into total field; add tax or discount here
  calcTotal() {
    const qty = +document.getElementById('sal-qty')?.value || 0;
    const unit = +document.getElementById('sal-unit')?.value || 0;
    const total = document.getElementById('sal-total');
    if (total) total.value = (qty * unit).toFixed(2);
  },

  // SECTION: save — validates stock, records sale, decrements inventory; add receipt print or edit flow here
  save() {
    const data = Utils.getFormData('sale-form');
    data.quantity = +data.quantity;
    data.unitPrice = +data.unitPrice;
    data.totalAmount = +data.totalAmount;

    const inv = Store.getInventoryByFuelType(data.fuelTypeId);
    if (!inv || inv.quantity < data.quantity) {
      return Utils.toast('Insufficient stock', 'error');
    }

    const saleNumber = Store.nextNumber('sale');
    Store.add('sales', { ...data, saleNumber });
    Store.updateInventory(data.fuelTypeId, -data.quantity);
    const session = Auth.getSession();
    Store.addAuditLog(session.userId, 'Sale Recorded', `${saleNumber} - ${Utils.formatCurrency(data.totalAmount)}`);
    Utils.closeModal();
    Utils.toast('Sale recorded successfully', 'success');
    Router.refresh();
  },

  // SECTION: exportCSV — downloads all sales as CSV; filter by dateFilter before export if needed
  exportCSV() {
    const sales = Store.get('sales');
    Utils.exportCSV('sales.csv',
      ['Sale #', 'Fuel Type', 'Quantity', 'Unit Price', 'Total', 'Attendant', 'Date'],
      sales.map((s) => [
        s.saleNumber, Store.getFuelTypeName(s.fuelTypeId), s.quantity,
        s.unitPrice, s.totalAmount, Store.getUserName(s.attendantId), s.date,
      ])
    );
  },
};

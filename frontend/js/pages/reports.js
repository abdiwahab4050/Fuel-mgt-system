/**
 * Reports Page
 */
// SECTION: Reports page object — tabbed analytics with period filters and CSV export; add tabs or report types here
const ReportsPage = {
  activeTab: 'financial',
  dateFrom: '',
  dateTo: '',
  period: 'monthly',

  // SECTION: render — report shell with period controls, tabs, and active tab content; change tab list or layout here
  render() {
    // SECTION: tab definitions — available report categories; add new tab ids and labels here
    const tabs = [
      { id: 'financial', label: 'Financial' },
      { id: 'stock', label: 'Stock' },
      { id: 'purchases', label: 'Purchases' },
      { id: 'sales', label: 'Sales' },
      { id: 'vehicles', label: 'Vehicles' },
      { id: 'consumption', label: 'Consumption' },
      { id: 'audit', label: 'Audit Logs' },
    ];

    return `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Reports & Analytics</h2>
          <p class="text-body-md text-outline mt-1">Generate reports with filters and export options</p>
        </div>
      </div>

      <div class="flex flex-wrap gap-4 mb-6">
        <select id="rep-period" class="form-input w-auto">
          <option value="daily" ${this.period === 'daily' ? 'selected' : ''}>Daily</option>
          <option value="weekly" ${this.period === 'weekly' ? 'selected' : ''}>Weekly</option>
          <option value="monthly" ${this.period === 'monthly' ? 'selected' : ''}>Monthly</option>
          <option value="custom" ${this.period === 'custom' ? 'selected' : ''}>Custom Range</option>
        </select>
        <input id="rep-from" type="date" class="form-input w-auto ${this.period !== 'custom' ? 'hidden' : ''}" value="${this.dateFrom}"/>
        <input id="rep-to" type="date" class="form-input w-auto ${this.period !== 'custom' ? 'hidden' : ''}" value="${this.dateTo}"/>
        <button onclick="ReportsPage.exportCurrent()" class="px-4 py-2 bg-primary text-on-primary rounded-lg flex items-center gap-2">
          <span class="material-symbols-outlined text-lg">download</span> Export CSV
        </button>
      </div>

      <div class="tab-list">
        ${tabs.map((t) => `<button class="tab-btn ${this.activeTab === t.id ? 'active' : ''}" onclick="ReportsPage.switchTab('${t.id}')">${t.label}</button>`).join('')}
      </div>

      <div class="page-section">${this.renderTabContent()}</div>
    `;
  },

  // SECTION: getDateRange — resolves from/to dates from period preset or custom inputs; adjust week/month boundaries here
  getDateRange() {
    const today = new Date();
    let from, to;
    to = Utils.today();

    if (this.period === 'daily') {
      from = to;
    } else if (this.period === 'weekly') {
      const d = new Date(today);
      d.setDate(d.getDate() - 7);
      from = d.toISOString().split('T')[0];
    } else if (this.period === 'monthly') {
      from = to.slice(0, 7) + '-01';
    } else {
      from = this.dateFrom || to.slice(0, 7) + '-01';
      to = this.dateTo || to;
    }
    return { from, to };
  },

  // SECTION: renderTabContent — dispatches to tab-specific render methods; register new cases here
  renderTabContent() {
    const { from, to } = this.getDateRange();

    switch (this.activeTab) {
      case 'financial': return this.renderFinancial(from, to);
      case 'stock': return this.renderStock();
      case 'purchases': return this.renderPurchases(from, to);
      case 'sales': return this.renderSalesReport(from, to);
      case 'vehicles': return this.renderVehicles();
      case 'consumption': return this.renderConsumption(from, to);
      case 'audit': return this.renderAudit();
      default: return '';
    }
  },

  // SECTION: renderFinancial — revenue, expenses, profit, margin for date range; add charts or breakdowns here
  renderFinancial(from, to) {
    const sales = Store.get('sales').filter((s) => s.date >= from && s.date <= to);
    const purchases = Store.get('purchases').filter((p) => p.purchaseDate >= from && p.purchaseDate <= to);
    // SECTION: financial KPI calculations — sum revenue, expenses, profit, margin; change formulas here
    const revenue = sales.reduce((s, p) => s + p.totalAmount, 0);
    const expenses = purchases.reduce((s, p) => s + p.totalCost, 0);
    const profit = revenue - expenses;

    return `
      <h3 class="text-headline-md mb-6">Financial Report (${Utils.formatDate(from)} - ${Utils.formatDate(to)})</h3>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div class="p-4 bg-surface-container-low rounded-lg"><span class="text-label-sm text-outline">REVENUE</span><div class="text-headline-md text-secondary mt-1">${Utils.formatCurrency(revenue)}</div></div>
        <div class="p-4 bg-surface-container-low rounded-lg"><span class="text-label-sm text-outline">EXPENSES</span><div class="text-headline-md mt-1">${Utils.formatCurrency(expenses)}</div></div>
        <div class="p-4 bg-surface-container-low rounded-lg"><span class="text-label-sm text-outline">PROFIT</span><div class="text-headline-md mt-1 ${profit >= 0 ? 'text-secondary' : 'text-error'}">${Utils.formatCurrency(profit)}</div></div>
        <div class="p-4 bg-surface-container-low rounded-lg"><span class="text-label-sm text-outline">MARGIN</span><div class="text-headline-md mt-1">${revenue ? ((profit / revenue) * 100).toFixed(1) : 0}%</div></div>
      </div>
      <h4 class="text-label-sm text-outline mb-4">PROFIT ANALYSIS</h4>
      <p class="text-body-md">Total sales transactions: ${sales.length} | Total purchase orders: ${purchases.length}</p>
    `;
  },

  // SECTION: renderStock — inventory levels and stock value table; add low-stock summary here
  renderStock() {
    const fuelTypes = Store.get('fuelTypes');
    const inventory = Store.get('inventory');
    // SECTION: stock report rows — qty, capacity, status, value per fuel type; change valuation formula here
    const rows = fuelTypes.map((ft) => {
      const inv = inventory.find((i) => i.fuelTypeId === ft.id);
      const qty = inv?.quantity || 0;
      const val = qty * (inv?.purchasePrice || 0);
      const status = Utils.stockStatus(qty, ft.capacity, ft.lowStockThreshold);
      return `<tr>
        <td>${Utils.escapeHtml(ft.name)}</td>
        <td class="text-data-mono">${Utils.formatNumber(qty)} L</td>
        <td class="text-data-mono">${Utils.formatNumber(ft.capacity)} L</td>
        <td>${Utils.badge(status.label, status.type)}</td>
        <td class="text-data-mono">${Utils.formatCurrency(val)}</td>
      </tr>`;
    });
    return `
      <h3 class="text-headline-md mb-6">Stock Report</h3>
      ${Utils.renderDataTable(['Fuel Type', 'Quantity', 'Capacity', 'Status', 'Stock Value'], rows)}
    `;
  },

  // SECTION: renderPurchases — purchase transactions in date range; add supplier grouping here
  renderPurchases(from, to) {
    const purchases = Store.get('purchases').filter((p) => p.purchaseDate >= from && p.purchaseDate <= to);
    const rows = purchases.map((p) => `<tr>
      <td>${p.purchaseNumber}</td><td>${Store.getSupplierName(p.supplierId)}</td>
      <td>${Store.getFuelTypeName(p.fuelTypeId)}</td><td class="text-data-mono">${p.quantity} L</td>
      <td class="text-data-mono">${Utils.formatCurrency(p.totalCost)}</td><td>${Utils.formatDate(p.purchaseDate)}</td>
    </tr>`);
    return `<h3 class="text-headline-md mb-6">Purchase Report</h3>
      ${Utils.renderDataTable(['Purchase #', 'Supplier', 'Fuel', 'Qty', 'Total', 'Date'], rows, 'No purchases in range')}`;
  },

  // SECTION: renderSalesReport — sales transactions in date range; add fuel-type breakdown here
  renderSalesReport(from, to) {
    const sales = Store.get('sales').filter((s) => s.date >= from && s.date <= to);
    const rows = sales.map((s) => `<tr>
      <td>${s.saleNumber}</td><td>${Store.getFuelTypeName(s.fuelTypeId)}</td>
      <td class="text-data-mono">${s.quantity} L</td><td class="text-data-mono">${Utils.formatCurrency(s.totalAmount)}</td>
      <td>${Store.getUserName(s.attendantId)}</td><td>${Utils.formatDate(s.date)}</td>
    </tr>`);
    return `<h3 class="text-headline-md mb-6">Sales Report</h3>
      ${Utils.renderDataTable(['Sale #', 'Fuel', 'Qty', 'Total', 'Attendant', 'Date'], rows, 'No sales in range')}`;
  },

  // SECTION: renderVehicles — fleet usage with total fuel per vehicle; add efficiency column here
  renderVehicles() {
    const vehicles = Store.get('vehicles');
    const rows = vehicles.map((v) => {
      const fuel = Store.get('consumption').filter((c) => c.vehicleId === v.id).reduce((s, c) => s + c.quantity, 0);
      return `<tr>
        <td>${v.registrationNumber}</td><td>${v.name}</td><td>${v.type}</td>
        <td>${v.driver}</td><td>${Utils.badge(v.status === 'active' ? 'Active' : 'Maintenance', v.status === 'active' ? 'success' : 'warning')}</td>
        <td class="text-data-mono">${Utils.formatNumber(fuel)} L</td>
      </tr>`;
    });
    return `<h3 class="text-headline-md mb-6">Vehicle Usage Report</h3>
      ${Utils.renderDataTable(['Registration', 'Name', 'Type', 'Driver', 'Status', 'Total Fuel'], rows)}`;
  },

  // SECTION: renderConsumption — fuel issued to vehicles in date range; add department filter here
  renderConsumption(from, to) {
    const records = Store.get('consumption').filter((c) => c.date >= from && c.date <= to);
    const rows = records.map((c) => `<tr>
      <td>${Store.getVehicleName(c.vehicleId)}</td><td>${c.driver}</td>
      <td>${Store.getFuelTypeName(c.fuelTypeId)}</td><td class="text-data-mono">${c.quantity} L</td>
      <td class="text-data-mono">${c.mileage} L/km</td><td>${Utils.formatDate(c.date)}</td>
    </tr>`);
    return `<h3 class="text-headline-md mb-6">Fuel Consumption Report</h3>
      ${Utils.renderDataTable(['Vehicle', 'Driver', 'Fuel', 'Qty', 'Efficiency', 'Date'], rows, 'No records in range')}`;
  },

  // SECTION: renderAudit — full audit log table newest first; add user or action filters here
  renderAudit() {
    const logs = Store.get('auditLogs').sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const rows = logs.map((l) => `<tr>
      <td>${Utils.formatDateTime(l.timestamp)}</td>
      <td>${Store.getUserName(l.userId)}</td>
      <td>${Utils.escapeHtml(l.action)}</td>
      <td>${Utils.escapeHtml(l.details)}</td>
    </tr>`);
    return `<h3 class="text-headline-md mb-6">Audit Logs</h3>
      ${Utils.renderDataTable(['Timestamp', 'User', 'Action', 'Details'], rows)}`;
  },

  // SECTION: afterRender — binds period and custom date inputs; toggle custom fields visibility here
  afterRender() {
    document.getElementById('rep-period')?.addEventListener('change', (e) => {
      this.period = e.target.value;
      Router.refresh();
    });
    document.getElementById('rep-from')?.addEventListener('change', (e) => { this.dateFrom = e.target.value; Router.refresh(); });
    document.getElementById('rep-to')?.addEventListener('change', (e) => { this.dateTo = e.target.value; Router.refresh(); });
  },

  // SECTION: switchTab — changes active report tab and refreshes; persist tab in URL if needed
  switchTab(tab) {
    this.activeTab = tab;
    Router.refresh();
  },

  // SECTION: exportCurrent — CSV export for financial and stock tabs only; implement exports for other tabs here
  exportCurrent() {
    const { from, to } = this.getDateRange();
    let headers, rows, filename;

    switch (this.activeTab) {
      case 'financial':
        filename = 'financial-report.csv';
        headers = ['Metric', 'Value'];
        const sales = Store.get('sales').filter((s) => s.date >= from && s.date <= to);
        const purchases = Store.get('purchases').filter((p) => p.purchaseDate >= from && p.purchaseDate <= to);
        const rev = sales.reduce((s, p) => s + p.totalAmount, 0);
        const exp = purchases.reduce((s, p) => s + p.totalCost, 0);
        rows = [['Revenue', rev], ['Expenses', exp], ['Profit', rev - exp]];
        break;
      case 'stock':
        filename = 'stock-report.csv';
        headers = ['Fuel Type', 'Quantity', 'Capacity', 'Value'];
        rows = Store.get('fuelTypes').map((ft) => {
          const inv = Store.getInventoryByFuelType(ft.id);
          return [ft.name, inv?.quantity || 0, ft.capacity, (inv?.quantity || 0) * (inv?.purchasePrice || 0)];
        });
        break;
      default:
        Utils.toast('Export for this tab uses CSV from list view', 'info');
        return;
    }
    Utils.exportCSV(filename, headers, rows);
  },
};

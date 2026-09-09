/**
 * Fuel Consumption Page
 */
// SECTION: Consumption page object — vehicle fuel issuance, efficiency tracking, and alerts; extend limits or filters here
const ConsumptionPage = {
  searchTerm: '',
  page: 1,
  dateFrom: '',
  dateTo: '',

  // SECTION: render — consumption records with KPIs, high-use alert, and filters; modify thresholds or columns here
  render() {
    // SECTION: filter and sort records — search, date range, newest first; add vehicle type filter here
    let records = Store.get('consumption').sort((a, b) => b.date.localeCompare(a.date));
    if (this.searchTerm) {
      records = records.filter((c) =>
        Store.getVehicleName(c.vehicleId).toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        c.driver.toLowerCase().includes(this.searchTerm.toLowerCase())
      );
    }
    if (this.dateFrom) records = records.filter((c) => c.date >= this.dateFrom);
    if (this.dateTo) records = records.filter((c) => c.date <= this.dateTo);

    const paginated = Utils.paginate(records, this.page, 10);
    // SECTION: KPI calculations — total issued, average efficiency, record count; change aggregation scope here
    const totalQty = records.reduce((s, c) => s + c.quantity, 0);
    const avgEfficiency = records.length ? (records.reduce((s, c) => s + c.mileage, 0) / records.length).toFixed(1) : 0;

    // SECTION: high consumption alert — vehicles over 150L today; adjust daily limit constant here
    const highConsumption = Store.get('vehicles').filter((v) => {
      const vRecords = Store.get('consumption').filter((c) => c.vehicleId === v.id && c.date === Utils.today());
      return vRecords.reduce((s, c) => s + c.quantity, 0) > 150;
    });

    // SECTION: table rows — paginated consumption records; add edit/delete actions if needed
    const tableRows = paginated.items.map((c) => `
      <tr>
        <td>${Utils.escapeHtml(Store.getVehicleName(c.vehicleId))}</td>
        <td>${Utils.escapeHtml(c.driver)}</td>
        <td>${Utils.escapeHtml(Store.getFuelTypeName(c.fuelTypeId))}</td>
        <td class="text-data-mono">${Utils.formatNumber(c.quantity)} L</td>
        <td class="text-data-mono">${c.mileage} L/km</td>
        <td class="text-data-mono">${Utils.formatNumber(c.odometerReading)}</td>
        <td>${Utils.formatDate(c.date)}</td>
      </tr>
    `);

    return `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Fuel Consumption</h2>
          <p class="text-body-md text-outline mt-1">Track fuel issued to vehicles and monitor efficiency</p>
        </div>
        <button onclick="ConsumptionPage.openAdd()" class="px-4 py-2 bg-secondary text-on-secondary rounded-lg text-body-md font-semibold flex items-center gap-2">
          <span class="material-symbols-outlined text-lg">add</span> Record Usage
        </button>
      </div>

      ${highConsumption.length ? `
        <div class="mb-6 p-4 bg-tertiary-fixed/30 border border-tertiary-fixed-dim rounded-xl flex items-center gap-3">
          <span class="material-symbols-outlined text-tertiary-container">warning</span>
          <div>
            <p class="font-semibold">High Consumption Alert</p>
            <p class="text-sm text-outline">${highConsumption.map((v) => v.name).join(', ')} exceeded daily limit</p>
          </div>
        </div>
      ` : ''}

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="page-section"><span class="text-label-sm text-outline">TOTAL FUEL ISSUED</span><div class="text-headline-md mt-1">${Utils.formatNumber(totalQty)} L</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">AVG EFFICIENCY</span><div class="text-headline-md mt-1">${avgEfficiency} L/km</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">RECORDS</span><div class="text-headline-md mt-1">${records.length}</div></div>
      </div>

      <div class="flex flex-wrap gap-4 mb-6">
        <div class="relative flex-1 min-w-[200px]">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg">search</span>
          <input id="con-search" type="text" placeholder="Search..." class="form-input pl-10"/>
        </div>
        <input id="con-from" type="date" class="form-input w-auto" placeholder="From" value="${this.dateFrom}"/>
        <input id="con-to" type="date" class="form-input w-auto" placeholder="To" value="${this.dateTo}"/>
        <button onclick="ConsumptionPage.exportCSV()" class="px-4 py-2 border border-outline-variant rounded-lg hover:bg-surface-container-low flex items-center gap-2">
          <span class="material-symbols-outlined text-lg">download</span> Export
        </button>
      </div>

      <div class="page-section">
        ${Utils.renderDataTable(
          ['Vehicle', 'Driver', 'Fuel Type', 'Quantity', 'Efficiency', 'Odometer', 'Date'],
          tableRows
        )}
        ${Utils.renderPagination(paginated.page, paginated.pages, 'ConsumptionPage.goToPage')}
      </div>
    `;
  },

  // SECTION: afterRender — binds search and date range filters; add preset ranges here
  afterRender() {
    document.getElementById('con-search')?.addEventListener('input', (e) => { this.searchTerm = e.target.value; this.page = 1; Router.refresh(); });
    document.getElementById('con-from')?.addEventListener('change', (e) => { this.dateFrom = e.target.value; this.page = 1; Router.refresh(); });
    document.getElementById('con-to')?.addEventListener('change', (e) => { this.dateTo = e.target.value; this.page = 1; Router.refresh(); });
  },

  // SECTION: goToPage — pagination handler; change page size in render() paginate call
  goToPage(p) { this.page = p; Router.refresh(); },

  // SECTION: openAdd — modal to record fuel issued to active vehicle; add trip purpose or approval fields here
  openAdd() {
    const vehicles = Store.get('vehicles').filter((v) => v.status === 'active');
    const fuelTypes = Store.get('fuelTypes');
    Utils.openModal('Record Fuel Usage', `
      <form id="consumption-form">
        <div class="form-group">
          <label class="form-label">Vehicle</label>
          <select name="vehicleId" class="form-select" required id="con-vehicle" onchange="ConsumptionPage.fillDriver()">
            ${vehicles.map((v) => `<option value="${v.id}" data-driver="${Utils.escapeHtml(v.driver)}">${Utils.escapeHtml(v.name)} (${v.registrationNumber})</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Driver</label>
          <input name="driver" class="form-input" required id="con-driver"/>
        </div>
        <div class="form-group">
          <label class="form-label">Fuel Type</label>
          <select name="fuelTypeId" class="form-select" required>
            ${fuelTypes.map((ft) => `<option value="${ft.id}">${Utils.escapeHtml(ft.name)}</option>`).join('')}
          </select>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Quantity (L)</label>
            <input name="quantity" type="number" class="form-input" required min="1"/>
          </div>
          <div class="form-group">
            <label class="form-label">Efficiency (L/km)</label>
            <input name="mileage" type="number" step="0.1" class="form-input" required/>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Odometer Reading</label>
            <input name="odometerReading" type="number" class="form-input" required/>
          </div>
          <div class="form-group">
            <label class="form-label">Date</label>
            <input name="date" type="date" class="form-input" required value="${Utils.today()}"/>
          </div>
        </div>
      </form>
    `, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="ConsumptionPage.save()" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Record</button>
    `);
    setTimeout(() => this.fillDriver(), 100);
  },

  // SECTION: fillDriver — auto-fills driver from selected vehicle option; override with manual entry rules here
  fillDriver() {
    const select = document.getElementById('con-vehicle');
    const driver = document.getElementById('con-driver');
    if (select && driver) {
      driver.value = select.options[select.selectedIndex]?.dataset.driver || '';
    }
  },

  // SECTION: save — validates stock, records consumption, decrements inventory; adjust alert threshold here
  save() {
    const data = Utils.getFormData('consumption-form');
    data.quantity = +data.quantity;
    data.mileage = +data.mileage;
    data.odometerReading = +data.odometerReading;

    const inv = Store.getInventoryByFuelType(data.fuelTypeId);
    if (!inv || inv.quantity < data.quantity) {
      return Utils.toast('Insufficient fuel stock', 'error');
    }

    Store.add('consumption', data);
    Store.updateInventory(data.fuelTypeId, -data.quantity);

    if (data.quantity > 150) {
      Store.addNotification('danger', 'High Consumption', `${Store.getVehicleName(data.vehicleId)} used ${data.quantity}L today`);
    }

    const session = Auth.getSession();
    Store.addAuditLog(session.userId, 'Fuel Issued', `${data.quantity}L to ${Store.getVehicleName(data.vehicleId)}`);
    Utils.closeModal();
    Utils.toast('Fuel usage recorded', 'success');
    Router.refresh();
  },

  // SECTION: exportCSV — downloads all consumption records; apply date filters before export if needed
  exportCSV() {
    const records = Store.get('consumption');
    Utils.exportCSV('consumption.csv',
      ['Vehicle', 'Driver', 'Fuel Type', 'Quantity', 'Efficiency', 'Odometer', 'Date'],
      records.map((c) => [
        Store.getVehicleName(c.vehicleId), c.driver, Store.getFuelTypeName(c.fuelTypeId),
        c.quantity, c.mileage, c.odometerReading, c.date,
      ])
    );
  },
};

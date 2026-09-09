/**
 * Vehicles Page
 */
// SECTION: Vehicles page object — fleet registry, status KPIs, and fuel history; extend vehicle fields or filters here
const VehiclesPage = {
  searchTerm: '',
  page: 1,
  editingId: null,
  selectedVehicle: null,

  // SECTION: render — vehicle table with fleet summary KPIs; modify columns or status badges here
  render() {
    // SECTION: filter vehicles — search by name, registration, or driver; add department or type filters here
    let vehicles = Store.get('vehicles');
    if (this.searchTerm) {
      vehicles = vehicles.filter((v) =>
        v.name.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        v.registrationNumber.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        v.driver.toLowerCase().includes(this.searchTerm.toLowerCase())
      );
    }
    const paginated = Utils.paginate(vehicles, this.page, 10);
    // SECTION: fleet KPI — count active vehicles for summary cards; add maintenance due counts here
    const active = vehicles.filter((v) => v.status === 'active').length;

    // SECTION: table rows — vehicle rows with total fuel from consumption history; add last-service date here
    const tableRows = paginated.items.map((v) => {
      const history = Store.get('consumption').filter((c) => c.vehicleId === v.id);
      const totalFuel = history.reduce((s, c) => s + c.quantity, 0);
      return `
        <tr>
          <td class="font-semibold text-data-mono">${Utils.escapeHtml(v.registrationNumber)}</td>
          <td>${Utils.escapeHtml(v.name)}</td>
          <td>${Utils.escapeHtml(v.type)}</td>
          <td>${Utils.escapeHtml(v.driver)}</td>
          <td>${Utils.escapeHtml(v.department)}</td>
          <td>${Utils.badge(v.status === 'active' ? 'Active' : 'Maintenance', v.status === 'active' ? 'success' : 'warning')}</td>
          <td class="text-data-mono">${Utils.formatNumber(totalFuel)} L</td>
          <td>
            <button onclick="VehiclesPage.openEdit('${v.id}')" class="text-secondary hover:underline text-sm mr-2">Edit</button>
            <button onclick="VehiclesPage.viewHistory('${v.id}')" class="text-primary hover:underline text-sm">History</button>
          </td>
        </tr>`;
    });

    return `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Vehicle Management</h2>
          <p class="text-body-md text-outline mt-1">Register vehicles and monitor fuel history</p>
        </div>
        <button onclick="VehiclesPage.openAdd()" class="px-4 py-2 bg-primary text-on-primary rounded-lg text-body-md font-semibold flex items-center gap-2">
          <span class="material-symbols-outlined text-lg">add</span> Register Vehicle
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="page-section"><span class="text-label-sm text-outline">TOTAL VEHICLES</span><div class="text-headline-md mt-1">${vehicles.length}</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">ACTIVE</span><div class="text-headline-md mt-1 text-secondary">${active}</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">IN MAINTENANCE</span><div class="text-headline-md mt-1">${vehicles.length - active}</div></div>
      </div>

      ${Utils.renderSearchFilter('Search vehicles...', 'veh-search')}
      <div class="page-section">
        ${Utils.renderDataTable(
          ['Registration', 'Name', 'Type', 'Driver', 'Department', 'Status', 'Total Fuel', 'Actions'],
          tableRows
        )}
        ${Utils.renderPagination(paginated.page, paginated.pages, 'VehiclesPage.goToPage')}
      </div>
    `;
  },

  // SECTION: afterRender — binds vehicle search input; add status filter dropdown here
  afterRender() {
    document.getElementById('veh-search')?.addEventListener('input', (e) => {
      this.searchTerm = e.target.value;
      this.page = 1;
      Router.refresh();
    });
  },

  // SECTION: goToPage — pagination handler; change page size in render() paginate call
  goToPage(p) { this.page = p; Router.refresh(); },

  // SECTION: openAdd — opens empty vehicle registration form
  openAdd() { this.openForm(); },
  // SECTION: openEdit — loads vehicle by id into form
  openEdit(id) { this.openForm(Store.getById('vehicles', id)); },

  // SECTION: openForm — add/edit vehicle modal with type and status; add VIN, capacity, or photo fields here
  openForm(vehicle = null) {
    this.editingId = vehicle?.id || null;
    Utils.openModal(vehicle ? 'Update Vehicle' : 'Register Vehicle', `
      <form id="vehicle-form">
        <div class="grid grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Registration Number</label>
            <input name="registrationNumber" class="form-input" required value="${vehicle ? Utils.escapeHtml(vehicle.registrationNumber) : ''}"/>
          </div>
          <div class="form-group">
            <label class="form-label">Vehicle Name</label>
            <input name="name" class="form-input" required value="${vehicle ? Utils.escapeHtml(vehicle.name) : ''}"/>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Vehicle Type</label>
            <select name="type" class="form-select">
              ${['Heavy Duty', 'Mid Range', 'Sprinter', 'EV Fleet', 'Other'].map((t) =>
                `<option ${vehicle?.type === t ? 'selected' : ''}>${t}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <select name="status" class="form-select">
              <option value="active" ${vehicle?.status === 'active' ? 'selected' : ''}>Active</option>
              <option value="maintenance" ${vehicle?.status === 'maintenance' ? 'selected' : ''}>Maintenance</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Driver</label>
            <input name="driver" class="form-input" required value="${vehicle ? Utils.escapeHtml(vehicle.driver) : ''}"/>
          </div>
          <div class="form-group">
            <label class="form-label">Department</label>
            <input name="department" class="form-input" required value="${vehicle ? Utils.escapeHtml(vehicle.department) : ''}"/>
          </div>
        </div>
      </form>
    `, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="VehiclesPage.save()" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>
    `);
  },

  // SECTION: save — creates or updates vehicle record; add duplicate registration check here
  save() {
    const data = Utils.getFormData('vehicle-form');
    if (this.editingId) {
      Store.update('vehicles', this.editingId, data);
      Utils.toast('Vehicle updated', 'success');
    } else {
      Store.add('vehicles', data);
      Utils.toast('Vehicle registered', 'success');
    }
    Utils.closeModal();
    Router.refresh();
  },

  // SECTION: viewHistory — modal showing consumption history for one vehicle; add export or chart here
  viewHistory(vehicleId) {
    const vehicle = Store.getById('vehicles', vehicleId);
    // SECTION: history table rows — maps consumption records for vehicle; add sorting or date filter here
    const history = Store.get('consumption').filter((c) => c.vehicleId === vehicleId);
    const rows = history.map((c) => `
      <tr>
        <td>${Utils.formatDate(c.date)}</td>
        <td>${Utils.escapeHtml(Store.getFuelTypeName(c.fuelTypeId))}</td>
        <td class="text-data-mono">${c.quantity} L</td>
        <td class="text-data-mono">${c.mileage} L/km</td>
        <td class="text-data-mono">${Utils.formatNumber(c.odometerReading)}</td>
        <td>${Utils.escapeHtml(c.driver)}</td>
      </tr>
    `).join('') || '<tr><td colspan="6" class="text-center py-8 text-outline">No fuel history</td></tr>';

    Utils.openModal(`Fuel History - ${vehicle.name}`, `
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Fuel Type</th><th>Quantity</th><th>Efficiency</th><th>Odometer</th><th>Driver</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `);
  },
};

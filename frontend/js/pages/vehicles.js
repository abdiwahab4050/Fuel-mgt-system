/**
 * Vehicles Page (Fleet)
 */
// SECTION: Vehicles page object — fleet register, status, fuel totals and efficiency; data from /api/vehicles
const VehiclesPage = {
  search: '',
  status: '',
  page: 1,
  vehicles: null,
  customers: null,
  error: null,

  onEnter() {
    this.vehicles = null;
    this.error = null;
  },

  async load() {
    try {
      this.vehicles = (await Api.get('/vehicles', { search: this.search, status: this.status })).vehicles;
      this.error = null;
    } catch (err) {
      this.error = err.message;
    }
    if (Router.currentPage === 'vehicles') Router.refresh();
  },

  reload() {
    this.vehicles = null;
    this.error = null;
    if (Router.currentPage === 'vehicles') Router.refresh();
  },

  render() {
    const canManage = Auth.can('fleet.manage');
    const header = `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Fleet Management</h2>
          <p class="text-body-md text-outline mt-1">Vehicles, drivers, fuel use and efficiency</p>
        </div>
        ${canManage ? `<button onclick="VehiclesPage.openForm()" class="px-4 py-2 bg-secondary text-on-secondary rounded-lg text-body-md font-semibold flex items-center gap-2"><span class="material-symbols-outlined text-lg">add</span> Register Vehicle</button>` : ''}
      </div>
      <div class="flex flex-wrap gap-3 mb-6">
        <div class="relative flex-1 min-w-[200px]"><span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg">search</span>
          <input id="veh-search" type="search" placeholder="Registration, name or driver then Enter" class="form-input pl-10" value="${Utils.escapeHtml(this.search)}"/></div>
        <select class="form-select w-auto" onchange="VehiclesPage.status = this.value; VehiclesPage.page = 1; VehiclesPage.reload()">
          ${[['', 'All statuses'], ['ACTIVE', 'Active'], ['MAINTENANCE', 'In maintenance'], ['OUT_OF_SERVICE', 'Out of service']].map(([v, l]) => `<option value="${v}" ${this.status === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>`;
    if (this.error) return header + Utils.errorState(this.error, 'VehiclesPage.reload()');
    if (!this.vehicles) return header + Utils.loadingState('Loading fleet...');

    const statusBadge = { ACTIVE: ['Active', 'success'], MAINTENANCE: ['Maintenance', 'warning'], OUT_OF_SERVICE: ['Out of service', 'neutral'] };
    const paginated = Utils.paginate(this.vehicles, this.page, 15);
    const rows = paginated.items.map((v) => {
      const [label, type] = statusBadge[v.status] || [v.status, 'neutral'];
      return `
      <tr>
        <td class="font-semibold text-data-mono">${Utils.escapeHtml(v.registrationNumber)}</td>
        <td>${Utils.escapeHtml(v.name)}<div class="text-xs text-outline">${Utils.escapeHtml(v.type)}${v.department ? ` · ${Utils.escapeHtml(v.department)}` : ''}</div></td>
        <td>${Utils.escapeHtml(v.driver || '—')}</td>
        <td>${v.customer ? Utils.escapeHtml(v.customer.name) : '<span class="text-outline">Own fleet</span>'}</td>
        <td class="text-data-mono">${Utils.formatNumber(v.totalLiters, 1)} L<div class="text-xs text-outline">${v.fills} fill(s)</div></td>
        <td class="text-data-mono">${v.avgEfficiency != null ? `${Number(v.avgEfficiency).toFixed(2)} km/L` : '—'}</td>
        <td class="whitespace-nowrap">${v.lastFill ? Utils.formatDate(v.lastFill) : '—'}${v.lastOdometer ? `<div class="text-xs text-outline">${Utils.formatNumber(v.lastOdometer)} km</div>` : ''}</td>
        <td>${Utils.badge(label, type)}</td>
        <td class="whitespace-nowrap">
          <button onclick="VehiclesPage.viewHistory('${v.id}')" class="text-secondary hover:underline text-sm mr-2">History</button>
          ${canManage ? `<button onclick="VehiclesPage.openForm('${v.id}')" class="text-primary hover:underline text-sm">Edit</button>` : ''}
        </td>
      </tr>`;
    });
    const active = this.vehicles.filter((v) => v.status === 'ACTIVE').length;
    return header + `
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div class="page-section"><span class="text-label-sm text-outline">VEHICLES</span><div class="text-headline-md font-headline-md mt-1">${this.vehicles.length}</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">ACTIVE</span><div class="text-headline-md font-headline-md mt-1 text-secondary">${active}</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">IN MAINTENANCE</span><div class="text-headline-md font-headline-md mt-1">${this.vehicles.filter((v) => v.status === 'MAINTENANCE').length}</div></div>
      </div>
      <div class="page-section">
        ${Utils.renderDataTable(['Registration', 'Vehicle', 'Driver', 'Owner', 'Fuel Used', 'Efficiency', 'Last Fill', 'Status', ''], rows, 'No vehicles')}
        ${Utils.renderPagination(paginated.page, paginated.pages, 'VehiclesPage.goToPage')}
      </div>`;
  },

  afterRender() {
    if (!this.vehicles && !this.error) this.load();
    document.getElementById('veh-search')?.addEventListener('keydown', (e) => {
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

  async openForm(id = null) {
    const v = id ? this.vehicles.find((x) => x.id === id) : null;
    if (!this.customers) {
      this.customers = Auth.can('customers.view') ? (await Api.get('/customers', { status: 'ACTIVE' }).catch(() => ({ customers: [] }))).customers.filter((c) => c.type === 'BUSINESS') : [];
    }
    const val = (k) => (v?.[k] ? Utils.escapeHtml(v[k]) : '');
    Utils.openModal(v ? `Edit ${Utils.escapeHtml(v.registrationNumber)}` : 'Register Vehicle', `
      <form id="vehicle-form">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Registration</label><input name="registrationNumber" class="form-input uppercase" required value="${val('registrationNumber')}"/></div>
          <div class="form-group"><label class="form-label">Name</label><input name="name" class="form-input" required value="${val('name')}" placeholder="Delivery Truck #12"/></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-group"><label class="form-label">Type</label><input name="type" class="form-input" required list="veh-types" value="${val('type')}"/>
            <datalist id="veh-types"><option>Heavy Duty</option><option>Mid Range</option><option>Sprinter</option><option>Pickup</option><option>Car</option><option>Motorcycle</option></datalist></div>
          <div class="form-group"><label class="form-label">Driver</label><input name="driver" class="form-input" value="${val('driver')}"/></div>
          <div class="form-group"><label class="form-label">Department</label><input name="department" class="form-input" value="${val('department')}"/></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Status</label><select name="status" class="form-select">${[['ACTIVE', 'Active'], ['MAINTENANCE', 'In maintenance'], ['OUT_OF_SERVICE', 'Out of service']].map(([s, l]) => `<option value="${s}" ${v?.status === s ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">Owner (fleet customer)</label><select name="customerId" class="form-select"><option value="">Own fleet</option>${this.customers.map((c) => `<option value="${c.id}" ${v?.customerId === c.id ? 'selected' : ''}>${Utils.escapeHtml(c.name)}</option>`).join('')}</select></div>
        </div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="VehiclesPage.save(${v ? `'${v.id}'` : ''})" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>`);
  },

  async save(id) {
    const d = Utils.getFormData('vehicle-form');
    const body = { ...d, customerId: d.customerId || null };
    const ok = id ? await Utils.act(() => Api.patch(`/vehicles/${id}`, body), 'Vehicle updated') : await Utils.act(() => Api.post('/vehicles', body), 'Vehicle registered');
    if (!ok) return;
    Utils.closeModal();
    this.reload();
  },

  async viewHistory(id) {
    const v = this.vehicles.find((x) => x.id === id);
    const res = await Utils.act(() => Api.get('/consumption', { vehicleId: id }));
    if (!res) return;
    Utils.openModal(`Fuel History — ${Utils.escapeHtml(v.registrationNumber)}`, `
      <p class="text-sm text-outline mb-3">${Utils.escapeHtml(v.name)} · ${Utils.formatNumber(res.summary.liters, 1)} L over ${res.summary.records} fill(s)${res.summary.avgEfficiency != null ? ` · avg ${Number(res.summary.avgEfficiency).toFixed(2)} km/L` : ''}</p>
      ${Utils.renderDataTable(['Date', 'Fuel', 'Liters', 'Odometer', 'km/L', 'Driver'], res.records.map((c) => `
        <tr><td>${Utils.formatDate(c.date)}</td><td>${Utils.escapeHtml(c.product.name)}</td><td class="text-data-mono">${Utils.formatNumber(c.quantity, 1)} L</td>
        <td class="text-data-mono">${c.odometerReading != null ? Utils.formatNumber(c.odometerReading) : '—'}</td><td class="text-data-mono">${c.mileage != null ? Number(c.mileage).toFixed(2) : '—'}</td><td>${Utils.escapeHtml(c.driver || '')}</td></tr>`), 'No fuel records')}`);
  },
};

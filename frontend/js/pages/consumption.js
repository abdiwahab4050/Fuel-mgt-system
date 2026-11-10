/**
 * Consumption Page
 */
// SECTION: Consumption page object — fuel put into fleet vehicles, efficiency, high-use alert; data from /api/consumption
const ConsumptionPage = {
  from: Utils.today().slice(0, 8) + '01',
  to: Utils.today(),
  vehicleId: '',
  page: 1,
  data: null,
  vehicles: null,
  products: null,
  error: null,

  onEnter() {
    this.data = null;
    this.error = null;
  },

  async load() {
    try {
      const jobs = [Api.get('/consumption', { from: this.from, to: this.to, vehicleId: this.vehicleId }).then((r) => { this.data = r; })];
      if (!this.vehicles) jobs.push(Api.get('/vehicles').then((r) => { this.vehicles = r.vehicles; }));
      await Promise.all(jobs);
      this.error = null;
    } catch (err) {
      this.error = err.message;
    }
    if (Router.currentPage === 'consumption') Router.refresh();
  },

  reload() {
    this.data = null;
    this.error = null;
    if (Router.currentPage === 'consumption') Router.refresh();
  },

  setFilter(key, value) {
    this[key] = value;
    this.page = 1;
    this.reload();
  },

  render() {
    const header = `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Fuel Consumption</h2>
          <p class="text-body-md text-outline mt-1">Fuel put into fleet vehicles and how far it goes</p>
        </div>
        ${Auth.can('consumption.record') ? `<button onclick="ConsumptionPage.openAdd()" class="px-4 py-2 bg-secondary text-on-secondary rounded-lg text-body-md font-semibold flex items-center gap-2"><span class="material-symbols-outlined text-lg">add</span> Record Fill</button>` : ''}
      </div>
      <div class="flex flex-wrap gap-3 mb-6 items-center">
        <input type="date" class="form-input w-auto" value="${this.from}" onchange="ConsumptionPage.setFilter('from', this.value)" aria-label="From"/>
        <span class="text-outline">to</span>
        <input type="date" class="form-input w-auto" value="${this.to}" onchange="ConsumptionPage.setFilter('to', this.value)" aria-label="To"/>
        ${this.vehicles ? `<select class="form-select w-auto" onchange="ConsumptionPage.setFilter('vehicleId', this.value)"><option value="">All vehicles</option>${this.vehicles.map((v) => `<option value="${v.id}" ${this.vehicleId === v.id ? 'selected' : ''}>${Utils.escapeHtml(v.registrationNumber)} — ${Utils.escapeHtml(v.name)}</option>`).join('')}</select>` : ''}
      </div>`;
    if (this.error) return header + Utils.errorState(this.error, 'ConsumptionPage.reload()');
    if (!this.data) return header + Utils.loadingState('Loading records...');

    const d = this.data;
    const paginated = Utils.paginate(d.records, this.page, 20);
    const rows = paginated.items.map((c) => `
      <tr>
        <td class="whitespace-nowrap">${Utils.formatDate(c.date)}</td>
        <td><span class="font-semibold text-data-mono">${Utils.escapeHtml(c.vehicle.registrationNumber)}</span><div class="text-xs text-outline">${Utils.escapeHtml(c.vehicle.name)}</div></td>
        <td>${Utils.escapeHtml(c.driver || '—')}</td>
        <td>${Utils.escapeHtml(c.product.name)}</td>
        <td class="text-data-mono font-semibold">${Utils.formatNumber(c.quantity, 1)} L</td>
        <td class="text-data-mono">${c.odometerReading != null ? `${Utils.formatNumber(c.odometerReading)} km` : '—'}</td>
        <td class="text-data-mono">${c.mileage != null ? `${Number(c.mileage).toFixed(2)} km/L` : '—'}</td>
        <td>${Utils.escapeHtml(c.recordedBy.name)}</td>
      </tr>`);
    return header + `
      ${d.highUseToday.length ? `
        <div class="p-4 rounded-xl border border-error/30 bg-error-container/40 mb-6 flex gap-3">
          <span class="material-symbols-outlined text-error">local_fire_department</span>
          <div><p class="font-semibold">High fuel use today (over ${d.highUseThreshold} L)</p>
          <p class="text-sm text-outline">${d.highUseToday.map((h) => `${Utils.escapeHtml(h.registrationNumber)} ${Utils.escapeHtml(h.name)}: ${Utils.formatNumber(h.liters, 1)} L`).join(' · ')}</p></div>
        </div>` : ''}
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div class="page-section"><span class="text-label-sm text-outline">FUEL USED</span><div class="text-headline-md font-headline-md mt-1">${Utils.formatNumber(d.summary.liters, 1)} L</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">AVERAGE EFFICIENCY</span><div class="text-headline-md font-headline-md mt-1">${d.summary.avgEfficiency != null ? `${Number(d.summary.avgEfficiency).toFixed(2)} km/L` : '—'}</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">FILLS</span><div class="text-headline-md font-headline-md mt-1">${d.summary.records}</div></div>
      </div>
      <div class="page-section">
        <p class="text-sm text-outline mb-4">These records track vehicle fuel use. Fuel taken from the station's tanks should also be recorded as a sale (for example on the fleet customer's credit account) so stock and billing stay correct.</p>
        ${Utils.renderDataTable(['Date', 'Vehicle', 'Driver', 'Fuel', 'Liters', 'Odometer', 'Efficiency', 'Recorded by'], rows, 'No consumption records in this period')}
        ${Utils.renderPagination(paginated.page, paginated.pages, 'ConsumptionPage.goToPage')}
      </div>`;
  },

  afterRender() {
    if (!this.data && !this.error) this.load();
  },

  goToPage(p) {
    this.page = p;
    Router.refresh();
  },

  async openAdd() {
    try {
      if (!this.vehicles) this.vehicles = (await Api.get('/vehicles')).vehicles;
      if (!this.products) this.products = (await Api.get('/products')).products;
    } catch (err) {
      return Utils.toast(err.message, 'error');
    }
    const usable = this.vehicles.filter((v) => v.status !== 'OUT_OF_SERVICE');
    if (!usable.length) return Utils.toast('Register a vehicle first', 'error');
    Utils.openModal('Record Vehicle Fill', `
      <form id="consumption-form">
        <div class="form-group"><label class="form-label">Vehicle</label>
          <select name="vehicleId" class="form-select" onchange="ConsumptionPage.fillDriver(this)">
            ${usable.map((v) => `<option value="${v.id}" data-driver="${Utils.escapeHtml(v.driver || '')}" data-odo="${v.lastOdometer ?? ''}">${Utils.escapeHtml(v.registrationNumber)} — ${Utils.escapeHtml(v.name)}</option>`).join('')}
          </select></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Fuel</label><select name="productId" class="form-select">${this.products.map((p) => `<option value="${p.id}">${Utils.escapeHtml(p.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">Liters</label><input name="quantity" type="number" step="0.001" min="0.001" class="form-input" required/></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-group"><label class="form-label">Odometer (km)</label><input name="odometerReading" type="number" step="0.1" min="0" class="form-input" id="cons-odo"/><p class="text-xs text-outline mt-1" id="cons-odo-hint"></p></div>
          <div class="form-group"><label class="form-label">Driver</label><input name="driver" class="form-input" id="cons-driver"/></div>
          <div class="form-group"><label class="form-label">Date</label><input name="date" type="date" class="form-input" max="${Utils.today()}" value="${Utils.today()}"/></div>
        </div>
        <p class="text-xs text-outline">With an odometer reading, efficiency (km/L) is calculated from the previous fill.</p>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button id="cons-save" onclick="ConsumptionPage.save()" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Save</button>`);
    this.fillDriver(document.querySelector('#consumption-form [name="vehicleId"]'));
  },

  // SECTION: fillDriver — prefill the vehicle's regular driver and show the last odometer reading
  fillDriver(select) {
    const opt = select?.selectedOptions[0];
    if (!opt) return;
    document.getElementById('cons-driver').value = opt.dataset.driver || '';
    const odo = opt.dataset.odo;
    document.getElementById('cons-odo').min = odo || 0;
    document.getElementById('cons-odo-hint').textContent = odo ? `Last reading ${Utils.formatNumber(odo)} km` : 'No previous reading';
  },

  async save() {
    const btn = document.getElementById('cons-save');
    if (btn.disabled) return;
    const d = Utils.getFormData('consumption-form');
    const body = { ...d, odometerReading: d.odometerReading || null };
    btn.disabled = true;
    const ok = await Utils.act(() => Api.post('/consumption', body), 'Fill recorded');
    btn.disabled = false;
    if (!ok) return;
    Utils.closeModal();
    this.vehicles = null;
    if (typeof VehiclesPage !== 'undefined') VehiclesPage.vehicles = null;
    this.reload();
  },
};

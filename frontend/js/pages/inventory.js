/**
 * Inventory Page
 */
// SECTION: Inventory page object — tanks, products, stock ledger, adjustments, daily dips; data from the API
const InventoryPage = {
  tab: 'tanks',
  // SECTION: API caches; null = not loaded (reset on every visit via onEnter)
  tanks: null,
  products: null,
  stations: [],
  movements: null,
  movementsPage: 1,
  movementsTotal: 0,
  movementTank: '',
  adjustments: null,
  dips: null,
  dipDate: Utils.today(),
  error: null,

  TABS: [
    ['tanks', 'Tanks & Stock'],
    ['products', 'Fuel Products'],
    ['movements', 'Stock Movements'],
    ['adjustments', 'Adjustments'],
    ['dips', 'Daily Dips'],
  ],

  onEnter() {
    this.tanks = null;
    this.products = null;
    this.movements = null;
    this.adjustments = null;
    this.dips = null;
    this.error = null;
  },

  // SECTION: load — tanks + products always (forms need them), plus the active tab's data
  async load() {
    try {
      const jobs = [];
      if (!this.tanks) jobs.push(Api.get('/tanks').then((r) => { this.tanks = r.tanks; }));
      if (!this.products) jobs.push(Api.get('/products', { all: 'true' }).then((r) => { this.products = r.products; }));
      if (!this.stations.length) jobs.push(Api.get('/stations').then((r) => { this.stations = r.stations; }));
      if (this.tab === 'movements' && !this.movements) {
        jobs.push(Api.get('/stock-movements', { page: this.movementsPage, pageSize: 25, tankId: this.movementTank }).then((r) => {
          this.movements = r.movements;
          this.movementsTotal = r.total;
        }));
      }
      if (this.tab === 'adjustments' && !this.adjustments) jobs.push(Api.get('/stock-adjustments').then((r) => { this.adjustments = r.adjustments; }));
      if (this.tab === 'dips' && !this.dips) jobs.push(Api.get('/tank-stock-records', { date: this.dipDate }).then((r) => { this.dips = r.records; }));
      await Promise.all(jobs);
      this.error = null;
    } catch (err) {
      this.error = err.message;
    }
    if (Router.currentPage === 'inventory') Router.refresh();
  },

  needsLoad() {
    if (this.error) return false;
    if (!this.tanks || !this.products) return true;
    return (this.tab === 'movements' && !this.movements) || (this.tab === 'adjustments' && !this.adjustments) || (this.tab === 'dips' && !this.dips);
  },

  // SECTION: reload — drop cached data after a change and re-render
  reload(...keys) {
    (keys.length ? keys : ['tanks', 'products', 'movements', 'adjustments', 'dips']).forEach((k) => { this[k] = null; });
    this.error = null;
    Router.refresh();
  },

  setTab(tab) {
    this.tab = tab;
    Router.refresh();
  },

  // SECTION: render — header, tabs, then the active tab body
  render() {
    const canManage = Auth.can('inventory.manage');
    const header = `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Fuel Inventory</h2>
          <p class="text-body-md text-outline mt-1">Tank levels, products, stock movements, adjustments and daily dips</p>
        </div>
        <div class="flex flex-wrap gap-2">
          ${canManage ? `
            <button onclick="InventoryPage.openTransfer()" class="px-4 py-2 border border-outline-variant rounded-lg text-body-md hover:bg-surface-container-low flex items-center gap-2"><span class="material-symbols-outlined text-lg">swap_horiz</span> Transfer</button>
            <button onclick="InventoryPage.openTankForm()" class="px-4 py-2 bg-secondary text-on-secondary rounded-lg text-body-md font-semibold flex items-center gap-2"><span class="material-symbols-outlined text-lg">add</span> Add Tank</button>` : ''}
        </div>
      </div>
      <div class="tab-list mb-6">
        ${this.TABS.map(([key, label]) => `<button class="tab-btn ${this.tab === key ? 'active' : ''}" onclick="InventoryPage.setTab('${key}')">${label}</button>`).join('')}
      </div>`;

    if (this.error) return header + Utils.errorState(this.error, 'InventoryPage.reload()');
    if (this.needsLoad()) return header + Utils.loadingState();

    const body = {
      tanks: () => this.renderTanks(),
      products: () => this.renderProducts(),
      movements: () => this.renderMovements(),
      adjustments: () => this.renderAdjustments(),
      dips: () => this.renderDips(),
    }[this.tab]();
    return header + body;
  },

  afterRender() {
    if (this.needsLoad()) this.load();
  },

  // ─── Tanks ──────────────────────────────────────────────────

  renderTanks() {
    const canManage = Auth.can('inventory.manage');
    const canAdjust = Auth.can('inventory.adjust.request');
    const canDip = Auth.can('inventory.manage', 'pumps.readings.record');
    const low = this.tanks.filter((t) => t.low);
    const statusBadge = { ACTIVE: 'success', MAINTENANCE: 'warning', OUT_OF_SERVICE: 'neutral' };

    const rows = this.tanks.map((t) => `
      <tr>
        <td class="font-semibold">${Utils.escapeHtml(t.code)}${t.name ? `<div class="text-xs text-outline font-normal">${Utils.escapeHtml(t.name)}</div>` : ''}</td>
        <td>${Utils.escapeHtml(t.product.name)}</td>
        ${this.stations.length > 1 ? `<td>${Utils.escapeHtml(t.station.name)}</td>` : ''}
        <td class="min-w-[180px]">
          <div class="flex justify-between text-xs mb-1"><span class="text-data-mono ${t.low ? 'text-error font-semibold' : ''}">${Utils.formatNumber(t.currentLiters)} L</span><span class="text-outline">${t.percent}% of ${Utils.formatNumber(t.capacityLiters)}</span></div>
          <div class="h-2 bg-surface-container rounded-full overflow-hidden"><div class="h-full ${t.low ? 'bg-error' : 'bg-secondary'}" style="width:${Math.min(100, t.percent)}%"></div></div>
        </td>
        <td class="text-data-mono">${Utils.formatNumber(t.minLevelLiters)} L</td>
        <td>${Utils.badge(t.status.replace(/_/g, ' '), statusBadge[t.status])} ${t.low ? Utils.badge('Low', 'danger') : ''}</td>
        <td class="whitespace-nowrap">
          ${canAdjust ? `<button onclick="InventoryPage.openAdjust('${t.id}')" class="text-secondary hover:underline text-sm mr-2">Adjust</button>` : ''}
          ${canDip ? `<button onclick="InventoryPage.openDip('${t.id}')" class="text-primary hover:underline text-sm mr-2">Dip</button>` : ''}
          <button onclick="InventoryPage.showHistory('${t.id}')" class="text-primary hover:underline text-sm mr-2">History</button>
          ${canManage ? `<button onclick="InventoryPage.openTankForm('${t.id}')" class="text-outline hover:underline text-sm">Edit</button>` : ''}
        </td>
      </tr>`);

    const totalLiters = this.tanks.reduce((s, t) => s + t.currentLiters, 0);
    const totalCapacity = this.tanks.reduce((s, t) => s + t.capacityLiters, 0);

    return `
      ${low.length ? `
        <div class="p-4 rounded-xl border border-error/30 bg-error-container/40 mb-6 flex gap-3">
          <span class="material-symbols-outlined text-error">warning</span>
          <div><p class="font-semibold">Low stock in ${low.length} tank(s)</p>
          <p class="text-sm text-outline">${low.map((t) => `${Utils.escapeHtml(t.product.name)} (${Utils.escapeHtml(t.code)}): ${Utils.formatNumber(t.currentLiters)} L`).join(' · ')}</p></div>
        </div>` : ''}
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div class="page-section"><span class="text-label-sm text-outline">TOTAL IN STOCK</span><div class="text-headline-md font-headline-md mt-1">${Utils.formatNumber(totalLiters)} L</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">TOTAL CAPACITY</span><div class="text-headline-md font-headline-md mt-1">${Utils.formatNumber(totalCapacity)} L</div></div>
        <div class="page-section"><span class="text-label-sm text-outline">TANKS</span><div class="text-headline-md font-headline-md mt-1">${this.tanks.length}</div></div>
      </div>
      <div class="page-section">
        <div class="flex justify-end mb-3"><button onclick="InventoryPage.exportReport()" class="px-3 py-1.5 border border-outline-variant rounded-lg text-sm hover:bg-surface-container-low flex items-center gap-1"><span class="material-symbols-outlined text-base">download</span> Inventory report (CSV)</button></div>
        ${Utils.renderDataTable(['Tank', 'Product', ...(this.stations.length > 1 ? ['Station'] : []), 'Level', 'Minimum', 'Status', 'Actions'], rows, 'No tanks yet. Add a tank to start tracking stock.')}
      </div>`;
  },

  openTankForm(id = null) {
    const t = id ? this.tanks.find((x) => x.id === id) : null;
    Utils.openModal(t ? `Edit Tank ${Utils.escapeHtml(t.code)}` : 'Add Tank', `
      <form id="tank-form" class="space-y-1">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Tank Code</label><input name="code" class="form-input" required maxlength="20" value="${t ? Utils.escapeHtml(t.code) : ''}" placeholder="T5"/></div>
          <div class="form-group"><label class="form-label">Name (optional)</label><input name="name" class="form-input" maxlength="80" value="${t?.name ? Utils.escapeHtml(t.name) : ''}"/></div>
        </div>
        ${t ? '' : `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Station</label><select name="stationId" class="form-select" required>${this.stations.map((s) => `<option value="${s.id}">${Utils.escapeHtml(s.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">Fuel Product</label><select name="productId" class="form-select" required>${this.products.filter((p) => p.status === 'ACTIVE').map((p) => `<option value="${p.id}">${Utils.escapeHtml(p.name)}</option>`).join('')}</select></div>
        </div>`}
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-group"><label class="form-label">Capacity (L)</label><input name="capacityLiters" type="number" step="0.001" min="1" class="form-input" required value="${t ? t.capacityLiters : ''}"/></div>
          <div class="form-group"><label class="form-label">Minimum Level (L)</label><input name="minLevelLiters" type="number" step="0.001" min="0" class="form-input" value="${t ? t.minLevelLiters : 0}"/></div>
          ${t ? `<div class="form-group"><label class="form-label">Status</label><select name="status" class="form-select">${['ACTIVE', 'MAINTENANCE', 'OUT_OF_SERVICE'].map((s) => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}</select></div>`
            : '<div class="form-group"><label class="form-label">Opening Stock (L)</label><input name="openingLiters" type="number" step="0.001" min="0" class="form-input" value="0"/></div>'}
        </div>
        ${t ? '<p class="text-xs text-outline">The stock level cannot be edited here. Use an adjustment (requires approval) or record a delivery.</p>' : ''}
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="InventoryPage.saveTank(${t ? `'${t.id}'` : ''})" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>`);
  },

  async saveTank(id) {
    const d = Utils.getFormData('tank-form');
    const payload = { code: d.code, name: d.name, capacityLiters: d.capacityLiters, minLevelLiters: d.minLevelLiters || 0 };
    const ok = id
      ? await Utils.act(() => Api.patch(`/tanks/${id}`, { ...payload, status: d.status }), 'Tank updated')
      : await Utils.act(() => Api.post('/tanks', { ...payload, stationId: d.stationId, productId: d.productId, openingLiters: d.openingLiters || 0 }), 'Tank added');
    if (!ok) return;
    Utils.closeModal();
    this.reload('tanks', 'movements');
  },

  openAdjust(id) {
    const t = this.tanks.find((x) => x.id === id);
    Utils.openModal(`Stock Adjustment — ${Utils.escapeHtml(t.code)}`, `
      <form id="adjust-form">
        <p class="text-sm text-outline mb-4">${Utils.escapeHtml(t.product.name)} · book level <strong>${Utils.formatNumber(t.currentLiters, 1)} L</strong>. Adjustments take effect only after a manager approves them.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Type</label>
            <select name="kind" class="form-select"><option value="loss">Loss (evaporation, leak, theft)</option><option value="decrease">Correction — decrease</option><option value="increase">Correction — increase</option></select></div>
          <div class="form-group"><label class="form-label">Liters</label><input name="quantity" type="number" step="0.001" min="0.001" class="form-input" required/></div>
        </div>
        <div class="form-group"><label class="form-label">Reason</label><textarea name="reason" class="form-input" rows="3" required minlength="5" placeholder="What happened and how it was measured"></textarea></div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="InventoryPage.saveAdjust('${id}')" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Submit for Approval</button>`);
  },

  async saveAdjust(id) {
    const d = Utils.getFormData('adjust-form');
    const qty = Number(d.quantity);
    if (!(qty > 0)) return Utils.toast('Enter the number of liters', 'error');
    const ok = await Utils.act(() => Api.post(`/tanks/${id}/adjustments`, {
      quantity: d.kind === 'increase' ? d.quantity : `-${d.quantity}`,
      isLoss: d.kind === 'loss',
      reason: d.reason,
    }), 'Adjustment submitted for approval');
    if (!ok) return;
    Utils.closeModal();
    this.reload('adjustments');
  },

  openTransfer() {
    const options = this.tanks.filter((t) => t.status !== 'OUT_OF_SERVICE').map((t) => `<option value="${t.id}">${Utils.escapeHtml(t.code)} — ${Utils.escapeHtml(t.product.name)} (${Utils.formatNumber(t.currentLiters)} L)</option>`).join('');
    Utils.openModal('Transfer Between Tanks', `
      <form id="transfer-form">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">From Tank</label><select name="fromTankId" class="form-select">${options}</select></div>
          <div class="form-group"><label class="form-label">To Tank</label><select name="toTankId" class="form-select">${options}</select></div>
        </div>
        <div class="form-group"><label class="form-label">Liters</label><input name="quantity" type="number" step="0.001" min="0.001" class="form-input" required/></div>
        <div class="form-group"><label class="form-label">Note</label><input name="note" class="form-input" maxlength="500"/></div>
        <p class="text-xs text-outline">Both tanks must hold the same product. Stock moves immediately and is recorded in both ledgers.</p>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="InventoryPage.saveTransfer()" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Transfer</button>`);
  },

  async saveTransfer() {
    const d = Utils.getFormData('transfer-form');
    const ok = await Utils.act(() => Api.post('/stock-transfers', d), 'Transfer recorded');
    if (!ok) return;
    Utils.closeModal();
    this.reload('tanks', 'movements');
  },

  openDip(id) {
    const t = this.tanks.find((x) => x.id === id);
    Utils.openModal(`Record Dip — ${Utils.escapeHtml(t.code)}`, `
      <form id="dip-form">
        <p class="text-sm text-outline mb-4">Physical measurement of ${Utils.escapeHtml(t.product.name)}. Book level is <strong>${Utils.formatNumber(t.currentLiters, 1)} L</strong>; a closing dip is compared against it.</p>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-group"><label class="form-label">Date</label><input name="recordDate" type="date" class="form-input" value="${Utils.today()}" required/></div>
          <div class="form-group"><label class="form-label">Which dip</label><select name="kind" class="form-select"><option value="opening">Opening</option><option value="closing">Closing</option></select></div>
          <div class="form-group"><label class="form-label">Liters measured</label><input name="liters" type="number" step="0.001" min="0" class="form-input" required/></div>
        </div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="InventoryPage.saveDip('${id}')" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>`);
  },

  async saveDip(id) {
    const d = Utils.getFormData('dip-form');
    if (d.liters === '') return Utils.toast('Enter the measured liters', 'error');
    const res = await Utils.act(() => Api.post(`/tanks/${id}/stock-records`, { recordDate: d.recordDate, [d.kind === 'opening' ? 'openingLiters' : 'closingLiters']: d.liters }));
    if (!res) return;
    const v = res.record.varianceLiters;
    Utils.toast(d.kind === 'closing' && v !== null ? `Closing dip saved — variance ${Utils.signedLiters(v)}` : 'Dip saved', Math.abs(v || 0) > 50 ? 'error' : 'success');
    Utils.closeModal();
    this.reload('dips');
  },

  showHistory(id) {
    this.movementTank = id;
    this.movementsPage = 1;
    this.movements = null;
    this.setTab('movements');
  },

  async exportReport() {
    const res = await Utils.act(() => Api.get('/reports/inventory'));
    if (!res) return;
    Utils.exportCSV(`inventory-${Utils.today()}.csv`,
      ['Station', 'Tank', 'Product', 'Capacity (L)', 'Current (L)', 'Minimum (L)', 'Low', 'Cost value', 'Retail value', 'Delivered (L)', 'Sold (L)', 'Losses (L)', 'Adjustments (L)'],
      res.rows.map((r) => [r.station, r.tank, r.product, r.capacity, r.current, r.minLevel, r.low ? 'YES' : '', r.costValue, r.retailValue,
        r.movements.DELIVERY ?? 0, -(r.movements.SALE ?? 0), -(r.movements.LOSS ?? 0), r.movements.ADJUSTMENT ?? 0]));
  },

  // ─── Products ───────────────────────────────────────────────

  renderProducts() {
    const canManage = Auth.can('inventory.manage');
    const rows = this.products.map((p) => `
      <tr>
        <td class="font-semibold text-data-mono">${Utils.escapeHtml(p.code)}</td>
        <td>${Utils.escapeHtml(p.name)}</td>
        <td class="text-data-mono font-semibold">${Utils.formatCurrency(p.sellingPrice)}/${Utils.escapeHtml(p.unit)}</td>
        <td class="text-data-mono">${Utils.formatCurrency(p.costPrice)}/${Utils.escapeHtml(p.unit)}</td>
        <td class="text-data-mono">${p.sellingPrice > 0 ? (((p.sellingPrice - p.costPrice) / p.sellingPrice) * 100).toFixed(1) + '%' : '-'}</td>
        <td>${Utils.badge(p.status === 'ACTIVE' ? 'Active' : 'Inactive', p.status === 'ACTIVE' ? 'success' : 'neutral')}</td>
        <td class="whitespace-nowrap">
          ${canManage ? `<button onclick="InventoryPage.openProductForm('${p.id}')" class="text-secondary hover:underline text-sm mr-2">Edit</button>` : ''}
          <button onclick="InventoryPage.showPriceHistory('${p.id}')" class="text-primary hover:underline text-sm">Price history</button>
        </td>
      </tr>`);
    return `
      <div class="page-section">
        ${canManage ? `<div class="flex justify-end mb-3"><button onclick="InventoryPage.openProductForm()" class="px-4 py-2 bg-secondary text-on-secondary rounded-lg text-body-md font-semibold flex items-center gap-2"><span class="material-symbols-outlined text-lg">add</span> Add Product</button></div>` : ''}
        ${Utils.renderDataTable(['Code', 'Name', 'Selling Price', 'Cost Price', 'Margin', 'Status', 'Actions'], rows, 'No fuel products yet')}
      </div>`;
  },

  openProductForm(id = null) {
    const p = id ? this.products.find((x) => x.id === id) : null;
    Utils.openModal(p ? 'Edit Fuel Product' : 'Add Fuel Product', `
      <form id="product-form">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-group"><label class="form-label">Code</label><input name="code" class="form-input" required maxlength="20" value="${p ? Utils.escapeHtml(p.code) : ''}" placeholder="DIESEL"/></div>
          <div class="form-group sm:col-span-2"><label class="form-label">Name</label><input name="name" class="form-input" required value="${p ? Utils.escapeHtml(p.name) : ''}"/></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-group"><label class="form-label">Selling Price / L</label><input name="sellingPrice" type="number" step="0.0001" min="0.0001" class="form-input" required value="${p ? p.sellingPrice : ''}"/></div>
          <div class="form-group"><label class="form-label">Cost Price / L</label><input name="costPrice" type="number" step="0.0001" min="0" class="form-input" value="${p ? p.costPrice : 0}"/></div>
          <div class="form-group"><label class="form-label">Status</label><select name="status" class="form-select"><option value="ACTIVE" ${p?.status !== 'INACTIVE' ? 'selected' : ''}>Active</option><option value="INACTIVE" ${p?.status === 'INACTIVE' ? 'selected' : ''}>Inactive</option></select></div>
        </div>
        <p class="text-xs text-outline">Price changes are recorded in the price history and audit log. Existing sales keep the price they were sold at.</p>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="InventoryPage.saveProduct(${p ? `'${p.id}'` : ''})" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>`);
  },

  async saveProduct(id) {
    const d = Utils.getFormData('product-form');
    const ok = id
      ? await Utils.act(() => Api.patch(`/products/${id}`, d), 'Product updated')
      : await Utils.act(() => Api.post('/products', d), 'Product added');
    if (!ok) return;
    Utils.closeModal();
    this.reload('products', 'tanks');
  },

  async showPriceHistory(id) {
    const p = this.products.find((x) => x.id === id);
    const res = await Utils.act(() => Api.get(`/products/${id}/price-history`));
    if (!res) return;
    Utils.openModal(`Price History — ${Utils.escapeHtml(p.name)}`, Utils.renderDataTable(['Date', 'Selling', 'Cost', 'Changed by'],
      res.history.map((h) => `<tr><td>${Utils.formatDateTime(h.effectiveAt)}</td><td class="text-data-mono">${Utils.formatCurrency(h.sellingPrice)}</td><td class="text-data-mono">${Utils.formatCurrency(h.costPrice)}</td><td>${Utils.escapeHtml(h.changedBy.name)}</td></tr>`),
      'No price changes recorded'));
  },

  // ─── Movements ──────────────────────────────────────────────

  renderMovements() {
    const typeBadge = { OPENING: 'neutral', DELIVERY: 'success', SALE: 'info', SALE_REVERSAL: 'warning', ADJUSTMENT: 'warning', LOSS: 'danger', TRANSFER_IN: 'success', TRANSFER_OUT: 'info' };
    const pages = Math.max(1, Math.ceil(this.movementsTotal / 25));
    const rows = this.movements.map((m) => `
      <tr>
        <td class="whitespace-nowrap">${Utils.formatDateTime(m.createdAt)}</td>
        <td>${Utils.escapeHtml(m.tank.code)} · ${Utils.escapeHtml(m.tank.product.name)}</td>
        <td>${Utils.badge(m.type.replace(/_/g, ' '), typeBadge[m.type])}</td>
        <td class="text-data-mono font-semibold ${m.quantity < 0 ? 'text-error' : 'text-secondary'}">${Utils.signedLiters(m.quantity)}</td>
        <td class="text-data-mono">${Utils.formatNumber(m.balanceAfter, 1)} L</td>
        <td>${Utils.escapeHtml(m.createdBy.name)}</td>
        <td class="text-sm text-outline">${Utils.escapeHtml(m.note || '')}</td>
      </tr>`);
    return `
      <div class="flex flex-wrap gap-3 mb-4 items-center">
        <label class="text-label-sm text-outline">TANK</label>
        <select class="form-select w-auto" onchange="InventoryPage.filterMovements(this.value)">
          <option value="">All tanks</option>
          ${this.tanks.map((t) => `<option value="${t.id}" ${this.movementTank === t.id ? 'selected' : ''}>${Utils.escapeHtml(t.code)} — ${Utils.escapeHtml(t.product.name)}</option>`).join('')}
        </select>
        <span class="text-sm text-outline ml-auto">${this.movementsTotal} movement(s)</span>
      </div>
      <div class="page-section">
        ${Utils.renderDataTable(['Date', 'Tank', 'Type', 'Quantity', 'Balance', 'By', 'Note'], rows, 'No stock movements')}
        ${Utils.renderPagination(this.movementsPage, pages, 'InventoryPage.movementsGoTo')}
      </div>`;
  },

  filterMovements(tankId) {
    this.movementTank = tankId;
    this.movementsPage = 1;
    this.reload('movements');
  },

  movementsGoTo(p) {
    this.movementsPage = p;
    this.reload('movements');
  },

  // ─── Adjustments ────────────────────────────────────────────

  renderAdjustments() {
    const session = Auth.getSession();
    const canApprove = Auth.can('inventory.adjust.approve');
    const statusBadge = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'neutral' };
    const rows = this.adjustments.map((a) => {
      const own = a.requestedBy.id === session.userId && session.role !== 'super_admin';
      return `
      <tr>
        <td class="whitespace-nowrap">${Utils.formatDateTime(a.createdAt)}</td>
        <td>${Utils.escapeHtml(a.tank.code)} · ${Utils.escapeHtml(a.tank.product.name)}</td>
        <td>${a.isLoss ? Utils.badge('Loss', 'danger') : Utils.badge('Correction', 'info')}</td>
        <td class="text-data-mono font-semibold ${a.quantity < 0 ? 'text-error' : 'text-secondary'}">${Utils.signedLiters(a.quantity)}</td>
        <td class="text-sm">${Utils.escapeHtml(a.reason)}</td>
        <td>${Utils.escapeHtml(a.requestedBy.name)}</td>
        <td>${Utils.badge(a.status, statusBadge[a.status])}${a.approvedBy ? `<div class="text-xs text-outline">${Utils.escapeHtml(a.approvedBy.name)}</div>` : ''}</td>
        <td class="whitespace-nowrap">
          ${a.status === 'PENDING' && canApprove && !own ? `
            <button onclick="InventoryPage.decide('${a.id}', 'approve')" class="text-secondary hover:underline text-sm mr-2">Approve</button>
            <button onclick="InventoryPage.decide('${a.id}', 'reject')" class="text-error hover:underline text-sm">Reject</button>`
            : a.status === 'PENDING' && own ? '<span class="text-xs text-outline">Awaiting another approver</span>' : ''}
        </td>
      </tr>`;
    });
    const pending = this.adjustments.filter((a) => a.status === 'PENDING').length;
    return `
      <div class="page-section">
        <p class="text-sm text-outline mb-4">${pending} pending. Losses and corrections change stock only after approval by someone other than the requester.</p>
        ${Utils.renderDataTable(['Requested', 'Tank', 'Type', 'Liters', 'Reason', 'By', 'Status', 'Actions'], rows, 'No adjustments')}
      </div>`;
  },

  decide(id, decision) {
    const a = this.adjustments.find((x) => x.id === id);
    Utils.confirm(`${decision === 'approve' ? 'Approve' : 'Reject'} ${Utils.signedLiters(a.quantity)} on tank ${Utils.escapeHtml(a.tank.code)}?${decision === 'approve' ? ' The tank level will change immediately.' : ''}`, async () => {
      const ok = await Utils.act(() => Api.post(`/stock-adjustments/${id}/${decision}`), decision === 'approve' ? 'Adjustment approved' : 'Adjustment rejected');
      if (ok) this.reload('adjustments', 'tanks', 'movements');
    });
  },

  // ─── Daily dips ─────────────────────────────────────────────

  renderDips() {
    const byTank = Object.fromEntries(this.dips.map((r) => [r.tankId, r]));
    const canDip = Auth.can('inventory.manage', 'pumps.readings.record');
    const rows = this.tanks.map((t) => {
      const r = byTank[t.id];
      const v = r?.varianceLiters;
      return `
      <tr>
        <td class="font-semibold">${Utils.escapeHtml(t.code)}</td>
        <td>${Utils.escapeHtml(t.product.name)}</td>
        <td class="text-data-mono">${r?.openingLiters != null ? Utils.formatNumber(r.openingLiters, 1) + ' L' : '<span class="text-outline">—</span>'}</td>
        <td class="text-data-mono">${r?.closingLiters != null ? Utils.formatNumber(r.closingLiters, 1) + ' L' : '<span class="text-outline">—</span>'}</td>
        <td class="text-data-mono">${r?.bookLiters != null ? Utils.formatNumber(r.bookLiters, 1) + ' L' : '<span class="text-outline">—</span>'}</td>
        <td class="text-data-mono font-semibold ${v != null && Math.abs(v) > 50 ? 'text-error' : ''}">${v != null ? Utils.signedLiters(v) : '<span class="text-outline">—</span>'}</td>
        <td>${r ? Utils.escapeHtml(r.recordedBy.name) : ''}</td>
        <td>${canDip ? `<button onclick="InventoryPage.openDip('${t.id}')" class="text-primary hover:underline text-sm">Record</button>` : ''}</td>
      </tr>`;
    });
    return `
      <div class="flex flex-wrap gap-3 mb-4 items-center">
        <label class="text-label-sm text-outline">DATE</label>
        <input type="date" class="form-input w-auto" value="${this.dipDate}" onchange="InventoryPage.setDipDate(this.value)"/>
      </div>
      <div class="page-section">
        <p class="text-sm text-outline mb-4">Variance = physical closing dip − book level at the time of the dip. Large variances raise a stock discrepancy alert.</p>
        ${Utils.renderDataTable(['Tank', 'Product', 'Opening', 'Closing', 'Book', 'Variance', 'By', ''], rows, 'No tanks')}
      </div>`;
  },

  setDipDate(date) {
    this.dipDate = date || Utils.today();
    this.reload('dips');
  },
};

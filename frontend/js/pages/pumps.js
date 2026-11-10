/**
 * Stations & Pumps Page
 */
// SECTION: Pumps page object — pump board with meter readings, shifts, daily reconciliation, stations
const PumpsPage = {
  tab: 'board',
  pumps: null,
  tanks: null,
  stations: null,
  myShift: undefined,
  shifts: null,
  staff: null,
  readings: null,
  report: null,
  readingDate: Utils.today(),
  error: null,

  TABS: [
    ['board', 'Pump Board', null],
    ['shifts', 'Shifts', ['shifts.view', 'shifts.view_own']],
    ['reconcile', 'Reconciliation', ['pumps.reconcile', 'reports.view']],
    ['stations', 'Stations', ['stations.manage']],
  ],

  onEnter() {
    Object.assign(this, { pumps: null, tanks: null, stations: null, myShift: undefined, shifts: null, staff: null, readings: null, report: null, error: null });
  },

  visibleTabs() {
    return this.TABS.filter(([, , perms]) => !perms || Auth.can(...perms));
  },

  needsLoad() {
    if (this.error) return false;
    if (!this.pumps || !this.stations || this.myShift === undefined) return true;
    if (this.tab === 'board' && Auth.can('pumps.manage') && !this.tanks) return true;
    if (this.tab === 'shifts' && (!this.shifts || (Auth.can('shifts.manage') && !this.staff))) return true;
    if (this.tab === 'reconcile' && !this.report) return true;
    return false;
  },

  async load() {
    try {
      const jobs = [];
      if (!this.pumps) jobs.push(Api.get('/pumps').then((r) => { this.pumps = r.pumps; }));
      if (!this.stations) jobs.push(Api.get('/stations').then((r) => { this.stations = r.stations; }));
      if (this.myShift === undefined) {
        jobs.push(Auth.can('shifts.view', 'shifts.view_own') ? Api.get('/shifts/mine').then((r) => { this.myShift = r.shift; }) : Promise.resolve().then(() => { this.myShift = null; }));
      }
      if (this.tab === 'board' && Auth.can('pumps.manage') && !this.tanks) jobs.push(Api.get('/tanks').then((r) => { this.tanks = r.tanks; }));
      if (this.tab === 'shifts') {
        if (!this.shifts) jobs.push(Api.get('/shifts').then((r) => { this.shifts = r.shifts; }));
        if (Auth.can('shifts.manage') && !this.staff) {
          jobs.push(Api.get('/users', { status: 'ACTIVE' }).then((r) => { this.staff = r.users.filter((u) => ['attendant', 'cashier', 'station_manager'].includes(u.role.key)); }));
        }
      }
      if (this.tab === 'reconcile' && !this.report) {
        jobs.push(Api.get('/reports/pump-reconciliation', { date: this.readingDate }).then((r) => { this.report = r; }));
      }
      await Promise.all(jobs);
      this.error = null;
    } catch (err) {
      this.error = err.message;
    }
    if (Router.currentPage === 'pumps') Router.refresh();
  },

  reload(...keys) {
    keys.forEach((k) => { this[k] = k === 'myShift' ? undefined : null; });
    this.error = null;
    Router.refresh();
  },

  setTab(tab) {
    this.tab = tab;
    Router.refresh();
  },

  render() {
    const tabs = this.visibleTabs();
    if (!tabs.some(([k]) => k === this.tab)) this.tab = 'board';
    const header = `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Stations &amp; Pumps</h2>
          <p class="text-body-md text-outline mt-1">Pump meters, attendant shifts and daily reconciliation</p>
        </div>
      </div>
      ${tabs.length > 1 ? `<div class="tab-list mb-6">${tabs.map(([k, label]) => `<button class="tab-btn ${this.tab === k ? 'active' : ''}" onclick="PumpsPage.setTab('${k}')">${label}</button>`).join('')}</div>` : ''}`;

    if (this.error) return header + Utils.errorState(this.error, "PumpsPage.reload('pumps','stations','myShift')");
    if (this.needsLoad()) return header + Utils.loadingState();
    return header + this.renderMyShift() + { board: () => this.renderBoard(), shifts: () => this.renderShifts(), reconcile: () => this.renderReconcile(), stations: () => this.renderStations() }[this.tab]();
  },

  afterRender() {
    if (this.needsLoad()) this.load();
  },

  // SECTION: banner for staff on an open shift — their assigned pumps
  renderMyShift() {
    if (!this.myShift) return '';
    const s = this.myShift;
    return `
      <div class="p-4 rounded-xl bg-secondary/10 border border-secondary/30 mb-6 flex flex-wrap gap-3 items-center">
        <span class="material-symbols-outlined text-secondary">badge</span>
        <div class="flex-1 min-w-0">
          <p class="font-semibold">Your shift is open</p>
          <p class="text-sm text-outline">Since ${Utils.formatDateTime(s.startedAt)} · Pumps ${s.assignments.map((a) => Utils.escapeHtml(a.pump.code)).join(', ')}</p>
        </div>
        <button onclick="PumpsPage.closeShift('${s.id}')" class="px-3 py-1.5 border border-outline-variant rounded-lg text-sm hover:bg-surface-container-low">End my shift</button>
      </div>`;
  },

  // ─── Pump board ─────────────────────────────────────────────

  myPumpIds() {
    return new Set(this.myShift?.assignments.map((a) => a.pump.id) || []);
  },

  canRecordOn(pump) {
    return Auth.can('pumps.manage') || (Auth.can('pumps.readings.record') && this.myPumpIds().has(pump.id));
  },

  renderBoard() {
    const canManage = Auth.can('pumps.manage');
    const statusBadge = { ACTIVE: 'success', MAINTENANCE: 'warning', OUT_OF_SERVICE: 'neutral' };
    const cards = this.pumps.map((p) => {
      const mine = this.myPumpIds().has(p.id);
      const record = this.canRecordOn(p) && p.status === 'ACTIVE';
      return `
      <div class="bg-surface-container-lowest border ${mine ? 'border-secondary' : 'border-outline-variant'} rounded-xl p-card-padding flex flex-col">
        <div class="flex justify-between items-start gap-2 mb-4">
          <div>
            <h3 class="text-headline-md font-headline-md">${Utils.escapeHtml(p.name || p.code)}</h3>
            <p class="text-label-sm text-outline">${Utils.escapeHtml(p.code)}${this.stations.length > 1 ? ` · ${Utils.escapeHtml(p.station.name)}` : ''}</p>
          </div>
          ${Utils.badge(p.status.replace(/_/g, ' '), statusBadge[p.status])}
        </div>
        <p class="text-sm mb-3"><span class="material-symbols-outlined text-base align-middle text-outline">person</span> ${p.attendant ? Utils.escapeHtml(p.attendant.name) : '<span class="text-outline">No attendant assigned</span>'}</p>
        <div class="space-y-3 flex-1">
          ${p.nozzles.map((n) => `
            <div class="p-3 rounded-lg bg-surface-container-low">
              <div class="flex justify-between gap-2">
                <span class="font-semibold">${Utils.escapeHtml(n.code)} · ${Utils.escapeHtml(n.tank.product.name)}</span>
                <span class="text-data-mono text-sm">${Utils.formatNumber(n.currentMeter, 1)}</span>
              </div>
              <p class="text-xs text-outline">Tank ${Utils.escapeHtml(n.tank.code)} · ${Utils.formatCurrency(n.tank.product.sellingPrice)}/L</p>
              ${n.openReading
                ? `<div class="flex justify-between items-center mt-2 gap-2"><span class="text-xs">${Utils.badge('Reading open', 'info')} from ${Utils.formatNumber(n.openReading.openingMeter, 1)}</span>
                   ${record ? `<button onclick="PumpsPage.openCloseReading('${n.openReading.id}', ${n.openReading.openingMeter})" class="text-sm font-semibold text-secondary hover:underline">Close</button>` : ''}</div>`
                : record ? `<button onclick="PumpsPage.openReading('${n.id}', ${n.currentMeter})" class="mt-2 text-sm font-semibold text-primary hover:underline">Open reading</button>` : ''}
            </div>`).join('') || '<p class="text-sm text-outline">No nozzles</p>'}
        </div>
        ${canManage ? `
          <div class="flex gap-3 mt-4 pt-3 border-t border-outline-variant">
            <button onclick="PumpsPage.openNozzleForm('${p.id}')" class="text-sm text-secondary hover:underline">Add nozzle</button>
            <button onclick="PumpsPage.openPumpForm('${p.id}')" class="text-sm text-outline hover:underline">Edit pump</button>
          </div>` : ''}
      </div>`;
    });
    return `
      ${canManage ? `<div class="flex justify-end mb-4"><button onclick="PumpsPage.openPumpForm()" class="px-4 py-2 bg-secondary text-on-secondary rounded-lg text-body-md font-semibold flex items-center gap-2"><span class="material-symbols-outlined text-lg">add</span> Add Pump</button></div>` : ''}
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">${cards.join('') || '<div class="page-section text-outline">No pumps configured.</div>'}</div>`;
  },

  openReading(nozzleId, lastMeter) {
    Utils.openModal('Open Meter Reading', `
      <form id="reading-form">
        <p class="text-sm text-outline mb-4">Read the totalizer on the pump. The last closing reading was <strong>${Utils.formatNumber(lastMeter, 3)}</strong>.</p>
        <div class="form-group"><label class="form-label">Opening meter</label><input name="openingMeter" type="number" step="0.001" min="${lastMeter}" class="form-input text-lg" required value="${lastMeter}"/></div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="PumpsPage.saveOpenReading('${nozzleId}')" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Open</button>`);
  },

  async saveOpenReading(nozzleId) {
    const d = Utils.getFormData('reading-form');
    const ok = await Utils.act(() => Api.post('/pump-readings', { nozzleId, openingMeter: d.openingMeter }), 'Reading opened');
    if (!ok) return;
    Utils.closeModal();
    this.reload('pumps');
  },

  openCloseReading(readingId, openingMeter) {
    Utils.openModal('Close Meter Reading', `
      <form id="reading-form">
        <p class="text-sm text-outline mb-4">Opened at <strong>${Utils.formatNumber(openingMeter, 3)}</strong>. Liters dispensed are compared with sales recorded on this nozzle.</p>
        <div class="form-group"><label class="form-label">Closing meter</label><input name="closingMeter" type="number" step="0.001" min="${openingMeter}" class="form-input text-lg" required/></div>
        <div class="form-group"><label class="form-label">Notes</label><input name="notes" class="form-input" maxlength="500"/></div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="PumpsPage.saveCloseReading('${readingId}')" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Close Reading</button>`);
  },

  async saveCloseReading(readingId) {
    const d = Utils.getFormData('reading-form');
    const res = await Utils.act(() => Api.post(`/pump-readings/${readingId}/close`, d));
    if (!res) return;
    const r = res.reading;
    Utils.toast(`Closed: ${Utils.formatNumber(r.meterLiters, 1)} L metered, ${Utils.formatNumber(r.recordedLiters, 1)} L recorded (variance ${Utils.signedLiters(r.varianceLiters)})`, Math.abs(r.varianceLiters) > 5 ? 'error' : 'success');
    Utils.closeModal();
    this.reload('pumps', 'report');
  },

  openPumpForm(id = null) {
    const p = id ? this.pumps.find((x) => x.id === id) : null;
    Utils.openModal(p ? 'Edit Pump' : 'Add Pump', `
      <form id="pump-form">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Code</label><input name="code" class="form-input" required maxlength="20" value="${p ? Utils.escapeHtml(p.code) : ''}" placeholder="P4"/></div>
          <div class="form-group"><label class="form-label">Name</label><input name="name" class="form-input" maxlength="80" value="${p?.name ? Utils.escapeHtml(p.name) : ''}"/></div>
        </div>
        ${p ? `<div class="form-group"><label class="form-label">Status</label><select name="status" class="form-select">${['ACTIVE', 'MAINTENANCE', 'OUT_OF_SERVICE'].map((s) => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}</select></div>`
          : `<div class="form-group"><label class="form-label">Station</label><select name="stationId" class="form-select">${this.stations.map((s) => `<option value="${s.id}">${Utils.escapeHtml(s.name)}</option>`).join('')}</select></div>`}
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="PumpsPage.savePump(${p ? `'${p.id}'` : ''})" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>`);
  },

  async savePump(id) {
    const d = Utils.getFormData('pump-form');
    const ok = id ? await Utils.act(() => Api.patch(`/pumps/${id}`, d), 'Pump updated') : await Utils.act(() => Api.post('/pumps', d), 'Pump added');
    if (!ok) return;
    Utils.closeModal();
    this.reload('pumps');
  },

  openNozzleForm(pumpId) {
    const pump = this.pumps.find((p) => p.id === pumpId);
    const tanks = (this.tanks || []).filter((t) => t.station.id === pump.station.id);
    Utils.openModal(`Add Nozzle — ${Utils.escapeHtml(pump.code)}`, `
      <form id="nozzle-form">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-group"><label class="form-label">Code</label><input name="code" class="form-input" required maxlength="20" placeholder="N${pump.nozzles.length + 1}"/></div>
          <div class="form-group sm:col-span-2"><label class="form-label">Draws from tank</label><select name="tankId" class="form-select">${tanks.map((t) => `<option value="${t.id}">${Utils.escapeHtml(t.code)} — ${Utils.escapeHtml(t.product.name)}</option>`).join('')}</select></div>
        </div>
        <div class="form-group"><label class="form-label">Current meter reading</label><input name="currentMeter" type="number" step="0.001" min="0" class="form-input" value="0"/></div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="PumpsPage.saveNozzle('${pumpId}')" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>`);
  },

  async saveNozzle(pumpId) {
    const ok = await Utils.act(() => Api.post(`/pumps/${pumpId}/nozzles`, Utils.getFormData('nozzle-form')), 'Nozzle added');
    if (!ok) return;
    Utils.closeModal();
    this.reload('pumps');
  },

  // ─── Shifts ─────────────────────────────────────────────────

  renderShifts() {
    const canManage = Auth.can('shifts.manage');
    const statusBadge = { OPEN: 'info', CLOSED: 'warning', RECONCILED: 'success' };
    const rows = this.shifts.map((s) => `
      <tr>
        <td class="font-semibold">${Utils.escapeHtml(s.user.name)}</td>
        <td>${s.assignments.map((a) => Utils.escapeHtml(a.pump.code)).join(', ')}</td>
        <td class="whitespace-nowrap">${Utils.formatDateTime(s.startedAt)}</td>
        <td class="whitespace-nowrap">${s.endedAt ? Utils.formatDateTime(s.endedAt) : '—'}</td>
        <td>${s._count.readings}</td>
        <td>${Utils.badge(s.status, statusBadge[s.status])}</td>
        <td>${s.status === 'OPEN' && canManage ? `<button onclick="PumpsPage.closeShift('${s.id}')" class="text-error hover:underline text-sm">Close</button>` : ''}</td>
      </tr>`);
    return `
      <div class="page-section">
        ${canManage ? `<div class="flex justify-end mb-3"><button onclick="PumpsPage.openShiftForm()" class="px-4 py-2 bg-secondary text-on-secondary rounded-lg text-body-md font-semibold flex items-center gap-2"><span class="material-symbols-outlined text-lg">play_arrow</span> Open Shift</button></div>` : ''}
        ${Utils.renderDataTable(['Staff', 'Pumps', 'Started', 'Ended', 'Readings', 'Status', ''], rows, 'No shifts yet')}
      </div>`;
  },

  openShiftForm() {
    const busy = new Set(this.pumps.filter((p) => p.attendant).map((p) => p.id));
    Utils.openModal('Open Shift', `
      <form id="shift-form">
        <div class="form-group"><label class="form-label">Staff member</label>
          <select name="userId" class="form-select">${this.staff.map((u) => `<option value="${u.id}">${Utils.escapeHtml(u.name)} — ${Utils.escapeHtml(u.role.name)}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Assign pumps</label>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            ${this.pumps.map((p) => `
              <label class="flex items-center gap-2 p-2 rounded border border-outline-variant ${busy.has(p.id) || p.status !== 'ACTIVE' ? 'opacity-50' : ''}">
                <input type="checkbox" name="pump" value="${p.id}" ${busy.has(p.id) || p.status !== 'ACTIVE' ? 'disabled' : ''}/>
                <span class="text-sm">${Utils.escapeHtml(p.code)}${busy.has(p.id) ? ` <span class="text-xs text-outline">(${Utils.escapeHtml(p.attendant.name)})</span>` : ''}</span>
              </label>`).join('')}
          </div></div>
        <div class="form-group"><label class="form-label">Notes</label><input name="notes" class="form-input" maxlength="500"/></div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="PumpsPage.saveShift()" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Open Shift</button>`);
  },

  async saveShift() {
    const form = document.getElementById('shift-form');
    const pumpIds = [...form.querySelectorAll('input[name="pump"]:checked')].map((i) => i.value);
    if (!pumpIds.length) return Utils.toast('Select at least one pump', 'error');
    const ok = await Utils.act(() => Api.post('/shifts', { userId: form.userId.value, pumpIds, notes: form.notes.value }), 'Shift opened');
    if (!ok) return;
    Utils.closeModal();
    this.reload('shifts', 'pumps', 'myShift');
  },

  closeShift(id) {
    Utils.confirm('Close this shift? All meter readings in it must be closed first.', async () => {
      const ok = await Utils.act(() => Api.post(`/shifts/${id}/close`), 'Shift closed');
      if (ok) this.reload('shifts', 'pumps', 'myShift');
    });
  },

  // ─── Reconciliation ─────────────────────────────────────────

  renderReconcile() {
    const canReconcile = Auth.can('pumps.reconcile');
    const statusBadge = { OPEN: 'info', CLOSED: 'warning', RECONCILED: 'success' };
    const summary = this.report.pumps.map((p) => `
      <tr>
        <td class="font-semibold">${Utils.escapeHtml(p.pump)}</td>
        <td>${p.readings}${p.open ? ` <span class="text-xs text-outline">(${p.open} open)</span>` : ''}</td>
        <td class="text-data-mono">${Utils.formatNumber(p.meterLiters, 1)} L</td>
        <td class="text-data-mono">${Utils.formatNumber(p.recordedLiters, 1)} L</td>
        <td class="text-data-mono font-semibold ${Math.abs(p.varianceLiters) > 5 ? 'text-error' : ''}">${Utils.signedLiters(p.varianceLiters)}</td>
        <td class="text-data-mono">${Utils.formatCurrency(p.expectedRevenue)}</td>
      </tr>`);
    const detail = this.report.readings.map((r) => `
      <tr>
        <td>${Utils.escapeHtml(r.nozzle.pump.code)}/${Utils.escapeHtml(r.nozzle.code)}</td>
        <td>${Utils.escapeHtml(r.nozzle.tank.product.name)}</td>
        <td class="text-data-mono">${Utils.formatNumber(r.openingMeter, 1)}</td>
        <td class="text-data-mono">${r.closingMeter != null ? Utils.formatNumber(r.closingMeter, 1) : '—'}</td>
        <td class="text-data-mono">${r.meterLiters != null ? Utils.formatNumber(r.meterLiters, 1) : '—'}</td>
        <td class="text-data-mono">${r.recordedLiters != null ? Utils.formatNumber(r.recordedLiters, 1) : '—'}</td>
        <td class="text-data-mono font-semibold ${Math.abs(r.varianceLiters || 0) > 5 ? 'text-error' : ''}">${r.varianceLiters != null ? Utils.signedLiters(r.varianceLiters) : '—'}</td>
        <td>${Utils.escapeHtml(r.recordedBy.name)}</td>
        <td>${Utils.badge(r.status, statusBadge[r.status])}${r.notes ? `<div class="text-xs text-outline">${Utils.escapeHtml(r.notes)}</div>` : ''}</td>
        <td>${r.status === 'CLOSED' && canReconcile ? `<button onclick="PumpsPage.reconcile('${r.id}', ${r.varianceLiters || 0})" class="text-secondary hover:underline text-sm">Reconcile</button>` : ''}</td>
      </tr>`);
    return `
      <div class="flex flex-wrap gap-3 mb-4 items-center">
        <label class="text-label-sm text-outline">DATE</label>
        <input type="date" class="form-input w-auto" value="${this.readingDate}" onchange="PumpsPage.setDate(this.value)"/>
      </div>
      <div class="page-section mb-6">
        <h3 class="text-headline-md mb-4">Daily Summary by Pump</h3>
        ${Utils.renderDataTable(['Pump', 'Readings', 'Metered', 'Recorded Sales', 'Variance', 'Expected Revenue'], summary, 'No readings for this date')}
      </div>
      <div class="page-section">
        <h3 class="text-headline-md mb-4">Readings</h3>
        ${Utils.renderDataTable(['Nozzle', 'Product', 'Opening', 'Closing', 'Metered', 'Recorded', 'Variance', 'By', 'Status', ''], detail, 'No readings for this date')}
      </div>`;
  },

  setDate(date) {
    this.readingDate = date || Utils.today();
    this.reload('report');
  },

  reconcile(id, variance) {
    Utils.openModal('Reconcile Reading', `
      <form id="reconcile-form">
        <p class="text-sm mb-4">Variance: <strong>${Utils.signedLiters(variance)}</strong>${variance ? '. Explain the difference (e.g. calibration, unrecorded sale, test pour).' : '. Meter and sales agree.'}</p>
        <div class="form-group"><label class="form-label">Notes</label><textarea name="notes" class="form-input" rows="3" ${variance ? 'required' : ''}></textarea></div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="PumpsPage.saveReconcile('${id}')" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Mark Reconciled</button>`);
  },

  async saveReconcile(id) {
    const ok = await Utils.act(() => Api.post(`/pump-readings/${id}/reconcile`, Utils.getFormData('reconcile-form')), 'Reading reconciled');
    if (!ok) return;
    Utils.closeModal();
    this.reload('report');
  },

  // ─── Stations ───────────────────────────────────────────────

  renderStations() {
    const rows = this.stations.map((s) => `
      <tr>
        <td class="font-semibold text-data-mono">${Utils.escapeHtml(s.code)}</td>
        <td>${Utils.escapeHtml(s.name)}</td>
        <td>${Utils.escapeHtml(s.address || '')}</td>
        <td>${Utils.escapeHtml(s.phone || '')}</td>
        <td>${s._count.tanks} tanks · ${s._count.pumps} pumps · ${s._count.users} staff</td>
        <td>${Utils.badge(s.status === 'ACTIVE' ? 'Active' : 'Inactive', s.status === 'ACTIVE' ? 'success' : 'neutral')}</td>
        <td><button onclick="PumpsPage.openStationForm('${s.id}')" class="text-secondary hover:underline text-sm">Edit</button></td>
      </tr>`);
    return `
      <div class="page-section">
        <div class="flex justify-end mb-3"><button onclick="PumpsPage.openStationForm()" class="px-4 py-2 bg-secondary text-on-secondary rounded-lg text-body-md font-semibold flex items-center gap-2"><span class="material-symbols-outlined text-lg">add</span> Add Station</button></div>
        ${Utils.renderDataTable(['Code', 'Name', 'Address', 'Phone', 'Equipment', 'Status', ''], rows, 'No stations')}
      </div>`;
  },

  openStationForm(id = null) {
    const s = id ? this.stations.find((x) => x.id === id) : null;
    const v = (k) => (s?.[k] ? Utils.escapeHtml(s[k]) : '');
    Utils.openModal(s ? 'Edit Station' : 'Add Station', `
      <form id="station-form">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-group"><label class="form-label">Code</label><input name="code" class="form-input" required maxlength="20" value="${v('code')}" placeholder="STN-002"/></div>
          <div class="form-group sm:col-span-2"><label class="form-label">Name</label><input name="name" class="form-input" required value="${v('name')}"/></div>
        </div>
        <div class="form-group"><label class="form-label">Address</label><input name="address" class="form-input" value="${v('address')}"/></div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-group"><label class="form-label">Phone</label><input name="phone" class="form-input" value="${v('phone')}"/></div>
          <div class="form-group"><label class="form-label">Email</label><input name="email" type="email" class="form-input" value="${v('email')}"/></div>
          <div class="form-group"><label class="form-label">Status</label><select name="status" class="form-select"><option value="ACTIVE">Active</option><option value="INACTIVE" ${s?.status === 'INACTIVE' ? 'selected' : ''}>Inactive</option></select></div>
        </div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="PumpsPage.saveStation(${s ? `'${s.id}'` : ''})" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>`);
  },

  async saveStation(id) {
    const d = Utils.getFormData('station-form');
    const ok = id ? await Utils.act(() => Api.patch(`/stations/${id}`, d), 'Station updated') : await Utils.act(() => Api.post('/stations', d), 'Station added');
    if (!ok) return;
    Utils.closeModal();
    this.reload('stations');
  },
};

/**
 * Reports Page
 */
// SECTION: Reports page object — report catalogue, period filters, table/chart rendering, Excel/CSV/PDF export
const ReportsPage = {
  catalogue: null,
  canExport: false,
  current: null, // report key
  preset: 'month',
  from: '',
  to: '',
  groupBy: 'day',
  search: '',
  data: null,
  loadingReport: false,
  error: null,

  onEnter() {
    this.catalogue = null;
    this.data = null;
    this.error = null;
  },

  // SECTION: period presets → from/to
  range() {
    const d = new Date();
    const fmt = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const today = fmt(d);
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    switch (this.preset) {
      case 'today': return { from: today, to: today };
      case 'yesterday': { const y = fmt(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)); return { from: y, to: y }; }
      case 'week': return { from: fmt(monday), to: today };
      case 'lastMonth': return { from: fmt(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: fmt(new Date(d.getFullYear(), d.getMonth(), 0)) };
      case 'year': return { from: `${d.getFullYear()}-01-01`, to: today };
      case 'custom': return { from: this.from || today, to: this.to || today };
      default: return { from: fmt(new Date(d.getFullYear(), d.getMonth(), 1)), to: today };
    }
  },

  params() {
    const def = this.catalogue?.find((r) => r.key === this.current);
    const p = {};
    if (def?.params.includes('range')) Object.assign(p, this.range());
    if (def?.params.includes('groupBy')) p.groupBy = this.groupBy;
    if (this.current === 'audit' && this.search) p.search = this.search;
    return p;
  },

  async load() {
    try {
      if (!this.catalogue) {
        const res = await Api.get('/reports');
        this.catalogue = res.reports;
        this.canExport = res.canExport;
        // deep link from elsewhere (e.g. dashboard "view all activity") via #reports?report=audit
        const wanted = Router.hashParams?.get('report');
        if (wanted && this.catalogue.some((r) => r.key === wanted)) {
          this.current = wanted;
          Router.hashParams = null;
        }
        if (!this.catalogue.some((r) => r.key === this.current)) this.current = this.catalogue[0]?.key ?? null;
      }
      if (this.current) {
        this.loadingReport = true;
        this.data = await Api.get(`/reports/${this.current}`, this.params());
      }
      this.error = null;
    } catch (err) {
      this.error = err.message;
    }
    this.loadingReport = false;
    if (Router.currentPage === 'reports') Router.refresh();
  },

  rerun() {
    this.data = null;
    this.error = null;
    Router.refresh();
  },

  select(key) {
    this.current = key;
    this.rerun();
  },

  setPreset(p) {
    this.preset = p;
    this.rerun();
  },

  applyCustom() {
    this.from = document.getElementById('rep-from').value;
    this.to = document.getElementById('rep-to').value;
    if (!this.from || !this.to || this.from > this.to) return Utils.toast('Choose a valid date range', 'error');
    this.setPreset('custom');
  },

  // SECTION: cell formatting by column type
  fmt(value, type) {
    if (value === null || value === undefined || value === '') return '<span class="text-outline">—</span>';
    switch (type) {
      case 'money': return Utils.formatCurrency(value);
      case 'liters': return `${Utils.formatNumber(value, Number(value) % 1 ? 1 : 0)} L`;
      case 'percent': return `${Number(value).toFixed(1)}%`;
      case 'number': return Utils.formatNumber(value, Number(value) % 1 ? 2 : 0);
      default: return Utils.escapeHtml(value);
    }
  },

  render() {
    const header = `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Reports</h2>
          <p class="text-body-md text-outline mt-1">Sales, stock, customers, finance and staff — export to Excel or print to PDF</p>
        </div>
      </div>`;
    if (this.error && !this.catalogue) return header + Utils.errorState(this.error, 'ReportsPage.onEnter(); Router.refresh()');
    if (!this.catalogue) return header + Utils.loadingState('Loading reports...');
    if (!this.catalogue.length) return header + '<div class="page-section text-outline">No reports are available for your role.</div>';

    const def = this.catalogue.find((r) => r.key === this.current);
    const groups = {};
    this.catalogue.forEach((r) => (groups[r.category] ||= []).push(r));
    const nav = `
      <div class="lg:hidden mb-4">
        <select class="form-select" onchange="ReportsPage.select(this.value)">
          ${Object.entries(groups).map(([g, list]) => `<optgroup label="${Utils.escapeHtml(g)}">${list.map((r) => `<option value="${r.key}" ${r.key === this.current ? 'selected' : ''}>${Utils.escapeHtml(r.title)}</option>`).join('')}</optgroup>`).join('')}
        </select>
      </div>
      <aside class="hidden lg:block w-60 shrink-0 space-y-4">
        ${Object.entries(groups).map(([g, list]) => `
          <div><p class="text-label-sm text-outline mb-1 px-2">${Utils.escapeHtml(g.toUpperCase())}</p>
          ${list.map((r) => `<button onclick="ReportsPage.select('${r.key}')" class="w-full text-left px-3 py-2 rounded-lg text-sm ${r.key === this.current ? 'bg-primary text-on-primary font-semibold' : 'hover:bg-surface-container-low'}">${Utils.escapeHtml(r.title)}</button>`).join('')}</div>`).join('')}
      </aside>`;

    const r = this.range();
    const controls = `
      <div class="flex flex-wrap items-center gap-2 mb-4">
        ${def.params.includes('range') ? `
          ${[['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This Week'], ['month', 'This Month'], ['lastMonth', 'Last Month'], ['year', 'This Year'], ['custom', 'Custom']].map(([k, l]) => `
            <button onclick="ReportsPage.setPreset('${k}')" class="px-3 py-1.5 text-label-sm rounded-full ${this.preset === k ? 'bg-primary text-on-primary' : 'border border-outline-variant hover:bg-surface-container-low'}">${l}</button>`).join('')}
          ${this.preset === 'custom' ? `<input id="rep-from" type="date" class="form-input w-auto py-1" value="${r.from}"/><span class="text-outline">to</span><input id="rep-to" type="date" class="form-input w-auto py-1" value="${r.to}"/>
            <button onclick="ReportsPage.applyCustom()" class="px-3 py-1.5 bg-secondary text-on-secondary rounded-lg text-label-sm font-semibold">Apply</button>` : ''}` : '<span class="text-sm text-outline">Current balances (no date range)</span>'}
        ${def.params.includes('groupBy') ? `<select class="form-select w-auto py-1" onchange="ReportsPage.groupBy = this.value; ReportsPage.rerun()">
          ${[['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Annual']].map(([k, l]) => `<option value="${k}" ${this.groupBy === k ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
        ${this.current === 'audit' ? `<input id="rep-search" type="search" placeholder="Search action or details, Enter" class="form-input w-auto py-1" value="${Utils.escapeHtml(this.search)}"/>` : ''}
        <div class="flex gap-2 ml-auto">
          ${this.canExport ? `
            <button onclick="ReportsPage.download('xlsx')" class="px-3 py-1.5 border border-outline-variant rounded-lg text-sm hover:bg-surface-container-low flex items-center gap-1"><span class="material-symbols-outlined text-base">table_view</span> Excel</button>
            <button onclick="ReportsPage.download('csv')" class="px-3 py-1.5 border border-outline-variant rounded-lg text-sm hover:bg-surface-container-low">CSV</button>` : ''}
          <button onclick="ReportsPage.print()" class="px-3 py-1.5 border border-outline-variant rounded-lg text-sm hover:bg-surface-container-low flex items-center gap-1"><span class="material-symbols-outlined text-base">print</span> Print / PDF</button>
        </div>
      </div>`;

    let body;
    if (this.error) body = Utils.errorState(this.error, 'ReportsPage.rerun()');
    else if (!this.data) body = Utils.loadingState('Running report...');
    else body = this.renderResult(this.data);

    return header + `<div class="flex flex-col lg:flex-row gap-6">${nav}<div class="flex-1 min-w-0">${controls}${body}</div></div>`;
  },

  renderResult(d) {
    const summary = d.summary?.length ? `<div class="grid grid-cols-2 md:grid-cols-${Math.min(5, d.summary.length)} gap-3 mb-4">${d.summary.map((s) => `
      <div class="page-section !p-3"><p class="text-label-sm text-outline">${Utils.escapeHtml(s.label.toUpperCase())}</p><p class="font-semibold text-data-mono">${this.fmt(s.value, s.type)}</p></div>`).join('')}</div>` : '';
    const chart = d.chart && d.rows.length > 1 ? this.renderChart(d) : '';
    const head = d.columns.map((c) => `<th class="${['money', 'liters', 'number', 'percent'].includes(c.type) ? 'text-right' : ''}">${Utils.escapeHtml(c.label)}</th>`).join('');
    const rows = d.rows.map((row) => `<tr class="${row.bold ? 'font-semibold' : ''}">${d.columns.map((c) => `<td class="${['money', 'liters', 'number', 'percent'].includes(c.type) ? 'text-right text-data-mono whitespace-nowrap' : ''}">${this.fmt(row[c.key], c.type)}</td>`).join('')}</tr>`).join('');
    const totals = d.totals ? `<tr class="font-semibold border-t-2 border-outline-variant">${d.columns.map((c, i) => `<td class="${['money', 'liters', 'number', 'percent'].includes(c.type) ? 'text-right text-data-mono whitespace-nowrap' : ''}">${i === 0 && d.totals[c.key] === undefined ? 'Total' : d.totals[c.key] !== undefined ? this.fmt(d.totals[c.key], c.type) : ''}</td>`).join('')}</tr>` : '';
    return `
      <div class="flex flex-wrap justify-between items-baseline gap-2 mb-3">
        <h3 class="text-headline-md font-headline-md">${Utils.escapeHtml(d.title)}</h3>
        <span class="text-label-sm text-outline">${d.meta.from ? `${Utils.formatDate(d.meta.from)} – ${Utils.formatDate(d.meta.to)} · ` : ''}${Utils.escapeHtml(d.meta.station)} · ${d.rows.length} row(s)</span>
      </div>
      ${summary}${chart}
      <div class="page-section !p-0 overflow-x-auto">
        ${d.rows.length ? `<table class="data-table w-full text-sm"><thead><tr>${head}</tr></thead><tbody>${rows}${totals}</tbody></table>` : '<p class="p-8 text-center text-outline">No data for this period</p>'}
      </div>
      ${d.note ? `<p class="text-xs text-outline mt-2">${Utils.escapeHtml(d.note)}</p>` : ''}`;
  },

  // SECTION: simple bar chart for reports that declare one
  renderChart(d) {
    const { x, y, label } = d.chart;
    const rows = d.rows.slice(0, 31);
    const max = Math.max(...rows.map((r) => Number(r[y]) || 0), 1);
    const col = d.columns.find((c) => c.key === y);
    return `<div class="page-section mb-4">
      <p class="text-label-sm text-outline mb-3">${Utils.escapeHtml(label.toUpperCase())}${d.rows.length > 31 ? ' (first 31)' : ''}</p>
      <div class="h-40 flex items-end gap-1">
        ${rows.map((r) => `<div class="flex-1 h-full flex flex-col justify-end items-center min-w-0" title="${Utils.escapeHtml(String(r[x]))}: ${this.fmt(r[y], col?.type).replace(/<[^>]+>/g, '')}">
          <div class="w-full bg-secondary/70 hover:bg-secondary rounded-t-sm" style="height:${Math.max(1, ((Number(r[y]) || 0) / max) * 100)}%"></div>
          <span class="text-[9px] text-outline mt-1 truncate w-full text-center">${Utils.escapeHtml(String(r[x]).slice(-5))}</span></div>`).join('')}
      </div></div>`;
  },

  afterRender() {
    if ((!this.catalogue || (this.current && !this.data)) && !this.error && !this.loadingReport) this.load();
    document.getElementById('rep-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.search = e.target.value.trim();
        this.rerun();
      }
    });
  },

  // SECTION: Excel/CSV download — fetched (so errors show as toasts) then saved as a file
  async download(format) {
    const qs = new URLSearchParams({ ...this.params(), format }).toString();
    try {
      const res = await fetch(`/api/reports/${this.current}?${qs}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'fuelflow' } });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Export failed (${res.status})`);
      }
      const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || `${this.current}.${format}`;
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      Utils.toast(`${format === 'xlsx' ? 'Excel' : 'CSV'} file downloaded`, 'success');
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  },

  // SECTION: print → the browser's "Save as PDF" gives the PDF export
  print() {
    const d = this.data;
    if (!d) return;
    const num = (t) => ['money', 'liters', 'number', 'percent'].includes(t);
    const cell = (v, t) => this.fmt(v, t).replace('<span class="text-outline">—</span>', '—');
    Billing.print(Billing.docShell(d.title, `
      <div class="head">${Billing.brandBlock()}<div class="right"><h2>${Utils.escapeHtml(d.title.toUpperCase())}</h2>
        <div class="muted">${d.meta.from ? `${Utils.formatDate(d.meta.from)} – ${Utils.formatDate(d.meta.to)}` : `As of ${Utils.formatDate(d.meta.generatedAt)}`}</div>
        <div class="muted">${Utils.escapeHtml(d.meta.station)}</div></div></div>
      ${d.summary?.length ? `<p>${d.summary.map((s) => `<strong>${Utils.escapeHtml(s.label)}:</strong> ${cell(s.value, s.type)}`).join(' &nbsp;·&nbsp; ')}</p>` : ''}
      <table><thead><tr>${d.columns.map((c) => `<th class="${num(c.type) ? 'num' : ''}">${Utils.escapeHtml(c.label)}</th>`).join('')}</tr></thead><tbody>
        ${d.rows.map((r) => `<tr${r.bold ? ' style="font-weight:700"' : ''}>${d.columns.map((c) => `<td class="${num(c.type) ? 'num' : ''}">${cell(r[c.key], c.type)}</td>`).join('')}</tr>`).join('')}
        ${d.totals ? `<tr style="font-weight:700">${d.columns.map((c, i) => `<td class="${num(c.type) ? 'num' : ''}">${i === 0 && d.totals[c.key] === undefined ? 'Total' : d.totals[c.key] !== undefined ? cell(d.totals[c.key], c.type) : ''}</td>`).join('')}</tr>` : ''}
      </tbody></table>
      ${d.note ? `<p class="muted">${Utils.escapeHtml(d.note)}</p>` : ''}
      <p class="muted">Generated ${new Date(d.meta.generatedAt).toLocaleString()} by ${Utils.escapeHtml(d.meta.generatedBy)}</p>`));
  },
};

/**
 * Dashboard Page
 */
// SECTION: Dashboard page object — KPIs, stock, charts, and activity from /api/dashboard/summary
const DashboardPage = {
  // SECTION: period filter state; preset is one of today | 7d | 30d | month | custom
  preset: '30d',
  from: '',
  to: '',
  data: null,
  error: null,

  // SECTION: onEnter — fresh data on every visit
  onEnter() {
    this.data = null;
    this.error = null;
  },

  // SECTION: resolves the preset into from/to (YYYY-MM-DD) for the API
  range() {
    const today = Utils.today();
    const shift = (days) => {
      const d = new Date();
      d.setDate(d.getDate() - days);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    switch (this.preset) {
      case 'today': return { from: today, to: today };
      case '7d': return { from: shift(6), to: today };
      case 'month': return { from: today.slice(0, 8) + '01', to: today };
      case 'custom': return { from: this.from || shift(29), to: this.to || today };
      default: return { from: shift(29), to: today };
    }
  },

  async load() {
    try {
      this.data = await Api.get('/dashboard/summary', this.range());
      this.error = null;
    } catch (err) {
      this.error = err.message;
    }
    if (Router.currentPage === 'dashboard') Router.refresh();
  },

  setPreset(preset) {
    this.preset = preset;
    this.onEnter();
    Router.refresh();
  },

  applyCustom() {
    this.from = document.getElementById('dash-from')?.value || '';
    this.to = document.getElementById('dash-to')?.value || '';
    if (this.from && this.to && this.from > this.to) return Utils.toast('"From" must be before "To"', 'error');
    this.setPreset('custom');
  },

  // SECTION: compact number for large KPI values (12.4k, 1.2M)
  compact(n) {
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + 'k';
    return Utils.formatNumber(n);
  },

  // SECTION: period filter bar
  renderFilters() {
    const presets = [['today', 'Today'], ['7d', '7 Days'], ['30d', '30 Days'], ['month', 'This Month'], ['custom', 'Custom']];
    const r = this.range();
    return `
      <div class="flex flex-wrap items-center gap-2 mb-6">
        ${presets.map(([key, label]) => `
          <button onclick="DashboardPage.setPreset('${key}')" class="px-4 py-1.5 text-label-sm font-label-sm rounded-full transition-colors ${this.preset === key ? 'bg-primary text-on-primary' : 'border border-outline-variant hover:bg-surface-container-low'}">${label}</button>`).join('')}
        ${this.preset === 'custom' ? `
          <div class="flex flex-wrap items-center gap-2">
            <input id="dash-from" type="date" class="form-input w-auto py-1" value="${r.from}"/>
            <span class="text-outline">to</span>
            <input id="dash-to" type="date" class="form-input w-auto py-1" value="${r.to}"/>
            <button onclick="DashboardPage.applyCustom()" class="px-3 py-1.5 bg-secondary text-on-secondary rounded-lg text-label-sm font-semibold">Apply</button>
          </div>` : ''}
        ${this.data ? `<span class="text-label-sm text-outline ml-auto">${Utils.formatDate(this.data.range.from)} – ${Utils.formatDate(this.data.range.to)}${this.data.scope.ownSalesOnly ? ' · your sales only' : ''}</span>` : ''}
      </div>`;
  },

  kpi(label, value, sub, icon, accent = 'text-primary') {
    return `
      <div class="bg-surface-container-lowest border border-outline-variant p-card-padding rounded-xl flex flex-col justify-between min-w-0">
        <div class="flex justify-between items-start gap-2">
          <span class="text-label-sm font-label-sm text-outline uppercase">${label}</span>
          <span class="material-symbols-outlined ${accent}">${icon}</span>
        </div>
        <div class="text-headline-lg font-headline-lg mt-2 truncate">${value}</div>
        <span class="text-body-md text-outline mt-1">${sub}</span>
      </div>`;
  },

  // SECTION: render — loading/error states, then the bento layout
  render() {
    const filters = this.renderFilters();
    if (this.error) return filters + Utils.errorState(this.error, 'DashboardPage.setPreset(DashboardPage.preset)');
    if (!this.data) return filters + Utils.loadingState('Loading dashboard...');

    const d = this.data;
    const money = (v) => Utils.formatCurrency(v);

    // SECTION: KPI cards — finance/receivable cards only appear when the API returned them (permission-based)
    const kpis = [
      this.kpi('Revenue', money(d.sales.netRevenue), d.sales.refunds ? `${money(d.sales.refunds)} refunded` : 'Net of refunds', 'payments', 'text-secondary'),
      this.kpi('Fuel Sold', `${this.compact(d.sales.litersSold)} L`, 'Liters dispensed', 'local_gas_station'),
      this.kpi('Transactions', Utils.formatNumber(d.sales.transactions), 'Sales in period', 'receipt_long'),
      this.kpi('Fuel Purchased', `${this.compact(d.purchases.liters)} L`, `${money(d.purchases.cost)} delivered`, 'local_shipping'),
      this.kpi('Customers', Utils.formatNumber(d.customers.total), `${d.customers.newInPeriod} new in period`, 'groups'),
      d.receivables ? this.kpi('Outstanding', money(d.receivables.outstanding), `${d.receivables.openInvoices} open invoice(s)`, 'account_balance_wallet', 'text-tertiary-fixed-dim') : '',
      d.finance ? this.kpi('Expenses', money(d.finance.expenses), 'Approved in period', 'receipt', 'text-error') : '',
      d.finance ? this.kpi('Net Profit (est.)', money(d.finance.netProfit), `Gross ${money(d.finance.grossProfit)}`, 'trending_up', d.finance.netProfit >= 0 ? 'text-secondary' : 'text-error') : '',
    ].filter(Boolean).join('');

    // SECTION: stock bars — every tank, red when at/below its minimum level
    const stockBars = d.stock.length ? d.stock.map((t) => `
      <div>
        <div class="flex justify-between mb-2 gap-2">
          <span class="text-body-md font-semibold truncate">${Utils.escapeHtml(t.product)} <span class="text-outline font-normal">· ${Utils.escapeHtml(t.tankCode)}</span></span>
          <span class="text-data-mono font-data-mono whitespace-nowrap ${t.low ? 'text-error' : ''}">${t.percent}% (${Utils.formatNumber(t.liters)}L)</span>
        </div>
        <div class="h-2 bg-surface-container rounded-full overflow-hidden">
          <div class="h-full ${t.low ? 'bg-error' : 'bg-secondary'} transition-all duration-500" style="width: ${Math.min(100, t.percent)}%"></div>
        </div>
      </div>`).join('') : '<p class="text-outline text-sm">No tanks configured yet.</p>';

    const monthProgress = d.targetRevenue ? Math.min(100, (d.sales.thisMonth.revenue / d.targetRevenue) * 100) : 0;

    // SECTION: recent transactions table
    const statusType = { PAID: 'success', PARTIALLY_PAID: 'warning', UNPAID: 'danger', REFUNDED: 'neutral', CANCELLED: 'neutral' };
    const txRows = d.recentTransactions.map((t) => `
      <tr>
        <td class="font-semibold text-data-mono">${Utils.escapeHtml(t.saleNo)}</td>
        <td>${Utils.escapeHtml(t.customer)}</td>
        <td>${Utils.escapeHtml(t.products.join(', '))}</td>
        <td class="text-data-mono">${Utils.formatNumber(t.liters, 1)} L</td>
        <td class="text-data-mono font-semibold">${money(t.total)}</td>
        <td>${t.invoiceStatus ? Utils.badge(t.invoiceStatus.replace('_', ' '), statusType[t.invoiceStatus]) : Utils.badge(t.status, 'neutral')}</td>
        <td>${Utils.formatDateTime(t.date)}</td>
      </tr>`);

    return filters + `
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">${kpis}</div>

      <div class="bento-grid mb-8">
        <div class="col-span-12 lg:col-span-4 bg-surface-container-lowest border border-outline-variant p-card-padding rounded-xl">
          <div class="flex justify-between items-center mb-6">
            <h3 class="text-label-sm font-label-sm text-outline uppercase tracking-wider">Fuel In Stock</h3>
            <span class="material-symbols-outlined text-primary">local_gas_station</span>
          </div>
          <div class="space-y-6">${stockBars}</div>
        </div>

        <div class="col-span-12 md:col-span-6 lg:col-span-4 bg-primary-container p-4 sm:p-card-padding rounded-xl text-on-primary flex flex-col justify-between">
          <div class="flex justify-between gap-2">
            <div class="min-w-0">
              <span class="text-label-sm font-label-sm text-primary-fixed/60">SALES TODAY</span>
              <div class="text-display-metrics font-display-metrics mt-1 truncate">${money(d.sales.today.revenue)}</div>
              <span class="text-label-sm text-primary-fixed/60">${d.sales.today.transactions} transaction(s)</span>
            </div>
            <span class="material-symbols-outlined text-primary-fixed text-3xl sm:text-4xl shrink-0">payments</span>
          </div>
          <div class="mt-6 grid grid-cols-2 gap-4">
            <div>
              <span class="text-label-sm font-label-sm text-primary-fixed/60 block">LAST 7 DAYS</span>
              <span class="text-headline-md font-headline-md">${money(d.sales.last7Days.revenue)}</span>
            </div>
            <div>
              <span class="text-label-sm font-label-sm text-primary-fixed/60 block">THIS MONTH</span>
              <span class="text-headline-md font-headline-md">${money(d.sales.thisMonth.revenue)}</span>
            </div>
          </div>
          ${d.targetRevenue ? `
          <div class="mt-4">
            <div class="flex justify-between text-label-sm text-primary-fixed/60"><span>MONTHLY TARGET</span><span>${Math.round(monthProgress)}%</span></div>
            <div class="h-1.5 w-full bg-on-primary-fixed-variant mt-2 rounded-full">
              <div class="h-full bg-secondary-fixed-dim rounded-full" style="width: ${monthProgress}%"></div>
            </div>
          </div>` : ''}
        </div>

        <div class="col-span-12 md:col-span-6 lg:col-span-4 bg-surface-container-lowest border border-outline-variant p-card-padding rounded-xl flex flex-col">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-label-sm font-label-sm text-outline uppercase tracking-wider">Low Stock Alerts</h3>
            <span class="material-symbols-outlined ${d.lowStock.length ? 'text-error' : 'text-secondary'}">${d.lowStock.length ? 'warning' : 'check_circle'}</span>
          </div>
          ${d.lowStock.length ? `<div class="space-y-3">${d.lowStock.map((t) => `
            <div class="p-3 rounded-lg bg-error-container/40 border border-error/20">
              <p class="font-semibold text-sm">${Utils.escapeHtml(t.product)} · ${Utils.escapeHtml(t.tankCode)}</p>
              <p class="text-xs text-outline">${Utils.formatNumber(t.liters)} L left · minimum ${Utils.formatNumber(t.minLevel)} L</p>
            </div>`).join('')}</div>`
            : '<p class="text-body-md text-outline">All tanks are above their minimum levels.</p>'}
          ${d.fleet ? `
          <div class="mt-auto pt-6 border-t border-outline-variant mt-6">
            <div class="flex justify-between items-center">
              <span class="text-label-sm text-outline">FLEET</span>
              <span class="text-body-md"><strong>${d.fleet.active}</strong> active · ${d.fleet.maintenance} in maintenance</span>
            </div>
          </div>` : ''}
        </div>
      </div>

      <div class="bento-grid mb-8">
        <div class="col-span-12 lg:col-span-8 bg-surface-container-lowest border border-outline-variant p-card-padding rounded-xl">
          <div class="mb-6">
            <h3 class="text-headline-md font-headline-md">Sales Performance</h3>
            <p class="text-body-md text-outline">Daily revenue for the selected period</p>
          </div>
          <div class="chart-container flex items-end gap-1 px-2 pb-2 border-l border-b border-outline-variant/30" id="sales-chart"></div>
          <div class="flex justify-between text-[10px] text-outline mt-2 px-2" id="sales-chart-axis"></div>
        </div>

        <div class="col-span-12 lg:col-span-4 bg-surface-container-lowest border border-outline-variant p-card-padding rounded-xl">
          <h3 class="text-label-sm font-label-sm text-outline mb-6">LITERS PURCHASED VS SOLD</h3>
          <div class="h-48 flex items-end gap-3 justify-between" id="purchase-sales-chart"></div>
          <div class="mt-4 flex gap-4">
            <div class="flex items-center gap-2"><div class="w-3 h-3 bg-primary"></div><span class="text-label-sm text-outline">Purchased</span></div>
            <div class="flex items-center gap-2"><div class="w-3 h-3 bg-secondary"></div><span class="text-label-sm text-outline">Sold</span></div>
          </div>
        </div>
      </div>

      <div class="bento-grid">
        <div class="col-span-12 ${d.activity ? 'lg:col-span-8' : ''} bg-surface-container-lowest border border-outline-variant p-card-padding rounded-xl min-w-0">
          <h3 class="text-headline-md font-headline-md mb-4">Recent Transactions</h3>
          ${Utils.renderDataTable(['Sale #', 'Customer', 'Fuel', 'Liters', 'Total', 'Status', 'Date'], txRows, 'No sales recorded yet')}
        </div>
        ${d.activity ? `
        <div class="col-span-12 lg:col-span-4 bg-surface-container-lowest border border-outline-variant rounded-xl flex flex-col">
          <div class="p-card-padding border-b border-outline-variant flex justify-between items-center gap-2">
            <h3 class="text-headline-md font-headline-md">Recent Activity</h3>
            <button onclick="Router.go('reports?report=audit')" class="text-label-sm font-label-sm text-primary hover:underline">VIEW ALL</button>
          </div>
          <div class="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
            ${d.activity.map((a) => `
              <div class="p-3 hover:bg-surface-container-low transition-colors rounded-lg">
                <p class="text-body-md font-semibold text-on-surface">${Utils.escapeHtml(a.details || a.action)}</p>
                <p class="text-label-sm text-outline">${Utils.escapeHtml(a.user)} · ${Utils.formatDateTime(a.at)}</p>
              </div>`).join('') || '<p class="p-4 text-outline">No activity yet</p>'}
          </div>
        </div>` : ''}
      </div>
    `;
  },

  // SECTION: afterRender — first load, then charts once data is present
  afterRender() {
    if (!this.data && !this.error) return this.load();
    if (this.data) {
      this.renderSalesChart();
      this.renderPurchaseSalesChart();
    }
  },

  // SECTION: renderSalesChart — one bar per day, height relative to the busiest day; hover shows the value
  renderSalesChart() {
    const container = document.getElementById('sales-chart');
    const axis = document.getElementById('sales-chart-axis');
    if (!container) return;
    const series = this.data.series;
    const max = Math.max(...series.map((s) => s.revenue), 0);
    if (!max) {
      container.innerHTML = '<p class="m-auto text-outline text-sm">No sales in this period</p>';
      if (axis) axis.innerHTML = '';
      return;
    }
    container.innerHTML = series.map((s) => `
      <div class="flex-1 h-full flex items-end min-w-0" title="${Utils.formatDate(s.day)}: ${Utils.formatCurrency(s.revenue)}">
        <div class="w-full bg-secondary/70 hover:bg-secondary rounded-t-sm transition-colors" style="height: ${Math.max(2, (s.revenue / max) * 100)}%"></div>
      </div>`).join('');
    // label the first, middle, and last day
    if (axis) {
      const pick = [0, Math.floor(series.length / 2), series.length - 1].filter((v, i, a) => a.indexOf(v) === i);
      axis.innerHTML = pick.map((i) => `<span>${Utils.formatDate(series[i].day)}</span>`).join('');
    }
  },

  // SECTION: renderPurchaseSalesChart — period split into up to 6 buckets, liters purchased vs sold
  renderPurchaseSalesChart() {
    const container = document.getElementById('purchase-sales-chart');
    if (!container) return;
    const series = this.data.series;
    const bucketCount = Math.min(6, series.length);
    const size = Math.ceil(series.length / bucketCount);
    const buckets = [];
    for (let i = 0; i < series.length; i += size) {
      const chunk = series.slice(i, i + size);
      buckets.push({
        label: chunk.length > 1 ? `${chunk[0].day.slice(5)}` : chunk[0].day.slice(5),
        p: chunk.reduce((s, c) => s + c.litersPurchased, 0),
        s: chunk.reduce((s, c) => s + c.litersSold, 0),
      });
    }
    const max = Math.max(...buckets.map((b) => Math.max(b.p, b.s)), 0);
    if (!max) {
      container.innerHTML = '<p class="m-auto text-outline text-sm">No fuel movement in this period</p>';
      return;
    }
    container.innerHTML = buckets.map((b) => `
      <div class="flex-1 h-full flex flex-col items-center justify-end">
        <div class="w-full flex-1 flex justify-center items-end gap-1">
          <div class="w-2.5 bg-primary rounded-t-sm" style="height: ${(b.p / max) * 100}%" title="Purchased: ${Utils.formatNumber(b.p)} L"></div>
          <div class="w-2.5 bg-secondary rounded-t-sm" style="height: ${(b.s / max) * 100}%" title="Sold: ${Utils.formatNumber(b.s)} L"></div>
        </div>
        <span class="text-[10px] text-outline mt-2">${b.label}</span>
      </div>`).join('');
  },
};

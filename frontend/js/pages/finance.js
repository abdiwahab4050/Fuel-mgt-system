/**
 * Finance Page
 */
// SECTION: Finance page object — profit & loss, cash flow, receivables/payables aging, 12-month trend
const FinancePage = {
  preset: 'month',
  from: '',
  to: '',
  data: null,
  error: null,

  onEnter() {
    this.data = null;
    this.error = null;
  },

  // SECTION: period presets → from/to (YYYY-MM-DD)
  range() {
    const d = new Date();
    const fmt = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const today = fmt(d);
    switch (this.preset) {
      case 'lastMonth': return { from: fmt(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: fmt(new Date(d.getFullYear(), d.getMonth(), 0)) };
      case 'quarter': return { from: fmt(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)), to: today };
      case 'year': return { from: `${d.getFullYear()}-01-01`, to: today };
      case 'custom': return { from: this.from || today, to: this.to || today };
      default: return { from: fmt(new Date(d.getFullYear(), d.getMonth(), 1)), to: today };
    }
  },

  async load() {
    try {
      this.data = await Api.get('/finance/summary', this.range());
      this.error = null;
    } catch (err) {
      this.error = err.message;
    }
    if (Router.currentPage === 'finance') Router.refresh();
  },

  setPreset(p) {
    this.preset = p;
    this.onEnter();
    Router.refresh();
  },

  applyCustom() {
    this.from = document.getElementById('fin-from').value;
    this.to = document.getElementById('fin-to').value;
    if (!this.from || !this.to || this.from > this.to) return Utils.toast('Choose a valid date range', 'error');
    this.setPreset('custom');
  },

  render() {
    const r = this.range();
    const header = `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Finance</h2>
          <p class="text-body-md text-outline mt-1">Profit &amp; loss, cash flow, money owed to and by the station</p>
        </div>
        ${this.data ? '<button onclick="FinancePage.print()" class="px-4 py-2 border border-outline-variant rounded-lg text-body-md hover:bg-surface-container-low flex items-center gap-2"><span class="material-symbols-outlined text-lg">print</span> Print P&amp;L</button>' : ''}
      </div>
      <div class="flex flex-wrap items-center gap-2 mb-6">
        ${[['month', 'This Month'], ['lastMonth', 'Last Month'], ['quarter', 'This Quarter'], ['year', 'Year to Date'], ['custom', 'Custom']].map(([k, l]) => `
          <button onclick="FinancePage.setPreset('${k}')" class="px-4 py-1.5 text-label-sm font-label-sm rounded-full ${this.preset === k ? 'bg-primary text-on-primary' : 'border border-outline-variant hover:bg-surface-container-low'}">${l}</button>`).join('')}
        ${this.preset === 'custom' ? `<input id="fin-from" type="date" class="form-input w-auto py-1" value="${r.from}"/><span class="text-outline">to</span><input id="fin-to" type="date" class="form-input w-auto py-1" value="${r.to}"/>
          <button onclick="FinancePage.applyCustom()" class="px-3 py-1.5 bg-secondary text-on-secondary rounded-lg text-label-sm font-semibold">Apply</button>` : ''}
        <span class="text-label-sm text-outline ml-auto">${Utils.formatDate(r.from)} – ${Utils.formatDate(r.to)}</span>
      </div>`;
    if (this.error) return header + Utils.errorState(this.error, "FinancePage.setPreset(FinancePage.preset)");
    if (!this.data) return header + Utils.loadingState('Calculating...');

    const { pnl, cash, receivables, payables, trend } = this.data;
    const money = (v) => Utils.formatCurrency(v);
    const kpi = (label, value, sub, cls = '') => `<div class="page-section"><span class="text-label-sm text-outline">${label}</span><div class="text-headline-lg font-headline-lg mt-1 ${cls}">${value}</div><span class="text-sm text-outline">${sub}</span></div>`;
    const line = (label, value, opts = {}) => `<div class="flex justify-between py-1.5 ${opts.total ? 'border-t border-outline-variant font-semibold' : ''} ${opts.indent ? 'pl-4 text-outline' : ''}"><span>${label}</span><span class="text-data-mono ${opts.cls || ''}">${value}</span></div>`;
    const aging = (a, title) => `
      <div class="page-section">
        <div class="flex justify-between items-baseline mb-3"><h3 class="text-headline-md">${title}</h3><span class="text-headline-md font-headline-md">${money(a.total)}</span></div>
        <div class="grid grid-cols-5 gap-2 mb-4 text-center">
          ${Object.entries(a.buckets).map(([k, v]) => `<div class="p-2 rounded-lg ${k === 'current' ? 'bg-surface-container-low' : v > 0 ? 'bg-error-container/40' : 'bg-surface-container-low'}"><div class="text-label-sm text-outline">${k === 'current' ? 'Not due' : `${k} days`}</div><div class="text-data-mono text-sm font-semibold">${money(v)}</div></div>`).join('')}
        </div>
        ${a.parties.slice(0, 6).map((p) => `<div class="flex justify-between text-sm py-1.5 border-b border-outline-variant/50"><span>${Utils.escapeHtml(p.name)}${p.overdue > 0 ? ` <span class="text-error text-xs">${money(p.overdue)} overdue · ${p.oldestDays}d</span>` : ''}</span><span class="text-data-mono">${money(p.total)}</span></div>`).join('') || '<p class="text-sm text-outline">Nothing outstanding</p>'}
      </div>`;
    const maxTrend = Math.max(...trend.map((t) => Math.max(t.revenue, t.costOfSales + t.expenses)), 1);

    return header + `
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        ${kpi('REVENUE', money(pnl.revenue), `${pnl.transactions} sales · excl. tax`)}
        ${kpi('GROSS PROFIT', money(pnl.grossProfit), `${pnl.grossMargin}% margin`, pnl.grossProfit >= 0 ? 'text-secondary' : 'text-error')}
        ${kpi('EXPENSES', money(pnl.totalExpenses), `${pnl.expenses.length} categories`)}
        ${kpi('NET PROFIT', money(pnl.netProfit), `${pnl.netMargin}% margin`, pnl.netProfit >= 0 ? 'text-secondary' : 'text-error')}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div class="page-section">
          <h3 class="text-headline-md mb-4">Profit &amp; Loss</h3>
          ${line('Fuel sales (excl. tax)', money(pnl.revenue))}
          ${pnl.discounts ? line('of which discounts given', money(-pnl.discounts), { indent: true }) : ''}
          ${pnl.refunds ? line('Refunds', money(-pnl.refunds)) : ''}
          ${line('Cost of fuel sold', money(-pnl.costOfSales))}
          ${line('Gross profit', money(pnl.grossProfit), { total: true, cls: pnl.grossProfit >= 0 ? 'text-secondary' : 'text-error' })}
          ${pnl.expenses.map((e) => line(Utils.escapeHtml(e.category), money(-e.amount), { indent: true })).join('')}
          ${line('Total expenses', money(-pnl.totalExpenses))}
          ${line('Net profit', money(pnl.netProfit), { total: true, cls: pnl.netProfit >= 0 ? 'text-secondary' : 'text-error' })}
          <p class="text-xs text-outline mt-3">Tax collected (${money(pnl.taxCollected)}) is owed to the tax authority and not counted as revenue. Fuel bought in period: ${Utils.formatNumber(pnl.purchases.liters)} L for ${money(pnl.purchases.cost)}.</p>
        </div>
        <div class="page-section">
          <h3 class="text-headline-md mb-4">Cash Flow</h3>
          ${line('Received from customers', money(cash.received))}
          ${cash.receivedByMethod.map((m) => line(Billing.method(m.method), money(m.amount), { indent: true })).join('')}
          ${line('Paid to suppliers', money(-cash.paidToSuppliers))}
          ${line('Expenses paid', money(-cash.expensesPaid))}
          ${cash.refundsPaid ? line('Refunds paid', money(-cash.refundsPaid)) : ''}
          ${line('Net cash flow', money(cash.net), { total: true, cls: cash.net >= 0 ? 'text-secondary' : 'text-error' })}
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        ${aging(receivables, 'Owed to us (receivables)')}
        ${aging(payables, 'We owe (payables)')}
      </div>

      <div class="page-section">
        <h3 class="text-headline-md mb-1">12-Month Trend</h3>
        <div class="flex gap-4 mb-4 text-label-sm text-outline"><span class="flex items-center gap-1"><span class="w-3 h-3 bg-secondary inline-block"></span>Revenue</span><span class="flex items-center gap-1"><span class="w-3 h-3 bg-error/70 inline-block"></span>Costs + expenses</span></div>
        <div class="h-48 flex items-end gap-2">
          ${trend.map((t) => `
            <div class="flex-1 h-full flex flex-col justify-end items-center min-w-0" title="${t.month}: revenue ${money(t.revenue)}, net ${money(t.netProfit)}">
              <div class="w-full flex-1 flex items-end justify-center gap-0.5">
                <div class="w-1/2 bg-secondary rounded-t-sm" style="height:${(t.revenue / maxTrend) * 100}%"></div>
                <div class="w-1/2 bg-error/70 rounded-t-sm" style="height:${((t.costOfSales + t.expenses) / maxTrend) * 100}%"></div>
              </div>
              <span class="text-[10px] text-outline mt-1">${t.month.slice(5)}/${t.month.slice(2, 4)}</span>
              <span class="text-[10px] font-semibold ${t.netProfit >= 0 ? 'text-secondary' : 'text-error'}">${t.netProfit >= 0 ? '' : '-'}${Math.abs(t.netProfit) >= 1000 ? (Math.abs(t.netProfit) / 1000).toFixed(1) + 'k' : Math.round(Math.abs(t.netProfit))}</span>
            </div>`).join('')}
        </div>
      </div>`;
  },

  afterRender() {
    if (!this.data && !this.error) this.load();
  },

  // SECTION: printable profit & loss statement (browser print → PDF)
  print() {
    const { pnl, cash, range } = this.data;
    const row = (l, v, b = false) => `<tr${b ? ' class="grand"' : ''}><td>${l}</td><td class="num">${Utils.formatCurrency(v)}</td></tr>`;
    Billing.print(Billing.docShell('Profit and Loss', `
      <div class="head">${Billing.brandBlock()}<div class="right"><h2>PROFIT &amp; LOSS</h2><div class="muted">${Utils.formatDate(range.from)} – ${Utils.formatDate(range.to)}</div></div></div>
      <table class="totals" style="width:100%">
        ${row('Fuel sales (excl. tax)', pnl.revenue)}${pnl.refunds ? row('Refunds', -pnl.refunds) : ''}${row('Cost of fuel sold', -pnl.costOfSales)}
        ${row('Gross profit', pnl.grossProfit, true)}
        ${pnl.expenses.map((e) => row(`&nbsp;&nbsp;${Utils.escapeHtml(e.category)}`, -e.amount)).join('')}
        ${row('Total expenses', -pnl.totalExpenses)}
        ${row('Net profit', pnl.netProfit, true)}
      </table>
      <h3>Cash flow</h3>
      <table class="totals" style="width:100%">
        ${row('Received from customers', cash.received)}${row('Paid to suppliers', -cash.paidToSuppliers)}${row('Expenses paid', -cash.expensesPaid)}${cash.refundsPaid ? row('Refunds paid', -cash.refundsPaid) : ''}
        ${row('Net cash flow', cash.net, true)}
      </table>
      <p class="muted">Tax collected ${Utils.formatCurrency(pnl.taxCollected)} excluded from revenue. Cost of sales uses the cost recorded at the time of each sale. Generated ${new Date().toLocaleString()}.</p>`));
  },
};

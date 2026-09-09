/**
 * Dashboard Page
 */
// SECTION: Dashboard page object — main overview with KPIs, charts, and activity feed; extend widgets or swap mock chart data here
const DashboardPage = {
  // SECTION: render — builds full dashboard HTML from Store data; add/remove bento cards or KPI metrics in this method
  render() {
    // SECTION: load Store data — pulls purchases, sales, vehicles, inventory, fuel types, audit logs, and settings; add new collections here if needed
    const today = Utils.today();
    const purchases = Store.get('purchases');
    const sales = Store.get('sales');
    const vehicles = Store.get('vehicles');
    const inventory = Store.get('inventory');
    const fuelTypes = Store.get('fuelTypes');
    const auditLogs = Store.get('auditLogs');
    const settings = Store.getAll().settings;

    // SECTION: KPI calculations — today/month totals, fleet counts, revenue target progress; adjust formulas or date filters here
    const purchasedToday = purchases.filter((p) => p.purchaseDate === today).reduce((s, p) => s + p.quantity, 0);
    const soldToday = sales.filter((s) => s.date === today).reduce((s, p) => s + p.quantity, 0);
    const revenueToday = sales.filter((s) => s.date === today).reduce((s, p) => s + p.totalAmount, 0);
    const monthStart = today.slice(0, 7);
    const monthlyRevenue = sales.filter((s) => s.date.startsWith(monthStart)).reduce((s, p) => s + p.totalAmount, 0);
    const activeVehicles = vehicles.filter((v) => v.status === 'active').length;
    const totalVehicles = vehicles.length;
    const targetProgress = Math.min(100, (monthlyRevenue / settings.targetRevenue) * 100);

    // SECTION: stock bars — top 3 fuel types with capacity % progress bars; change count, colors, or capacity logic here
    const stockBars = fuelTypes.slice(0, 3).map((ft, i) => {
      const inv = inventory.find((inv) => inv.fuelTypeId === ft.id);
      const qty = inv?.quantity || 0;
      const pct = Math.round((qty / ft.capacity) * 100);
      const colors = ['bg-secondary', 'bg-tertiary-fixed-dim', 'bg-primary-fixed-dim'];
      return `
        <div>
          <div class="flex justify-between mb-2">
            <span class="text-body-md font-semibold">${Utils.escapeHtml(ft.name)}</span>
            <span class="text-data-mono font-data-mono">${pct}% (${Utils.formatNumber(qty)}L)</span>
          </div>
          <div class="h-2 bg-surface-container rounded-full overflow-hidden">
            <div class="h-full ${colors[i % 3]} transition-all duration-500" style="width: ${pct}%"></div>
          </div>
        </div>`;
    }).join('');

    // SECTION: recent activities — maps audit logs to icon-styled feed items; extend icons map or log count here
    const activities = auditLogs.slice(0, 4).map((log) => {
      const icons = {
        'Stock Adjustment': { icon: 'sync_alt', bg: 'bg-secondary-container', color: 'text-on-secondary-container' },
        'Purchase Created': { icon: 'shopping_cart', bg: 'bg-primary-fixed-dim/30', color: 'text-primary' },
        'Low Stock Alert': { icon: 'warning', bg: 'bg-tertiary-fixed-dim/30', color: 'text-tertiary-container' },
        'Fleet Dispatch': { icon: 'local_shipping', bg: 'bg-surface-container-highest', color: 'text-outline' },
      };
      const style = icons[log.action] || { icon: 'info', bg: 'bg-surface-container', color: 'text-outline' };
      return `
        <div class="p-3 hover:bg-surface-container-low transition-colors rounded-lg flex gap-4">
          <div class="w-10 h-10 rounded-full ${style.bg} flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined ${style.color}">${style.icon}</span>
          </div>
          <div>
            <p class="text-body-md font-semibold text-on-surface">${Utils.escapeHtml(log.action)}</p>
            <p class="text-label-sm text-outline">${Utils.escapeHtml(log.details)}</p>
            <p class="text-[11px] text-outline mt-1 uppercase">${Utils.formatDateTime(log.timestamp)}</p>
          </div>
        </div>`;
    }).join('');

    // SECTION: vehicle efficiency aggregation — groups consumption mileage by vehicle type; change grouping or data source here
    const vehicleTypes = {};
    Store.get('consumption').forEach((c) => {
      const v = Store.getById('vehicles', c.vehicleId);
      if (v) {
        if (!vehicleTypes[v.type]) vehicleTypes[v.type] = [];
        vehicleTypes[v.type].push(c.mileage);
      }
    });

    // SECTION: efficiency bars — average L/km per vehicle type with fallback placeholder; tune width scale or default markup here
    const efficiencyBars = Object.entries(vehicleTypes).slice(0, 4).map(([type, mileages]) => {
      const avg = (mileages.reduce((a, b) => a + b, 0) / mileages.length).toFixed(1);
      const width = Math.min(100, (avg / 10) * 100);
      const color = type === 'EV Fleet' ? 'bg-secondary-container' : 'bg-primary';
      return `
        <div class="flex items-center gap-3">
          <span class="w-20 text-label-sm text-outline truncate">${Utils.escapeHtml(type)}</span>
          <div class="flex-1 h-3 bg-surface-container rounded-sm overflow-hidden">
            <div class="h-full ${color}" style="width: ${width}%"></div>
          </div>
          <span class="text-data-mono font-data-mono">${avg}L/km</span>
        </div>`;
    }).join('') || `
      <div class="flex items-center gap-3">
        <span class="w-20 text-label-sm text-outline">Heavy Duty</span>
        <div class="flex-1 h-3 bg-surface-container rounded-sm overflow-hidden"><div class="h-full bg-primary" style="width: 85%"></div></div>
        <span class="text-data-mono font-data-mono">8.2L/km</span>
      </div>`;

    // SECTION: dashboard HTML layout — bento grid with stock, KPIs, fleet, charts placeholders; restructure sections or links here
    return `
      <div class="bento-grid mb-8">
        <div class="col-span-12 lg:col-span-4 bg-surface-container-lowest border border-outline-variant p-card-padding rounded-xl">
          <div class="flex justify-between items-center mb-6">
            <h3 class="text-label-sm font-label-sm text-outline uppercase tracking-wider">Total Fuel In Stock</h3>
            <span class="material-symbols-outlined text-primary">local_gas_station</span>
          </div>
          <div class="space-y-6">${stockBars}</div>
        </div>

        <div class="col-span-12 md:col-span-6 lg:col-span-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="bg-surface-container-lowest border border-outline-variant p-card-padding rounded-xl flex flex-col justify-between">
            <div>
              <span class="text-label-sm font-label-sm text-outline">PURCHASED TODAY</span>
              <div class="text-display-metrics font-display-metrics mt-2">${purchasedToday >= 1000 ? (purchasedToday / 1000).toFixed(1) + 'k' : purchasedToday}</div>
              <span class="text-label-sm font-label-sm text-secondary-container bg-secondary/10 px-2 py-1 rounded inline-flex items-center gap-1 mt-2">
                <span class="material-symbols-outlined text-sm">trending_up</span>+14%
              </span>
            </div>
            <span class="text-body-md text-outline mt-4">Liters Inbound</span>
          </div>
          <div class="bg-surface-container-lowest border border-outline-variant p-card-padding rounded-xl flex flex-col justify-between">
            <div>
              <span class="text-label-sm font-label-sm text-outline">SOLD TODAY</span>
              <div class="text-display-metrics font-display-metrics mt-2">${soldToday >= 1000 ? (soldToday / 1000).toFixed(1) + 'k' : soldToday}</div>
              <span class="text-label-sm font-label-sm text-error bg-error/10 px-2 py-1 rounded inline-flex items-center gap-1 mt-2">
                <span class="material-symbols-outlined text-sm">trending_down</span>-2.4%
              </span>
            </div>
            <span class="text-body-md text-outline mt-4">Liters Dispatched</span>
          </div>
          <div class="col-span-1 sm:col-span-2 bg-primary-container p-4 sm:p-card-padding rounded-xl text-on-primary">
            <div class="flex justify-between gap-2">
              <div class="min-w-0">
                <span class="text-label-sm font-label-sm text-primary-fixed/60">REVENUE TODAY</span>
                <div class="text-display-metrics font-display-metrics mt-1 truncate">${Utils.formatCurrency(revenueToday)}</div>
              </div>
              <span class="material-symbols-outlined text-primary-fixed text-3xl sm:text-4xl shrink-0">payments</span>
            </div>
            <div class="mt-4 flex flex-col sm:flex-row gap-4">
              <div class="flex-1">
                <span class="text-label-sm font-label-sm text-primary-fixed/60 block">MONTH TO DATE</span>
                <span class="text-headline-md font-headline-md">${monthlyRevenue >= 1000000 ? Utils.formatCurrency(monthlyRevenue).replace('.00', 'M').replace('$', '$') : Utils.formatCurrency(monthlyRevenue)}</span>
              </div>
              <div class="flex-1">
                <span class="text-label-sm font-label-sm text-primary-fixed/60 block">TARGET PROGRESS</span>
                <div class="h-1.5 w-full bg-on-primary-fixed-variant mt-2 rounded-full">
                  <div class="h-full bg-secondary-fixed-dim rounded-full" style="width: ${targetProgress}%"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="col-span-12 md:col-span-6 lg:col-span-4 bg-surface-container-lowest border border-outline-variant p-card-padding rounded-xl flex flex-col">
          <div class="flex justify-between items-center mb-6">
            <h3 class="text-label-sm font-label-sm text-outline uppercase tracking-wider">Fleet Status</h3>
            <span class="material-symbols-outlined text-primary">local_shipping</span>
          </div>
          <div class="flex-1 flex flex-col justify-center items-center">
            <div class="relative w-32 h-32 flex items-center justify-center">
              <svg class="w-full h-full -rotate-90">
                <circle class="text-surface-container" cx="64" cy="64" fill="transparent" r="58" stroke="currentColor" stroke-width="8"></circle>
                <circle class="text-secondary" cx="64" cy="64" fill="transparent" r="58" stroke="currentColor" stroke-dasharray="364.4" stroke-dashoffset="${364.4 - (364.4 * activeVehicles / totalVehicles)}" stroke-width="8"></circle>
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center">
                <span class="text-display-metrics font-display-metrics">${activeVehicles}</span>
                <span class="text-label-sm font-label-sm text-outline">ACTIVE</span>
              </div>
            </div>
            <p class="mt-6 text-body-md text-center">
              <span class="font-bold text-on-surface">${Math.round((activeVehicles / totalVehicles) * 100)}%</span> of fleet operational.<br/>
              <span class="text-outline">${totalVehicles - activeVehicles} vehicles in maintenance.</span>
            </p>
          </div>
          <button onclick="Router.navigate('vehicles')" class="mt-6 w-full py-3 border border-outline-variant rounded-lg text-body-md font-semibold hover:bg-surface-container-low transition-colors">Manage Fleet</button>
        </div>
      </div>

      <div class="bento-grid mb-8">
        <div class="col-span-12 lg:col-span-8 bg-surface-container-lowest border border-outline-variant p-card-padding rounded-xl">
          <div class="flex justify-between items-center mb-8">
            <div>
              <h3 class="text-headline-md font-headline-md">Fuel Sales Trends</h3>
              <p class="text-body-md text-outline">Weekly volume tracking per terminal</p>
            </div>
            <div class="flex gap-2">
              <button class="px-4 py-1.5 text-label-sm font-label-sm bg-surface-container-high rounded-full">7 Days</button>
              <button class="px-4 py-1.5 text-label-sm font-label-sm hover:bg-surface-container-low rounded-full transition-colors">30 Days</button>
            </div>
          </div>
          <div class="chart-container flex items-end justify-between px-4 pb-2 border-l border-b border-outline-variant/30" id="sales-chart"></div>
        </div>

        <div class="col-span-12 lg:col-span-4 bg-surface-container-lowest border border-outline-variant rounded-xl flex flex-col">
          <div class="p-card-padding border-b border-outline-variant">
            <h3 class="text-headline-md font-headline-md">Recent Activities</h3>
          </div>
          <div class="flex-1 overflow-y-auto custom-scrollbar p-2">
            <div class="space-y-1">${activities}</div>
          </div>
          <div class="p-4 border-t border-outline-variant">
            <button onclick="Router.navigate('reports')" class="w-full text-center text-label-sm font-label-sm text-primary hover:underline">VIEW ALL ACTIVITIES</button>
          </div>
        </div>
      </div>

      <div class="bento-grid">
        <div class="col-span-12 md:col-span-4 bg-surface-container-lowest border border-outline-variant p-card-padding rounded-xl">
          <h3 class="text-label-sm font-label-sm text-outline mb-6">PURCHASES VS SALES</h3>
          <div class="h-48 flex items-end gap-3 justify-between" id="purchase-sales-chart"></div>
          <div class="mt-4 flex gap-4">
            <div class="flex items-center gap-2"><div class="w-3 h-3 bg-primary"></div><span class="text-label-sm text-outline">Purchases</span></div>
            <div class="flex items-center gap-2"><div class="w-3 h-3 bg-secondary"></div><span class="text-label-sm text-outline">Sales</span></div>
          </div>
        </div>
        <div class="col-span-12 md:col-span-4 bg-surface-container-lowest border border-outline-variant p-card-padding rounded-xl">
          <h3 class="text-label-sm font-label-sm text-outline mb-6">MONTHLY REVENUE GROWTH</h3>
          <div class="h-48 bg-gradient-to-t from-secondary/5 to-secondary/20 relative rounded overflow-hidden">
            <svg class="w-full h-full" preserveAspectRatio="none" viewBox="0 0 400 192">
              <path d="M0,192 L40,160 L80,170 L120,130 L160,145 L200,100 L240,110 L280,80 L320,95 L360,50 L400,65 L400,192 Z" fill="rgba(0, 108, 73, 0.1)"></path>
              <polyline fill="none" points="0,192 40,160 80,170 120,130 160,145 200,100 240,110 280,80 320,95 360,50 400,65" stroke="#006c49" stroke-width="2"></polyline>
            </svg>
          </div>
          <div class="mt-4 text-headline-md font-headline-md text-secondary">+12.4% vs LY</div>
        </div>
        <div class="col-span-12 md:col-span-4 bg-surface-container-lowest border border-outline-variant p-card-padding rounded-xl">
          <h3 class="text-label-sm font-label-sm text-outline mb-6">VEHICLE CONSUMPTION EFFICIENCY</h3>
          <div class="space-y-4">${efficiencyBars}</div>
        </div>
      </div>
    `;
  },

  // SECTION: afterRender — mounts client-side charts after DOM is ready; add more chart init calls here
  afterRender() {
    this.renderSalesChart();
    this.renderPurchaseSalesChart();
  },

  // SECTION: renderSalesChart — draws weekly sales bar chart in #sales-chart; replace static heights with live sales data here
  renderSalesChart() {
    const container = document.getElementById('sales-chart');
    if (!container) return;
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const heights = [32, 24, 40, 28, 44, 16, 12];
    container.innerHTML = days.map((day, i) => `
      <div class="flex-1 flex flex-col items-center">
        <div class="w-full bg-secondary/5 relative" style="height: ${heights[i] * 4}px">
          <div class="absolute bottom-0 left-0 w-full border-t-2 border-secondary" style="height: ${heights[i] * 2}px"></div>
        </div>
        <span class="mt-4 text-label-sm text-outline">${day}</span>
      </div>
    `).join('');
  },

  // SECTION: renderPurchaseSalesChart — draws purchases vs sales comparison in #purchase-sales-chart; wire to real weekly totals here
  renderPurchaseSalesChart() {
    const container = document.getElementById('purchase-sales-chart');
    if (!container) return;
    const weeks = [
      { p: 32, s: 24 }, { p: 28, s: 36 }, { p: 40, s: 32 }, { p: 24, s: 20 },
    ];
    container.innerHTML = weeks.map((w, i) => `
      <div class="flex-1 flex flex-col gap-1 items-center">
        <div class="w-full flex justify-center gap-1">
          <div class="w-2 bg-primary rounded-t-sm" style="height: ${w.p * 4}px"></div>
          <div class="w-2 bg-secondary rounded-t-sm" style="height: ${w.s * 4}px"></div>
        </div>
        <span class="text-[10px] text-outline mt-2">W${i + 1}</span>
      </div>
    `).join('');
  },
};

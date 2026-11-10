/**
 * FuelFlow ERP - Router
 */
const Router = {
  // SECTION: tracks active page key for FAB, nav highlight, and refresh; do not rename without updating consumers
  currentPage: 'dashboard',
  // SECTION: prevents hashchange loop when go() updates location hash programmatically
  _skipHash: false,

  // SECTION: page registry — title, module, icon, and flags; add new routes and page modules here
  pages: {
    dashboard: { title: 'Dashboard Overview', module: DashboardPage, icon: 'dashboard', mobileLabel: 'Home' },
    inventory: { title: 'Fuel Inventory', module: InventoryPage, icon: 'storage', mobileLabel: 'Stock' },
    pumps: { title: 'Stations & Pumps', module: PumpsPage, icon: 'local_gas_station', mobileLabel: 'Pumps' },
    suppliers: { title: 'Suppliers', module: SuppliersPage, icon: 'business', mobileLabel: 'Suppliers' },
    purchases: { title: 'Purchases', module: PurchasesPage, icon: 'shopping_cart', mobileLabel: 'Buy' },
    sales: { title: 'Sales', module: SalesPage, icon: 'point_of_sale', mobileLabel: 'Sales' },
    customers: { title: 'Customers', module: CustomersPage, icon: 'groups', mobileLabel: 'Customers' },
    invoices: { title: 'Billing & Invoices', module: InvoicesPage, icon: 'receipt_long', mobileLabel: 'Billing' },
    expenses: { title: 'Expenses', module: ExpensesPage, icon: 'payments', mobileLabel: 'Expenses' },
    finance: { title: 'Finance', module: FinancePage, icon: 'account_balance', mobileLabel: 'Finance' },
    vehicles: { title: 'Fleet Management', module: VehiclesPage, icon: 'local_shipping', mobileLabel: 'Fleet' },
    consumption: { title: 'Fuel Consumption', module: ConsumptionPage, icon: 'speed', mobileLabel: 'Usage' },
    reports: { title: 'Reports', module: ReportsPage, icon: 'assessment', mobileLabel: 'Reports' },
    users: { title: 'User Management', module: UsersPage, icon: 'group', mobileLabel: 'Users', adminOnly: true },
    settings: { title: 'Settings', module: SettingsPage, icon: 'settings', mobileLabel: 'Settings' },
  },

  // SECTION: sidebar nav item definitions; keep in sync with pages keys and role visibility rules
  navItems: [
    { page: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { page: 'inventory', label: 'Inventory', icon: 'storage' },
    { page: 'pumps', label: 'Stations & Pumps', icon: 'local_gas_station' },
    { page: 'suppliers', label: 'Suppliers', icon: 'business' },
    { page: 'purchases', label: 'Purchases', icon: 'shopping_cart' },
    { page: 'sales', label: 'Sales', icon: 'point_of_sale' },
    { page: 'customers', label: 'Customers', icon: 'groups' },
    { page: 'invoices', label: 'Billing & Invoices', icon: 'receipt_long' },
    { page: 'expenses', label: 'Expenses', icon: 'payments' },
    { page: 'finance', label: 'Finance', icon: 'account_balance' },
    { page: 'vehicles', label: 'Fleet', icon: 'local_shipping' },
    { page: 'consumption', label: 'Consumption', icon: 'speed' },
    { page: 'reports', label: 'Reports', icon: 'assessment' },
    { page: 'users', label: 'User Management', icon: 'group', adminOnly: true },
    { page: 'settings', label: 'Settings', icon: 'settings' },
  ],

  // SECTION: binds nav once and loads page from URL hash; change default page or hash parsing here
  init() {
    this.bindGlobalNav();
    const hash = (window.location.hash || '').replace(/^#/, '') || 'dashboard';
    this.go(hash, false);
    window.addEventListener('hashchange', () => {
      if (this._skipHash) return;
      const page = (window.location.hash || '').replace(/^#/, '') || 'dashboard';
      this.go(page, false);
    });
  },

  // SECTION: global click handler for nav links — works after sidebar HTML is replaced; change data-nav attribute contract here
  bindGlobalNav() {
    if (document.body.dataset.navBound) return;
    document.body.dataset.navBound = 'true';

    document.body.addEventListener('click', (e) => {
      const navLink = e.target.closest('[data-nav]');
      const mobileBtn = e.target.closest('[data-mobile-nav]');
      const logoutBtn = e.target.closest('[data-logout]');
      const page = navLink?.dataset.nav || mobileBtn?.dataset.mobileNav;

      // SECTION: handle logout buttons in sidebar and mobile nav
      if (logoutBtn) {
        e.preventDefault();
        e.stopPropagation();
        Auth.logout();
        return;
      }

      if (!page) return;

      e.preventDefault();
      e.stopPropagation();
      this.go(page);
      if (typeof App !== 'undefined') App.closeSidebar();
    });
  },

  // SECTION: validates page key and role access; returns safe fallback page when denied or unknown
  resolvePage(page) {
    const session = Auth.getSession();
    const home = this.homePage();
    if (!session) return home;
    if (!this.pages[page]) return home;

    if (!Utils.canAccess(session.role, page)) {
      if (page !== 'dashboard') Utils.toast('Access denied for this section', 'error');
      return home;
    }
    return page;
  },

  // SECTION: landing page — dashboard when permitted, otherwise the first page the role can open
  homePage() {
    const session = Auth.getSession();
    if (!session) return 'dashboard';
    if (session.role === 'customer') return 'invoices'; // customers land on "My Account"
    return this.navItems.find((i) => Utils.canAccess(session.role, i.page))?.page || 'settings';
  },

  // SECTION: main navigation entry — updates hash, renders module, runs afterRender; change render pipeline here
  go(page, updateHash = true) {
    const session = Auth.getSession();
    if (!session) {
      window.location.href = 'index.html';
      return;
    }

    // SECTION: optional query in the hash (e.g. #invoices?payment=ID after a card checkout)
    if (typeof page === 'string' && page.includes('?')) {
      const [p, q] = page.split('?');
      page = p;
      this.hashParams = new URLSearchParams(q);
    }
    page = this.resolvePage(page);
    // SECTION: pages that load API data reset their cache when the user navigates to them
    const entering = page !== this.currentPage || !this._started;
    this._started = true;
    this.currentPage = page;
    if (entering) this.pages[page]?.module?.onEnter?.();

    // SECTION: sync URL hash without re-triggering hashchange handler
    if (updateHash) {
      const target = '#' + page;
      if (window.location.hash !== target) {
        this._skipHash = true;
        window.location.hash = page;
        this._skipHash = false;
      }
    }

    const config = this.pages[page];
    if (!config || !config.module) return;

    const titleEl = document.getElementById('page-title');
    const contentEl = document.getElementById('main-content');

    if (titleEl) titleEl.textContent = config.title;

    // SECTION: render page HTML into main content with error fallback UI
    if (contentEl) {
      try {
        contentEl.innerHTML = config.module.render();
      } catch (err) {
        console.error('Page render error (' + page + '):', err);
        contentEl.innerHTML =
          '<div class="page-section"><p class="text-error font-semibold">Failed to load this page.</p>' +
          '<p class="text-sm text-outline mt-2">' + Utils.escapeHtml(err.message) + '</p></div>';
      }
    }

    window.scrollTo(0, 0);
    this.updateSidebar();
    this.updateMobileNav();

    // SECTION: run page-specific DOM bindings after HTML is inserted
    try {
      config.module.afterRender?.();
    } catch (err) {
      console.error('Page afterRender error (' + page + '):', err);
    }
  },

  // SECTION: alias for go() kept for backward compatibility; prefer go() in new code
  navigate(page, updateHash = true) {
    this.go(page, updateHash);
  },

  // SECTION: re-renders current page without changing hash; call after data mutations on same view
  refresh() {
    this.go(this.currentPage, false);
  },

  // SECTION: filters nav items by role and Utils.canAccess; change adminOnly handling here
  getVisibleNavItems() {
    const session = Auth.getSession();
    if (!session) return this.navItems.filter((i) => i.page === 'dashboard');

    return this.navItems.filter((item) => Utils.canAccess(session.role, item.page));
  },

  // SECTION: applies active styles to sidebar links matching currentPage; change CSS classes here
  updateSidebar() {
    document.querySelectorAll('#sidebar-nav [data-nav]').forEach((link) => {
      const page = link.dataset.nav;
      const isActive = page === this.currentPage;
      link.className = isActive
        ? 'flex items-center gap-3 px-4 py-3 border-l-4 border-secondary text-secondary-container bg-surface-container-highest/10 font-bold nav-link cursor-pointer'
        : 'flex items-center gap-3 px-4 py-3 text-on-primary-container/70 hover:text-on-primary-container hover:bg-surface-container-high/20 transition-colors nav-link cursor-pointer';
    });
  },

  // SECTION: rebuilds bottom mobile nav with truncated items plus logout; change mobile item cap here
  updateMobileNav() {
    const container = document.getElementById('mobile-bottom-nav');
    if (!container) return;

    const items = this.getVisibleNavItems();
    // Show fewer items on mobile + dedicated logout slot
    const mobileItems = items.length > 5 ? items.filter((_, i) => i < 4).concat(items.find((i) => i.page === 'settings') || items[items.length - 1]) : items;

    container.innerHTML = mobileItems.map((item) => {
      const config = this.pages[item.page];
      const label = config?.mobileLabel || item.label;
      const isActive = item.page === this.currentPage;
      return (
        '<button type="button" class="mobile-nav-item' + (isActive ? ' active' : '') + '" data-mobile-nav="' + item.page + '">' +
        '<span class="material-symbols-outlined">' + item.icon + '</span>' +
        '<span>' + label + '</span></button>'
      );
    }).join('') +
      '<button type="button" class="mobile-nav-item logout-item" id="mobile-logout-btn" data-logout="true">' +
      '<span class="material-symbols-outlined">logout</span><span>Logout</span></button>';
  },

  // SECTION: returns sidebar link HTML string for visible nav items; used by App.renderNav
  renderSidebar() {
    return this.getVisibleNavItems().map((item) => (
      '<a data-nav="' + item.page + '" href="#' + item.page + '" role="button"' +
      ' class="flex items-center gap-3 px-4 py-3 text-on-primary-container/70 hover:text-on-primary-container hover:bg-surface-container-high/20 transition-colors nav-link cursor-pointer">' +
      '<span class="material-symbols-outlined">' + item.icon + '</span>' +
      '<span class="text-body-md">' + item.label + '</span></a>'
    )).join('');
  },
};

// SECTION: expose Router and goToPage helper globally for inline handlers and console debugging
window.Router = Router;
window.goToPage = (page) => Router.go(page);

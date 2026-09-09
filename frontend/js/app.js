/**
 * FuelFlow ERP - Main Application
 */
const App = {
  // SECTION: bootstraps authenticated shell — theme, nav, router, and global events; change startup order here
  init() {
    try {
      const session = Auth.requireAuth();
      if (!session) return;

      Store.init();
      this.initTheme();
      this.renderNav();
      this.initNotifications();
      Router.init();
      this.bindGlobalEvents();
    } catch (err) {
      // SECTION: show fatal init error in main content when startup throws
      console.error('App init failed:', err);
      const main = document.getElementById('main-content');
      if (main) {
        main.innerHTML = '<div class="page-section"><p class="text-error font-semibold">App failed to start.</p><p class="text-sm mt-2">' + err.message + '</p><p class="text-sm mt-4">Open via <strong>frontend/index.html</strong> and use a local server if needed.</p></div>';
      }
    }
  },

  // SECTION: applies saved light/dark theme from localStorage; change storage key or default theme here
  initTheme() {
    const theme = localStorage.getItem('fuelflow_theme') || 'light';
    document.documentElement.classList.toggle('dark', theme === 'dark');
  },

  // SECTION: toggles dark mode class and persists preference; change key name if theming is centralized
  toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('fuelflow_theme', isDark ? 'dark' : 'light');
  },

  // SECTION: rebuilds sidebar, brand, and user avatar from session and settings; call after login or settings change
  renderNav() {
    const nav = document.getElementById('sidebar-nav');
    if (nav) {
      nav.innerHTML = Router.renderSidebar();
    }
    Router.bindGlobalNav();

    const settings = Store.getAll().settings;
    const brand = document.getElementById('brand-name');
    if (brand) brand.textContent = settings.companyName;

    const session = Auth.getSession();
    const avatar = document.getElementById('user-avatar');
    const avatarWrap = document.getElementById('user-avatar-wrap');
    if (avatar && session) {
      avatar.textContent = session.name.charAt(0).toUpperCase();
      if (avatarWrap) avatarWrap.title = session.name + ' (' + Auth.roleLabel(session.role) + ')';
    }

    Router.updateMobileNav();
  },

  // SECTION: confirms and signs user out via Auth; change confirm message or skip confirm here
  logout() {
    if (confirm('Sign out and return to login page?')) {
      Auth.logout();
    }
  },

  // SECTION: wires header controls — theme, sidebar, search, notifications, FAB; add new global listeners here
  bindGlobalEvents() {
    document.getElementById('theme-toggle')?.addEventListener('click', () => this.toggleTheme());
    document.getElementById('menu-toggle')?.addEventListener('click', () => this.toggleSidebar());
    document.getElementById('sidebar-close')?.addEventListener('click', () => this.closeSidebar());
    document.getElementById('sidebar-overlay')?.addEventListener('click', () => this.closeSidebar());
    document.getElementById('search-toggle')?.addEventListener('click', () => this.toggleMobileSearch());
    document.getElementById('notif-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleNotifications();
    });
    // SECTION: close notification dropdown when clicking outside trigger and panel
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#notif-btn') && !e.target.closest('#notif-dropdown')) {
        document.getElementById('notif-dropdown')?.classList.remove('open');
      }
    });

    const handleSearch = (query) => this.globalSearch(query);
    document.getElementById('global-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSearch(e.target.value);
    });
    document.getElementById('global-search-mobile')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSearch(e.target.value);
        this.toggleMobileSearch(false);
      }
    });

    document.getElementById('fab-btn')?.addEventListener('click', () => this.quickAdd());

    document.getElementById('header-logout-btn')?.addEventListener('click', () => this.logout());

    document.querySelector('#profile-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      Router.go('settings');
      this.closeSidebar();
    });

    // SECTION: auto-close mobile sidebar when viewport reaches desktop breakpoint
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1024) this.closeSidebar();
    });
  },

  // SECTION: shows or hides mobile search bar; pass boolean to force open/close state
  toggleMobileSearch(force) {
    const bar = document.getElementById('search-mobile');
    if (!bar) return;
    const show = typeof force === 'boolean' ? force : bar.classList.contains('hidden');
    bar.classList.toggle('hidden', !show);
    if (show) document.getElementById('global-search-mobile')?.focus();
  },

  // SECTION: opens mobile sidebar and overlay; change element ids if layout markup changes
  toggleSidebar() {
    document.getElementById('sidebar')?.classList.toggle('open');
    document.getElementById('sidebar-overlay')?.classList.toggle('active');
  },

  // SECTION: closes mobile sidebar and overlay; call after navigation on small screens
  closeSidebar() {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('active');
  },

  // SECTION: entry point for notification UI setup; delegates to renderNotifications
  initNotifications() {
    this.renderNotifications();
  },

  // SECTION: builds notification dropdown HTML and unread badge; change slice limit or template here
  renderNotifications() {
    const dropdown = document.getElementById('notif-dropdown');
    const badge = document.getElementById('notif-badge');
    if (!dropdown) return;

    const notifications = Store.get('notifications').sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const unread = notifications.filter((n) => !n.read).length;

    // SECTION: update badge visibility and count from unread notifications
    if (badge) {
      badge.textContent = unread;
      badge.style.display = unread ? 'flex' : 'none';
    }

    dropdown.innerHTML = `
      <div class="p-4 border-b border-outline-variant flex justify-between items-center">
        <span class="font-semibold">Notifications</span>
        <button type="button" onclick="App.markAllRead()" class="text-label-sm text-secondary hover:underline">Mark all read</button>
      </div>
      <div class="max-h-80 overflow-y-auto custom-scrollbar">
        ${notifications.length ? notifications.slice(0, 8).map((n) => `
          <div class="p-4 border-b border-outline-variant/50 hover:bg-surface-container-low ${n.read ? 'opacity-60' : ''}">
            <div class="flex gap-3">
              <span class="material-symbols-outlined ${n.type === 'warning' ? 'text-tertiary-fixed-dim' : n.type === 'danger' ? 'text-error' : 'text-secondary'}">
                ${n.type === 'warning' ? 'warning' : n.type === 'danger' ? 'error' : 'info'}
              </span>
              <div class="min-w-0">
                <p class="font-semibold text-sm">${Utils.escapeHtml(n.title)}</p>
                <p class="text-xs text-outline break-words">${Utils.escapeHtml(n.message)}</p>
                <p class="text-[10px] text-outline mt-1">${Utils.formatDateTime(n.timestamp)}</p>
              </div>
            </div>
          </div>
        `).join('') : '<p class="p-6 text-center text-outline">No notifications</p>'}
      </div>
    `;
  },

  // SECTION: toggles notification dropdown open state; change target element id if markup moves
  toggleNotifications() {
    document.getElementById('notif-dropdown')?.classList.toggle('open');
  },

  // SECTION: marks all notifications read in store and refreshes UI; change to per-notification read if needed
  markAllRead() {
    const data = Store.getAll();
    data.notifications.forEach((n) => { n.read = true; });
    Store.save(data);
    this.renderNotifications();
  },

  // SECTION: keyword router for global search — navigates to matching page; extend keywords or add full-text search here
  globalSearch(query) {
    if (!query.trim()) return;
    const q = query.toLowerCase();
    if (q.includes('sale')) Router.go('sales');
    else if (q.includes('purchase') || q.includes('buy')) Router.go('purchases');
    else if (q.includes('vehicle') || q.includes('fleet')) Router.go('vehicles');
    else if (q.includes('inventory') || q.includes('stock')) Router.go('inventory');
    else if (q.includes('supplier')) Router.go('suppliers');
    else if (q.includes('consumption') || q.includes('usage')) Router.go('consumption');
    else if (q.includes('report')) Router.go('reports');
    else if (q.includes('user')) Router.go('users');
    else if (q.includes('setting')) Router.go('settings');
    else Router.go('dashboard');
  },

  // SECTION: FAB quick-add dispatches to current page module; map new pages to their openAdd handlers here
  quickAdd() {
    const page = Router.currentPage;
    const actions = {
      dashboard: () => SalesPage.openAdd(),
      inventory: () => InventoryPage.openAddStock(),
      suppliers: () => SuppliersPage.openAdd(),
      purchases: () => PurchasesPage.openAdd(),
      sales: () => SalesPage.openAdd(),
      vehicles: () => VehiclesPage.openAdd(),
      consumption: () => ConsumptionPage.openAdd(),
      users: () => UsersPage.openAdd(),
    };
    (actions[page] || actions.dashboard)();
  },
};

// SECTION: start app when DOM is ready; change event if scripts load defer/async differently
document.addEventListener('DOMContentLoaded', () => App.init());
// SECTION: expose App on window for inline onclick handlers in notification markup
window.App = App;

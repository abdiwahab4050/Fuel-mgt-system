/**
 * FuelFlow ERP - Main Application
 */
const App = {
  _pendingAvatarDataUrl: null,

  // SECTION: bootstraps authenticated shell — theme, nav, router, and global events; change startup order here
  async init() {
    try {
      const session = await Auth.requireAuth();
      if (!session) return;

      Store.init();
      await this.loadSettings();
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
        main.innerHTML = '<div class="page-section"><p class="text-error font-semibold">App failed to start.</p><p class="text-sm mt-2">' + Utils.escapeHtml(err.message) + '</p><p class="text-sm mt-4">Make sure the backend is running (<code>cd backend &amp;&amp; npm run dev</code>) and open <strong>http://localhost:4000</strong>.</p></div>';
      }
    }
  },

  // SECTION: company branding, currency and invoice settings from /api/settings (used by receipts and formatCurrency)
  settings: null,
  async loadSettings() {
    try {
      this.settings = (await Api.get('/settings')).settings;
    } catch {
      this.settings = null; // fall back to defaults; pages show their own errors
    }
    return this.settings;
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

    const brand = document.getElementById('brand-name');
    if (brand) brand.textContent = this.settings?.['company.name'] || Store.getAll().settings.companyName;

    this.renderAvatar();

    Router.updateMobileNav();
  },

  // SECTION: updates header avatar from user record — image or initials fallback
  renderAvatar() {
    const session = Auth.getSession();
    const btn = document.getElementById('user-avatar-btn');
    const img = document.getElementById('user-avatar-img');
    const initial = document.getElementById('user-avatar');
    if (!session || !btn || !img || !initial) return;

    btn.title = `${session.name} (${Auth.roleLabel(session.role)}) — click to edit photo`;

    if (session.avatarUrl) {
      img.src = session.avatarUrl;
      img.classList.remove('hidden');
      initial.classList.add('hidden');
    } else {
      img.classList.add('hidden');
      img.removeAttribute('src');
      initial.classList.remove('hidden');
      initial.textContent = Utils.userInitials(session.name);
    }
  },

  // SECTION: opens profile picture modal — preview, upload, remove, and save
  openProfileModal() {
    const session = Auth.getSession();
    if (!session) return;

    this._pendingAvatarDataUrl = null;
    const previewUrl = session.avatarUrl || null;
    const initial = Utils.userInitials(session.name);

    Utils.openModal(
      'Profile Picture',
      `
        <div class="flex flex-col items-center gap-5">
          <div id="profile-avatar-preview" class="profile-avatar-preview h-28 w-28 rounded-full overflow-hidden bg-secondary flex items-center justify-center ring-4 ring-surface-container-high">
            ${previewUrl
              ? `<img src="${previewUrl}" alt="Profile preview" class="h-full w-full object-cover"/>`
              : `<span class="text-on-secondary text-3xl font-bold">${initial}</span>`}
          </div>
          <div class="text-center">
            <p class="font-semibold text-on-surface">${Utils.escapeHtml(session.name)}</p>
            <p class="text-sm text-outline">${Utils.escapeHtml(session.email)}</p>
          </div>
          <label class="inline-flex items-center gap-2 px-4 py-2 bg-surface-container-low border border-outline-variant rounded-lg cursor-pointer hover:bg-surface-container transition-colors">
            <span class="material-symbols-outlined text-secondary">upload</span>
            <span class="text-sm font-semibold">Choose photo</span>
            <input type="file" id="profile-avatar-input" accept="image/jpeg,image/png,image/gif,image/webp" class="hidden"/>
          </label>
          <p class="text-xs text-outline text-center">JPG, PNG, GIF, or WebP. Maximum size 512KB.</p>
        </div>
      `,
      `
        ${previewUrl ? '<button type="button" onclick="App.removeProfilePhoto()" class="px-4 py-2 border border-error/30 text-error rounded-lg text-body-md hover:bg-error-container mr-auto">Remove photo</button>' : '<span class="mr-auto"></span>'}
        <button type="button" onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded-lg text-body-md hover:bg-surface-container-low">Cancel</button>
        <button type="button" id="profile-save-btn" onclick="App.saveProfilePhoto()" disabled class="px-4 py-2 bg-primary text-on-primary rounded-lg font-semibold disabled:opacity-40 disabled:cursor-not-allowed">Save</button>
      `
    );

    document.getElementById('profile-avatar-input')?.addEventListener('change', (e) => this.handleProfilePhotoSelect(e));
  },

  // SECTION: previews selected image before saving to user profile
  async handleProfilePhotoSelect(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await Utils.readImageAsDataUrl(file);
      this._pendingAvatarDataUrl = dataUrl;

      const preview = document.getElementById('profile-avatar-preview');
      if (preview) {
        preview.innerHTML = `<img src="${dataUrl}" alt="Profile preview" class="h-full w-full object-cover"/>`;
      }

      const saveBtn = document.getElementById('profile-save-btn');
      if (saveBtn) saveBtn.disabled = false;
    } catch (err) {
      Utils.toast(err.message, 'error');
      event.target.value = '';
    }
  },

  // SECTION: saves uploaded profile picture to the server and refreshes UI
  async saveProfilePhoto() {
    if (!this._pendingAvatarDataUrl) return;
    try {
      const { avatarUrl } = await Api.put('/auth/me/avatar', { dataUrl: this._pendingAvatarDataUrl });
      Auth.updateSession({ avatarUrl });
    } catch (err) {
      return Utils.toast(err.fullMessage || err.message, 'error');
    }
    this._pendingAvatarDataUrl = null;
    Utils.closeModal();
    this.renderAvatar();
    if (Router.currentPage === 'settings') Router.refresh();
    Utils.toast('Profile picture updated', 'success');
  },

  // SECTION: removes profile picture on the server and restores initials avatar
  async removeProfilePhoto() {
    try {
      await Api.del('/auth/me/avatar');
      Auth.updateSession({ avatarUrl: null });
    } catch (err) {
      return Utils.toast(err.message, 'error');
    }
    this._pendingAvatarDataUrl = null;
    Utils.closeModal();
    this.renderAvatar();
    if (Router.currentPage === 'settings') Router.refresh();
    Utils.toast('Profile picture removed', 'success');
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

    document.getElementById('user-avatar-btn')?.addEventListener('click', () => this.openProfileModal());

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

  // SECTION: builds notification dropdown from /api/notifications; refreshed every minute
  async renderNotifications() {
    const dropdown = document.getElementById('notif-dropdown');
    const badge = document.getElementById('notif-badge');
    if (!dropdown) return;
    if (!Auth.can('notifications.view')) {
      document.getElementById('notif-btn')?.classList.add('hidden');
      return;
    }

    let notifications = [];
    let unread = 0;
    try {
      const res = await Api.get('/notifications');
      notifications = res.notifications.map((n) => ({ ...n, type: n.type.toLowerCase(), timestamp: n.createdAt }));
      unread = res.unread;
    } catch {
      // keep the bell quiet if the server is unreachable; pages show their own errors
    }
    clearTimeout(this._notifTimer);
    this._notifTimer = setTimeout(() => this.renderNotifications(), 60000);

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
          <div class="p-4 border-b border-outline-variant/50 hover:bg-surface-container-low ${n.read ? 'opacity-60' : ''} ${n.link ? 'cursor-pointer' : ''}" ${n.link ? `onclick="Router.go('${n.link.replace(/[^a-z]/g, '')}'); document.getElementById('notif-dropdown').classList.remove('open')"` : ''}>
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

  // SECTION: marks all notifications read on the server and refreshes the bell
  async markAllRead() {
    await Utils.act(() => Api.post('/notifications/read-all'));
    this.renderNotifications();
  },

  // SECTION: keyword router for global search — navigates to matching page; extend keywords or add full-text search here
  globalSearch(query) {
    if (!query.trim()) return;
    const q = query.toLowerCase();
    if (/^(inv|invoice|bill|payment|refund|receipt)/.test(q) || /^inv-\d/.test(q)) Router.go('invoices');
    else if (q.includes('customer') || q.includes('client') || q.includes('credit')) Router.go('customers');
    else if (q.includes('sale') || q.includes('pos')) Router.go('sales');
    else if (q.includes('purchase') || q.includes('buy') || q.includes('deliver') || q.startsWith('po')) Router.go('purchases');
    else if (q.includes('expense') || q.includes('cost')) Router.go('expenses');
    else if (q.includes('finance') || q.includes('profit') || q.includes('p&l') || q.includes('cash')) Router.go('finance');
    else if (q.includes('vehicle') || q.includes('fleet')) Router.go('vehicles');
    else if (q.includes('inventory') || q.includes('stock') || q.includes('tank')) Router.go('inventory');
    else if (q.includes('pump') || q.includes('shift') || q.includes('meter') || q.includes('station')) Router.go('pumps');
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
    // [handler, permission required to use it]
    const actions = {
      dashboard: [() => SalesPage.openAdd(), 'sales.create'],
      inventory: [() => InventoryPage.openTankForm(), 'inventory.manage'],
      pumps: [() => PumpsPage.openPumpForm(), 'pumps.manage'],
      suppliers: [() => SuppliersPage.openAdd(), 'suppliers.manage'],
      purchases: [() => PurchasesPage.openAdd(), 'purchases.manage'],
      sales: [() => SalesPage.openAdd(), 'sales.create'],
      customers: [() => CustomersPage.openForm(), 'customers.manage'],
      expenses: [() => ExpensesPage.openForm(), 'expenses.manage'],
      invoices: [() => SalesPage.openAdd(), 'sales.create'],
      vehicles: [() => VehiclesPage.openAdd(), 'fleet.manage'],
      consumption: [() => ConsumptionPage.openAdd(), 'consumption.record'],
      users: [() => UsersPage.openAdd(), 'users.manage'],
    };
    const [handler, perm] = actions[page] || actions.dashboard;
    if (!Auth.can(perm)) return Utils.toast('You do not have permission for this action', 'error');
    handler();
  },
};

// SECTION: start app when DOM is ready; change event if scripts load defer/async differently
document.addEventListener('DOMContentLoaded', () => App.init());
// SECTION: expose App on window for inline onclick handlers in notification markup
window.App = App;

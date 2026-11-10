/**
 * Settings Page
 */
// SECTION: Settings page object — company preferences, profile display, and data reset; add settings sections here
const SettingsPage = {
  // SECTION: render — settings form, session profile, and data management; add tabs or new setting groups here
  render() {
    // SECTION: load settings and session — current app config and logged-in user; add more profile fields here
    const s = App.settings || {};
    const v = (k) => Utils.escapeHtml(s[k] ?? '');
    const session = Auth.getSession();
    const avatarUrl = session.avatarUrl;
    const initial = Utils.userInitials(session.name);
    const canManage = Auth.can('settings.manage');

    return `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">${canManage ? 'System Settings' : 'My Profile'}</h2>
          <p class="text-body-md text-outline mt-1">${canManage ? 'Configure system preferences and company details' : 'Your account details and password'}</p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        ${canManage ? `<div class="page-section lg:col-span-2">
          <h3 class="text-headline-md mb-6">Business &amp; Billing</h3>
          <form id="settings-form" onsubmit="event.preventDefault(); SettingsPage.save()">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              <div>
                <p class="text-label-sm text-outline mb-3">STATION BRANDING (shown on invoices and receipts)</p>
                <div class="form-group"><label class="form-label">Business Name</label><input name="company.name" class="form-input" required value="${v('company.name')}"/></div>
                <div class="form-group"><label class="form-label">Address</label><input name="company.address" class="form-input" value="${v('company.address')}"/></div>
                <div class="grid grid-cols-2 gap-4">
                  <div class="form-group"><label class="form-label">Phone</label><input name="company.phone" class="form-input" value="${v('company.phone')}"/></div>
                  <div class="form-group"><label class="form-label">Email</label><input name="company.email" type="email" class="form-input" value="${v('company.email')}"/></div>
                </div>
                <div class="form-group"><label class="form-label">Tax / Registration No.</label><input name="company.taxId" class="form-input" value="${v('company.taxId')}"/></div>
                <div class="form-group">
                  <label class="form-label">Logo</label>
                  <div class="flex items-center gap-4">
                    <div id="logo-preview" class="h-14 w-28 rounded border border-outline-variant flex items-center justify-center overflow-hidden bg-white">${s['company.logoUrl'] ? `<img src="${v('company.logoUrl')}" class="max-h-full max-w-full object-contain" alt="Logo"/>` : '<span class="text-xs text-outline">No logo</span>'}</div>
                    <label class="text-sm font-semibold text-secondary cursor-pointer hover:underline">Upload<input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" onchange="SettingsPage.pickLogo(event)"/></label>
                    ${s['company.logoUrl'] ? '<button type="button" onclick="SettingsPage.clearLogo()" class="text-sm text-error hover:underline">Remove</button>' : ''}
                  </div>
                </div>
              </div>
              <div>
                <p class="text-label-sm text-outline mb-3">CURRENCY, TAX &amp; TERMS</p>
                <div class="grid grid-cols-2 gap-4">
                  <div class="form-group"><label class="form-label">Currency Code</label><input name="currency.code" class="form-input uppercase" maxlength="3" required value="${v('currency.code')}" placeholder="USD"/></div>
                  <div class="form-group"><label class="form-label">Currency Symbol</label><input name="currency.symbol" class="form-input" maxlength="5" required value="${v('currency.symbol')}"/></div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div class="form-group"><label class="form-label">Tax Label</label><input name="invoice.taxLabel" class="form-input" maxlength="20" value="${v('invoice.taxLabel')}"/></div>
                  <div class="form-group"><label class="form-label">Tax Rate (%)</label><input name="invoice.taxRate" type="number" step="0.001" min="0" max="100" class="form-input" value="${v('invoice.taxRate')}"/></div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div class="form-group"><label class="form-label">Credit Terms (days)</label><input name="invoice.creditTermsDays" type="number" min="0" max="365" class="form-input" value="${v('invoice.creditTermsDays')}"/></div>
                  <div class="form-group"><label class="form-label">Max Discount Without Approval (%)</label><input name="sales.maxDiscountPercentWithoutApproval" type="number" step="0.1" min="0" max="100" class="form-input" value="${v('sales.maxDiscountPercentWithoutApproval')}"/></div>
                </div>
                <div class="form-group"><label class="form-label">Invoice Footer</label><input name="invoice.footer" class="form-input" maxlength="300" value="${v('invoice.footer')}"/></div>
                <div class="form-group"><label class="form-label">Monthly Revenue Target</label><input name="dashboard.targetRevenue" type="number" min="0" class="form-input" value="${v('dashboard.targetRevenue')}"/></div>
              </div>
            </div>
            <button type="submit" class="mt-2 px-6 py-2 bg-primary text-on-primary rounded-lg font-semibold">Save Settings</button>
          </form>
        </div>` : ''}

        <div class="page-section">
          <h3 class="text-headline-md mb-6">Profile</h3>
          <div class="flex items-start gap-5 mb-6">
            <button type="button" onclick="App.openProfileModal()" class="profile-avatar-preview h-20 w-20 rounded-full overflow-hidden bg-secondary flex items-center justify-center shrink-0 cursor-pointer hover:ring-2 hover:ring-secondary/40 transition-shadow" title="Change profile picture">
              ${avatarUrl
                ? `<img src="${avatarUrl}" alt="Profile picture" class="h-full w-full object-cover"/>`
                : `<span class="text-on-secondary text-2xl font-bold">${initial}</span>`}
            </button>
            <div class="min-w-0 pt-1">
              <p class="font-semibold">${Utils.escapeHtml(session.name)}</p>
              <p class="text-sm text-outline">${Utils.escapeHtml(session.email)}</p>
              <button type="button" onclick="App.openProfileModal()" class="mt-2 text-sm font-semibold text-secondary hover:underline">Change profile picture</button>
            </div>
          </div>
          <div class="space-y-4">
            <div><span class="text-label-sm text-outline">NAME</span><p class="font-semibold">${Utils.escapeHtml(session.name)}</p></div>
            <div><span class="text-label-sm text-outline">EMAIL</span><p>${Utils.escapeHtml(session.email)}</p></div>
            <div><span class="text-label-sm text-outline">ROLE</span><p>${Utils.roleBadge(session.role)}</p></div>
            ${session.stationName ? `<div><span class="text-label-sm text-outline">STATION</span><p>${Utils.escapeHtml(session.stationName)}</p></div>` : ''}
          </div>
        </div>

        <div class="page-section">
          <h3 class="text-headline-md mb-6">Change Password</h3>
          <form id="password-form" onsubmit="event.preventDefault(); SettingsPage.changePassword()">
            <div class="form-group">
              <label class="form-label">Current Password</label>
              <input name="currentPassword" type="password" class="form-input" required autocomplete="current-password"/>
            </div>
            <div class="form-group">
              <label class="form-label">New Password</label>
              <input name="newPassword" type="password" class="form-input" required minlength="8" autocomplete="new-password"/>
              <p class="text-xs text-outline mt-1">At least 8 characters, with letters and numbers.</p>
            </div>
            <div class="form-group">
              <label class="form-label">Confirm New Password</label>
              <input name="confirmPassword" type="password" class="form-input" required minlength="8" autocomplete="new-password"/>
            </div>
            <button type="submit" class="mt-2 px-6 py-2 bg-primary text-on-primary rounded-lg font-semibold">Update Password</button>
          </form>
          <div class="mt-6 pt-4 border-t border-outline-variant">
            <p class="font-semibold">Signed-in devices</p>
            <p class="text-sm text-outline mb-3">Lost a phone or used a shared computer? Sign out everywhere except here.</p>
            <button type="button" onclick="SettingsPage.signOutOthers()" class="px-4 py-2 border border-outline-variant rounded-lg text-sm hover:bg-surface-container-low">Sign out other devices</button>
          </div>
        </div>

        ${Auth.can('payments.configure') ? `<div class="page-section lg:col-span-2">
          <h3 class="text-headline-md mb-2">Payment Providers</h3>
          <p class="text-sm text-outline mb-4">Credentials are set in the server's environment file, never here. This panel shows status only.</p>
          <div id="payment-providers">${Utils.loadingState('Checking providers...')}</div>
        </div>` : ''}

      </div>
    `;
  },

  afterRender() {
    if (Auth.can('payments.configure')) this.loadProviders();
  },

  // SECTION: payment provider status — mode, availability, missing configuration (names only) and what to obtain
  async loadProviders() {
    const box = document.getElementById('payment-providers');
    if (!box) return;
    let res;
    try {
      res = await Api.get('/payments/providers/status');
    } catch (err) {
      box.innerHTML = Utils.errorState(err.message, 'SettingsPage.loadProviders()');
      return;
    }
    const origin = window.location.origin;
    box.innerHTML = `
      <div class="p-3 rounded-lg mb-4 ${res.mode === 'sandbox' ? 'bg-tertiary-fixed-dim/20 border border-tertiary-fixed-dim' : 'bg-surface-container-low'}">
        Mode: <strong>${res.mode === 'sandbox' ? 'SANDBOX (simulated, development only)' : 'LIVE'}</strong>
        ${res.mode === 'sandbox' ? '<span class="text-sm text-outline"> — set PAYMENT_MODE=live with real credentials and implemented adapters for production. The server refuses sandbox mode in production.</span>' : ''}
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        ${res.providers.map((p) => `
          <div class="border border-outline-variant rounded-xl p-4 space-y-2">
            <div class="flex justify-between items-center"><strong>${Utils.escapeHtml(p.label)}</strong>${Utils.badge(p.available ? (p.mode === 'sandbox' ? 'Sandbox' : 'Live') : 'Not available', p.available ? (p.mode === 'sandbox' ? 'warning' : 'success') : 'neutral')}</div>
            <p class="text-xs text-outline">Live integration: <strong>${p.liveImplemented ? 'implemented' : 'not implemented yet'}</strong> · obtain from ${Utils.escapeHtml(p.obtainFrom)}</p>
            <p class="text-xs"><span class="text-outline">Environment variables:</span> ${p.requiredEnv.map((k) => `<code class="${p.missingEnv.includes(k) ? 'text-error' : 'text-secondary'}">${k}</code>`).join(' ')}</p>
            <details class="text-xs"><summary class="cursor-pointer text-secondary">Documents needed to go live</summary>
              <ul class="list-disc ml-4 mt-1 space-y-1">${p.documents.map((d) => `<li>${Utils.escapeHtml(d)}</li>`).join('')}</ul></details>
            <p class="text-xs text-outline">Webhook URL: <code>${Utils.escapeHtml(origin)}/api/webhooks/${p.method.toLowerCase()}</code></p>
          </div>`).join('')}
      </div>`;
  },

  // SECTION: signOutOthers — revokes every session of this user except the current one
  async signOutOthers() {
    const res = await Utils.act(() => Api.get('/auth/sessions'));
    if (!res) return;
    const others = res.sessions.filter((s) => !s.current).length;
    if (!others) return Utils.toast('You are not signed in anywhere else', 'info');
    Utils.confirm(`Sign out ${others} other device(s)?`, async () => {
      await Utils.act(() => Api.post('/auth/sessions/revoke-others'), 'Other devices signed out');
    });
  },

  // SECTION: changePassword — verifies current password on the server; other sessions are signed out
  async changePassword() {
    const form = document.getElementById('password-form');
    if (form.newPassword.value !== form.confirmPassword.value) {
      return Utils.toast('New passwords do not match', 'error');
    }
    try {
      await Api.post('/auth/change-password', { currentPassword: form.currentPassword.value, newPassword: form.newPassword.value });
      form.reset();
      Utils.toast('Password updated. Other devices have been signed out.', 'success');
    } catch (err) {
      Utils.toast(err.fullMessage || err.message, 'error');
    }
  },

  // SECTION: save — sends the business/billing form to PUT /api/settings and refreshes branding
  async save() {
    const d = Utils.getFormData('settings-form');
    const payload = { ...d, 'currency.code': (d['currency.code'] || '').toUpperCase() };
    if (this.pendingLogo !== undefined) payload['company.logoUrl'] = this.pendingLogo;
    const res = await Utils.act(() => Api.put('/settings', payload), 'Settings saved');
    if (!res) return;
    App.settings = res.settings;
    this.pendingLogo = undefined;
    App.renderNav();
    Router.refresh();
  },

  // SECTION: logo upload — validated image read as a data URL; saved with the form
  pendingLogo: undefined,
  async pickLogo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      this.pendingLogo = await Utils.readImageAsDataUrl(file, 250 * 1024);
      document.getElementById('logo-preview').innerHTML = `<img src="${this.pendingLogo}" class="max-h-full max-w-full object-contain" alt="Logo"/>`;
    } catch (err) {
      Utils.toast(err.message.replace('512KB', '250KB'), 'error');
    }
  },

  clearLogo() {
    this.pendingLogo = '';
    document.getElementById('logo-preview').innerHTML = '<span class="text-xs text-outline">No logo</span>';
  },


};

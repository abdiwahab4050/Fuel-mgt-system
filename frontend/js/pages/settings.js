/**
 * Settings Page
 */
// SECTION: Settings page object — company preferences, profile display, and data reset; add settings sections here
const SettingsPage = {
  // SECTION: render — settings form, session profile, and data management; add tabs or new setting groups here
  render() {
    // SECTION: load settings and session — current app config and logged-in user; add more profile fields here
    const settings = Store.getAll().settings;
    const session = Auth.getSession();

    return `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">System Settings</h2>
          <p class="text-body-md text-outline mt-1">Configure system preferences and company details</p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="page-section">
          <h3 class="text-headline-md mb-6">General Settings</h3>
          <form id="settings-form">
            <div class="form-group">
              <label class="form-label">Company Name</label>
              <input name="companyName" class="form-input" value="${Utils.escapeHtml(settings.companyName)}"/>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div class="form-group">
                <label class="form-label">Currency</label>
                <select name="currency" class="form-select">
                  <option value="USD" ${settings.currency === 'USD' ? 'selected' : ''}>USD ($)</option>
                  <option value="EUR" ${settings.currency === 'EUR' ? 'selected' : ''}>EUR (€)</option>
                  <option value="GBP" ${settings.currency === 'GBP' ? 'selected' : ''}>GBP (£)</option>
                  <option value="NGN" ${settings.currency === 'NGN' ? 'selected' : ''}>NGN (₦)</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Monthly Revenue Target</label>
                <input name="targetRevenue" type="number" class="form-input" value="${settings.targetRevenue}"/>
              </div>
            </div>
            <div class="form-group flex items-center gap-3">
              <input type="checkbox" name="lowStockAlertEnabled" id="low-stock" ${settings.lowStockAlertEnabled ? 'checked' : ''} class="rounded"/>
              <label for="low-stock" class="form-label mb-0">Enable Low Stock Alerts</label>
            </div>
            <button type="button" onclick="SettingsPage.save()" class="mt-4 px-6 py-2 bg-primary text-on-primary rounded-lg font-semibold">Save Settings</button>
          </form>
        </div>

        <div class="page-section">
          <h3 class="text-headline-md mb-6">Profile</h3>
          <div class="space-y-4">
            <div><span class="text-label-sm text-outline">NAME</span><p class="font-semibold">${Utils.escapeHtml(session.name)}</p></div>
            <div><span class="text-label-sm text-outline">EMAIL</span><p>${Utils.escapeHtml(session.email)}</p></div>
            <div><span class="text-label-sm text-outline">ROLE</span><p>${Utils.roleBadge(session.role)}</p></div>
          </div>
        </div>

        <div class="page-section lg:col-span-2">
          <h3 class="text-headline-md mb-4">Data Management</h3>
          <p class="text-body-md text-outline mb-4">Reset all data to seed defaults. This action cannot be undone.</p>
          <button onclick="SettingsPage.resetData()" class="px-4 py-2 border border-error text-error rounded-lg hover:bg-error-container">Reset to Seed Data</button>
        </div>
      </div>
    `;
  },

  // SECTION: save — reads form and persists settings to Store; sync currency symbol map when adding currencies
  save() {
    const form = document.getElementById('settings-form');
    const data = Store.getAll();
    const symbols = { USD: '$', EUR: '€', GBP: '£', NGN: '₦' };
    data.settings = {
      companyName: form.companyName.value,
      currency: form.currency.value,
      currencySymbol: symbols[form.currency.value] || '$',
      targetRevenue: +form.targetRevenue.value,
      lowStockAlertEnabled: form.lowStockAlertEnabled.checked,
    };
    Store.save(data);
    Utils.toast('Settings saved', 'success');
    document.querySelector('.sidebar h1').textContent = data.settings.companyName;
  },

  // SECTION: resetData — confirms and restores seed data via Store.reset; add backup export before reset here
  resetData() {
    Utils.confirm('Reset all data to defaults? This cannot be undone.', () => {
      Store.reset();
      Utils.toast('Data reset to seed defaults', 'success');
      Router.refresh();
    });
  },
};

/**
 * FuelFlow ERP - Authentication (server sessions)
 */
const Auth = {
  // SECTION: in-memory copy of the signed-in user from GET /api/auth/me; the httpOnly cookie is the real session
  _session: null,

  // SECTION: role keys → display labels; the server's roleName is preferred when available
  ROLE_LABELS: {
    super_admin: 'Super Administrator',
    station_manager: 'Station Manager',
    cashier: 'Cashier',
    attendant: 'Fuel Attendant',
    accountant: 'Accountant',
    customer: 'Customer',
  },

  // SECTION: loads the current user from the server; returns null when not signed in
  async load() {
    try {
      const { user } = await Api.get('/auth/me');
      this._session = user;
    } catch (err) {
      this._session = null;
      if (err.status !== 401) throw err;
    }
    return this._session;
  },

  // SECTION: signs in via the API; returns { success, user | message } like the original Store-based login
  async login(email, password) {
    try {
      const { user } = await Api.post('/auth/login', { email, password });
      this._session = user;
      return { success: true, user };
    } catch (err) {
      return { success: false, message: err.fullMessage || err.message };
    }
  },

  // SECTION: ends the server session; pass redirect=false to stay on the current page
  async logout(redirect = true) {
    try {
      await Api.post('/auth/logout');
    } catch {
      // already signed out or offline — clear locally either way
    }
    this._session = null;
    if (redirect) window.location.href = 'index.html';
  },

  // SECTION: synchronous accessor used by pages after App.init has loaded the session
  getSession() {
    return this._session;
  },

  // SECTION: guards protected pages; resolves to the session or redirects to login
  async requireAuth() {
    const session = await this.load();
    if (!session) {
      window.location.href = 'index.html';
      return null;
    }
    return session;
  },

  // SECTION: permission checks — true when the user holds any of the given permission keys
  can(...keys) {
    const perms = this._session?.permissions || [];
    return keys.some((k) => perms.includes(k));
  },

  isAdmin() {
    return this._session?.role === 'super_admin';
  },

  roleLabel(role) {
    if (this._session?.role === role && this._session.roleName) return this._session.roleName;
    return this.ROLE_LABELS[role] || role;
  },

  // SECTION: patches the cached session after profile changes (e.g. avatar)
  updateSession(patch) {
    if (this._session) Object.assign(this._session, patch);
  },
};

// SECTION: expose Auth on window for inline handlers and other scripts; remove if using modules only
window.Auth = Auth;

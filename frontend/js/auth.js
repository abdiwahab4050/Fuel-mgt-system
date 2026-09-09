/**
 * FuelFlow ERP - Authentication
 */
const Auth = {
  // SECTION: localStorage key for the active user session; change if renaming session storage
  SESSION_KEY: 'fuelflow_session',

  // SECTION: validates credentials against Store users and creates a session; change lookup rules or session fields here
  login(email, password) {
    // SECTION: load users and find matching active account; change match criteria (e.g. case-insensitive email) here
    const users = Store.get('users');
    const user = users.find((u) => u.email === email && u.password === password && u.status === 'active');
    if (!user) return { success: false, message: 'Invalid email or password' };

    // SECTION: build session payload and persist to localStorage; add or remove session properties here
    const session = {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      loginAt: new Date().toISOString(),
    };
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
    Store.addAuditLog(user.id, 'Login', `${user.name} logged in as ${this.roleLabel(user.role)}`);
    return { success: true, user: session };
  },

  // SECTION: demo quick-login by role using seeded credentials; update accounts map when demo users change
  loginAsRole(role) {
    const accounts = {
      admin: { email: 'admin@fuelflow.com', password: 'admin123' },
      attendant: { email: 'attendant@fuelflow.com', password: 'attendant123' },
      fleet_manager: { email: 'fleet@fuelflow.com', password: 'fleet123' },
    };
    const creds = accounts[role];
    if (!creds) return { success: false, message: 'Unknown role' };
    return this.login(creds.email, creds.password);
  },

  // SECTION: clears session, logs audit entry, and redirects to login; change redirect target or audit action here
  logout() {
    const session = this.getSession();
    if (session) {
      Store.addAuditLog(session.userId, 'Logout', `${session.name} logged out`);
    }
    localStorage.removeItem(this.SESSION_KEY);
    window.location.href = 'index.html';
  },

  // SECTION: reads and parses session from localStorage; returns null when not logged in
  getSession() {
    const raw = localStorage.getItem(this.SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  },

  // SECTION: guards protected pages by redirecting unauthenticated users; change redirect URL if login page moves
  requireAuth() {
    const session = this.getSession();
    if (!session) {
      window.location.href = 'index.html';
      return null;
    }
    return session;
  },

  // SECTION: checks whether current session has admin role; adjust role name if roles change
  isAdmin() {
    return this.getSession()?.role === 'admin';
  },

  // SECTION: maps internal role keys to display labels; add new roles and labels here
  roleLabel(role) {
    const labels = { admin: 'Administrator', attendant: 'Fuel Attendant', fleet_manager: 'Fleet Manager' };
    return labels[role] || role;
  },
};

// SECTION: expose Auth on window for inline handlers and other scripts; remove if using modules only
window.Auth = Auth;

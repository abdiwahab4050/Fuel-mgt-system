/**
 * Users Page
 */
// SECTION: Users page object — staff accounts, roles, stations, password reset; data comes from /api/users
const UsersPage = {
  searchTerm: '',
  page: 1,
  editingId: null,
  // SECTION: API data cache; null = not loaded yet, reset on every visit via onEnter
  users: null,
  roles: [],
  stations: [],
  error: null,

  // SECTION: onEnter — called by Router when navigating to this page; forces a fresh load
  onEnter() {
    this.users = null;
    this.employees = null;
    this.error = null;
  },

  // SECTION: tabs — login accounts vs employee (HR) records
  tab: 'users',
  employees: null,
  setTab(tab) {
    this.tab = tab;
    Router.refresh();
  },

  // SECTION: load — fetches users, roles, and stations in parallel then re-renders
  async load() {
    try {
      const [{ users }, { roles }, { stations }] = await Promise.all([
        Api.get('/users'), Api.get('/roles'), Api.get('/stations'),
      ]);
      this.users = users;
      this.roles = roles;
      this.stations = stations;
      this.error = null;
    } catch (err) {
      this.error = err.message;
    }
    if (Router.currentPage === 'users') Router.refresh();
  },

  reload() {
    this.onEnter();
    Router.refresh();
  },

  // SECTION: render — user list with role/status badges; shows loading/error states while fetching
  render() {
    const canManage = Auth.can('users.manage');
    const header = `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">User Management</h2>
          <p class="text-body-md text-outline mt-1">Create users, assign roles and stations, and manage access</p>
        </div>
        ${canManage && this.tab === 'users' ? `<button onclick="UsersPage.openAdd()" class="px-4 py-2 bg-primary text-on-primary rounded-lg text-body-md font-semibold flex items-center gap-2">
          <span class="material-symbols-outlined text-lg">person_add</span> Create User
        </button>` : ''}
        ${Auth.can('employees.manage') && this.tab === 'employees' ? `<button onclick="UsersPage.openEmployeeForm()" class="px-4 py-2 bg-primary text-on-primary rounded-lg text-body-md font-semibold flex items-center gap-2">
          <span class="material-symbols-outlined text-lg">badge</span> Add Employee
        </button>` : ''}
      </div>
      ${Auth.can('employees.manage') ? `<div class="tab-list mb-6">
        <button class="tab-btn ${this.tab === 'users' ? 'active' : ''}" onclick="UsersPage.setTab('users')">Login Accounts</button>
        <button class="tab-btn ${this.tab === 'employees' ? 'active' : ''}" onclick="UsersPage.setTab('employees')">Employees</button>
      </div>` : ''}`;

    if (this.error) return header + Utils.errorState(this.error, 'UsersPage.reload()');
    if (!this.users) return header + Utils.loadingState('Loading users...');
    if (this.tab === 'employees') return header + this.renderEmployees();

    // SECTION: filter users — search by name, email, or role
    const q = this.searchTerm.toLowerCase();
    const users = q
      ? this.users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.name.toLowerCase().includes(q))
      : this.users;
    const paginated = Utils.paginate(users, this.page, 10);
    const self = Auth.getSession()?.userId;
    const statusBadge = { ACTIVE: ['Active', 'success'], SUSPENDED: ['Suspended', 'warning'], DISABLED: ['Disabled', 'neutral'] };

    // SECTION: table rows — edit, reset password, disable (never for own account)
    const tableRows = paginated.items.map((u) => {
      const [label, type] = statusBadge[u.status] || [u.status, 'neutral'];
      const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
      return `
      <tr>
        <td class="font-semibold">${Utils.escapeHtml(u.name)}</td>
        <td>${Utils.escapeHtml(u.email)}</td>
        <td>${Utils.roleBadge(u.role.key)}</td>
        <td>${Utils.escapeHtml(u.station?.name || 'All stations')}</td>
        <td>${Utils.badge(label, type)} ${locked ? Utils.badge('Locked', 'danger') : ''}</td>
        <td>${u.lastLoginAt ? Utils.formatDateTime(u.lastLoginAt) : '<span class="text-outline">Never</span>'}</td>
        <td class="whitespace-nowrap">
          ${canManage ? `
            <button onclick="UsersPage.openEdit('${u.id}')" class="text-secondary hover:underline text-sm mr-2">Edit</button>
            <button onclick="UsersPage.resetPassword('${u.id}')" class="text-primary hover:underline text-sm mr-2">Reset PW</button>
            ${u.id !== self && u.status !== 'DISABLED' ? `<button onclick="UsersPage.disable('${u.id}')" class="text-error hover:underline text-sm">Disable</button>` : ''}
          ` : '<span class="text-outline text-sm">View only</span>'}
        </td>
      </tr>`;
    });

    return header + `
      ${Utils.renderSearchFilter('Search users...', 'usr-search')}
      <div class="page-section">
        ${Utils.renderDataTable(['Name', 'Email', 'Role', 'Station', 'Status', 'Last Login', 'Actions'], tableRows)}
        ${Utils.renderPagination(paginated.page, paginated.pages, 'UsersPage.goToPage')}
      </div>
      <div class="page-section mt-6">
        <h3 class="text-headline-md mb-4">Roles &amp; Permissions</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          ${this.roles.map((r) => `
            <div class="border border-outline-variant rounded-lg p-4">
              <div class="flex justify-between items-center gap-2">${Utils.roleBadge(r.key)}<span class="text-label-sm text-outline">${r.userCount} user(s)</span></div>
              <p class="text-sm text-outline mt-2">${Utils.escapeHtml(r.description || '')}</p>
              <p class="text-xs text-outline mt-2">${r.permissions.length} permissions</p>
            </div>`).join('')}
        </div>
      </div>
    `;
  },

  // ─── Employees (HR records, separate from login accounts) ───

  async loadEmployees() {
    try {
      this.employees = (await Api.get('/employees')).employees;
    } catch (err) {
      this.employees = [];
      Utils.toast(err.message, 'error');
    }
    if (Router.currentPage === 'users') Router.refresh();
  },

  renderEmployees() {
    if (!this.employees) return Utils.loadingState('Loading employees...');
    const rows = this.employees.map((e) => `
      <tr>
        <td class="font-semibold text-data-mono whitespace-nowrap">${Utils.escapeHtml(e.employeeNo)}</td>
        <td class="font-semibold">${Utils.escapeHtml(e.fullName)}</td>
        <td>${Utils.escapeHtml(e.position)}</td>
        <td>${Utils.escapeHtml(e.station.name)}</td>
        <td>${Utils.escapeHtml(e.phone || '')}</td>
        <td>${e.hireDate ? Utils.formatDate(e.hireDate) : '—'}</td>
        <td class="text-data-mono">${e.salary != null ? Utils.formatCurrency(e.salary) : '—'}</td>
        <td>${e.user ? Utils.escapeHtml(e.user.email) : '<span class="text-outline">No login</span>'}</td>
        <td>${Utils.badge(e.status === 'ACTIVE' ? 'Active' : 'Inactive', e.status === 'ACTIVE' ? 'success' : 'neutral')}</td>
        <td><button onclick="UsersPage.openEmployeeForm('${e.id}')" class="text-secondary hover:underline text-sm">Edit</button></td>
      </tr>`);
    return `<div class="page-section">
      <p class="text-sm text-outline mb-4">Employee records hold HR details (position, hire date, salary). Link one to a login account if the person uses the system.</p>
      ${Utils.renderDataTable(['Emp #', 'Name', 'Position', 'Station', 'Phone', 'Hired', 'Salary', 'Login', 'Status', ''], rows, 'No employees yet')}</div>`;
  },

  openEmployeeForm(id = null) {
    const e = id ? this.employees.find((x) => x.id === id) : null;
    const v = (k) => (e?.[k] != null ? Utils.escapeHtml(e[k]) : '');
    const linked = new Set((this.employees || []).filter((x) => x.userId && x.id !== id).map((x) => x.userId));
    Utils.openModal(e ? `Edit ${Utils.escapeHtml(e.fullName)}` : 'Add Employee', `
      <form id="employee-form">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group"><label class="form-label">Full Name</label><input name="fullName" class="form-input" required value="${v('fullName')}"/></div>
          <div class="form-group"><label class="form-label">Position</label><input name="position" class="form-input" required value="${v('position')}" placeholder="Pump attendant"/></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-group"><label class="form-label">Phone</label><input name="phone" class="form-input" value="${v('phone')}"/></div>
          <div class="form-group"><label class="form-label">Hire Date</label><input name="hireDate" type="date" class="form-input" value="${e?.hireDate ? String(e.hireDate).slice(0, 10) : ''}"/></div>
          <div class="form-group"><label class="form-label">Monthly Salary</label><input name="salary" type="number" step="0.01" min="0" class="form-input" value="${v('salary')}"/></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          ${!e && !Auth.getSession().stationId ? `<div class="form-group"><label class="form-label">Station</label><select name="stationId" class="form-select">${this.stations.map((s) => `<option value="${s.id}">${Utils.escapeHtml(s.name)}</option>`).join('')}</select></div>` : ''}
          <div class="form-group"><label class="form-label">Login account (optional)</label><select name="userId" class="form-select"><option value="">— none —</option>
            ${this.users.filter((u) => !linked.has(u.id) && u.role.key !== 'customer').map((u) => `<option value="${u.id}" ${e?.userId === u.id ? 'selected' : ''}>${Utils.escapeHtml(u.name)} (${Utils.escapeHtml(u.email)})</option>`).join('')}</select></div>
          ${e ? `<div class="form-group"><label class="form-label">Status</label><select name="status" class="form-select"><option value="ACTIVE">Active</option><option value="INACTIVE" ${e.status === 'INACTIVE' ? 'selected' : ''}>Inactive</option></select></div>` : ''}
        </div>
      </form>`, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="UsersPage.saveEmployee(${e ? `'${e.id}'` : ''})" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>`);
  },

  async saveEmployee(id) {
    const d = Utils.getFormData('employee-form');
    const body = { ...d, userId: d.userId || null, salary: d.salary === '' ? null : d.salary, hireDate: d.hireDate || null };
    const ok = id ? await Utils.act(() => Api.patch(`/employees/${id}`, body), 'Employee updated') : await Utils.act(() => Api.post('/employees', body), 'Employee added');
    if (!ok) return;
    Utils.closeModal();
    this.employees = null;
    Router.refresh();
  },

  // SECTION: afterRender — triggers first load, binds search input
  afterRender() {
    if (!this.users && !this.error) this.load();
    if (this.tab === 'employees' && this.users && !this.employees) this.loadEmployees();
    const search = document.getElementById('usr-search');
    if (search) {
      search.value = this.searchTerm;
      search.addEventListener('input', (e) => {
        this.searchTerm = e.target.value;
        this.page = 1;
        Router.refresh();
        document.getElementById('usr-search')?.focus();
      });
    }
  },

  // SECTION: goToPage — pagination handler; change page size in render() paginate call
  goToPage(p) { this.page = p; Router.refresh(); },

  // SECTION: openAdd — opens empty user creation form
  openAdd() { this.openForm(); },
  // SECTION: openEdit — loads user by id into form (no password field)
  openEdit(id) { this.openForm(this.users?.find((u) => u.id === id)); },

  // SECTION: openForm — add/edit modal with role, station, status
  openForm(user = null) {
    this.editingId = user?.id || null;
    const isSelf = user?.id === Auth.getSession()?.userId;
    const assignable = this.roles.filter((r) => r.key !== 'super_admin' || Auth.isAdmin());
    Utils.openModal(user ? 'Edit User' : 'Create User', `
      <form id="user-form">
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input name="name" class="form-input" required value="${user ? Utils.escapeHtml(user.name) : ''}"/>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Email</label>
            <input name="email" type="email" class="form-input" required value="${user ? Utils.escapeHtml(user.email) : ''}"/>
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input name="phone" class="form-input" value="${user?.phone ? Utils.escapeHtml(user.phone) : ''}"/>
          </div>
        </div>
        ${!user ? `
          <div class="form-group">
            <label class="form-label">Password</label>
            <input name="password" type="password" class="form-input" required minlength="8" autocomplete="new-password"/>
            <p class="text-xs text-outline mt-1">At least 8 characters, with letters and numbers.</p>
          </div>
        ` : ''}
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="form-group">
            <label class="form-label">Role</label>
            <select name="roleKey" class="form-select" ${isSelf ? 'disabled' : ''}>
              ${assignable.map((r) => `<option value="${r.key}" ${user?.role.key === r.key ? 'selected' : ''}>${Utils.escapeHtml(r.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Station</label>
            <select name="stationId" class="form-select">
              <option value="">All stations</option>
              ${this.stations.map((s) => `<option value="${s.id}" ${user?.stationId === s.id ? 'selected' : ''}>${Utils.escapeHtml(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <select name="status" class="form-select" ${isSelf ? 'disabled' : ''}>
              ${['ACTIVE', 'SUSPENDED', 'DISABLED'].map((s) => `<option value="${s}" ${(user?.status || 'ACTIVE') === s ? 'selected' : ''}>${s.charAt(0) + s.slice(1).toLowerCase()}</option>`).join('')}
            </select>
          </div>
        </div>
        ${isSelf ? '<p class="text-xs text-outline">You cannot change your own role or status.</p>' : ''}
      </form>
    `, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button id="user-save-btn" onclick="UsersPage.save()" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>
    `);
  },

  // SECTION: save — creates or updates the user via the API
  async save() {
    const data = Utils.getFormData('user-form');
    const payload = { name: data.name, email: data.email, phone: data.phone || null, stationId: data.stationId || null };
    // disabled selects (own account) are not submitted, so only send role/status when present
    if (data.roleKey) payload.roleKey = data.roleKey;
    if (data.status) payload.status = data.status;

    const btn = document.getElementById('user-save-btn');
    if (btn) btn.disabled = true;
    try {
      if (this.editingId) {
        await Api.patch(`/users/${this.editingId}`, payload);
        Utils.toast('User updated', 'success');
      } else {
        await Api.post('/users', { ...payload, password: data.password });
        Utils.toast('User created', 'success');
      }
    } catch (err) {
      if (btn) btn.disabled = false;
      return Utils.toast(err.fullMessage || err.message, 'error');
    }
    Utils.closeModal();
    this.reload();
  },

  // SECTION: resetPassword — admin sets a new password; the user's sessions are signed out
  resetPassword(id) {
    const user = this.users?.find((u) => u.id === id);
    Utils.openModal('Reset Password', `
      <form id="reset-form">
        <input type="hidden" name="userId" value="${id}"/>
        <p class="text-sm text-outline mb-4">Set a new password for <strong>${Utils.escapeHtml(user?.name || '')}</strong>. They will be signed out everywhere.</p>
        <div class="form-group">
          <label class="form-label">New Password</label>
          <input name="password" type="password" class="form-input" required minlength="8" autocomplete="new-password"/>
        </div>
      </form>
    `, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="UsersPage.savePassword()" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Reset</button>
    `);
  },

  async savePassword() {
    const data = Utils.getFormData('reset-form');
    try {
      await Api.post(`/users/${data.userId}/reset-password`, { password: data.password });
    } catch (err) {
      return Utils.toast(err.fullMessage || err.message, 'error');
    }
    Utils.closeModal();
    Utils.toast('Password reset successfully', 'success');
    this.reload();
  },

  // SECTION: disable — users are never deleted because sales and audit history reference them
  disable(id) {
    const user = this.users?.find((u) => u.id === id);
    Utils.confirm(`Disable ${Utils.escapeHtml(user?.name || 'this user')}? They will be signed out and unable to log in. Their history is kept.`, async () => {
      try {
        await Api.del(`/users/${id}`);
        Utils.toast('User disabled', 'success');
      } catch (err) {
        Utils.toast(err.message, 'error');
      }
      this.reload();
    });
  },
};

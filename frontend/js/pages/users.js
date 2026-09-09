/**
 * Users Page (Admin only)
 */
// SECTION: Users page object — admin user CRUD, roles, and password reset; restrict roles or fields here
const UsersPage = {
  searchTerm: '',
  page: 1,
  editingId: null,

  // SECTION: render — user list with role/status badges; modify columns or self-delete rules here
  render() {
    // SECTION: filter users — search by name or email; add role filter here
    let users = Store.get('users');
    if (this.searchTerm) {
      users = users.filter((u) =>
        u.name.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        u.email.toLowerCase().includes(this.searchTerm.toLowerCase())
      );
    }
    const paginated = Utils.paginate(users, this.page, 10);

    // SECTION: table rows — user rows with edit, reset password, conditional delete; add last-login column here
    const tableRows = paginated.items.map((u) => `
      <tr>
        <td class="font-semibold">${Utils.escapeHtml(u.name)}</td>
        <td>${Utils.escapeHtml(u.email)}</td>
        <td>${Utils.roleBadge(u.role)}</td>
        <td>${Utils.badge(u.status === 'active' ? 'Active' : 'Inactive', u.status === 'active' ? 'success' : 'neutral')}</td>
        <td>${Utils.formatDate(u.createdAt)}</td>
        <td>
          <button onclick="UsersPage.openEdit('${u.id}')" class="text-secondary hover:underline text-sm mr-2">Edit</button>
          <button onclick="UsersPage.resetPassword('${u.id}')" class="text-primary hover:underline text-sm mr-2">Reset PW</button>
          ${u.id !== Auth.getSession()?.userId ? `<button onclick="UsersPage.delete('${u.id}')" class="text-error hover:underline text-sm">Delete</button>` : ''}
        </td>
      </tr>
    `);

    return `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">User Management</h2>
          <p class="text-body-md text-outline mt-1">Create users, assign roles, and manage access</p>
        </div>
        <button onclick="UsersPage.openAdd()" class="px-4 py-2 bg-primary text-on-primary rounded-lg text-body-md font-semibold flex items-center gap-2">
          <span class="material-symbols-outlined text-lg">person_add</span> Create User
        </button>
      </div>
      ${Utils.renderSearchFilter('Search users...', 'usr-search')}
      <div class="page-section">
        ${Utils.renderDataTable(['Name', 'Email', 'Role', 'Status', 'Created', 'Actions'], tableRows)}
        ${Utils.renderPagination(paginated.page, paginated.pages, 'UsersPage.goToPage')}
      </div>
    `;
  },

  // SECTION: afterRender — binds user search input; add role filter listener here
  afterRender() {
    document.getElementById('usr-search')?.addEventListener('input', (e) => {
      this.searchTerm = e.target.value;
      this.page = 1;
      Router.refresh();
    });
  },

  // SECTION: goToPage — pagination handler; change page size in render() paginate call
  goToPage(p) { this.page = p; Router.refresh(); },

  // SECTION: openAdd — opens empty user creation form
  openAdd() { this.openForm(); },
  // SECTION: openEdit — loads user by id into form (no password field)
  openEdit(id) { this.openForm(Store.getById('users', id)); },

  // SECTION: openForm — add/edit user modal with role and status; add permissions or 2FA fields here
  openForm(user = null) {
    this.editingId = user?.id || null;
    Utils.openModal(user ? 'Edit User' : 'Create User', `
      <form id="user-form">
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input name="name" class="form-input" required value="${user ? Utils.escapeHtml(user.name) : ''}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input name="email" type="email" class="form-input" required value="${user ? Utils.escapeHtml(user.email) : ''}"/>
        </div>
        ${!user ? `
          <div class="form-group">
            <label class="form-label">Password</label>
            <input name="password" type="password" class="form-input" required minlength="6"/>
          </div>
        ` : ''}
        <div class="grid grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Role</label>
            <select name="role" class="form-select">
              <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Administrator</option>
              <option value="attendant" ${user?.role === 'attendant' ? 'selected' : ''}>Fuel Attendant</option>
              <option value="fleet_manager" ${user?.role === 'fleet_manager' ? 'selected' : ''}>Fleet Manager</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <select name="status" class="form-select">
              <option value="active" ${user?.status === 'active' ? 'selected' : ''}>Active</option>
              <option value="inactive" ${user?.status === 'inactive' ? 'selected' : ''}>Inactive</option>
            </select>
          </div>
        </div>
      </form>
    `, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="UsersPage.save()" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>
    `);
  },

  // SECTION: save — creates or updates user; add password hashing or email uniqueness rules here
  save() {
    const data = Utils.getFormData('user-form');
    if (this.editingId) {
      const updates = { name: data.name, email: data.email, role: data.role, status: data.status };
      Store.update('users', this.editingId, updates);
      Utils.toast('User updated', 'success');
    } else {
      if (Store.get('users').some((u) => u.email === data.email)) {
        return Utils.toast('Email already exists', 'error');
      }
      data.createdAt = Utils.today();
      Store.add('users', data);
      Utils.toast('User created', 'success');
    }
    Utils.closeModal();
    Router.refresh();
  },

  // SECTION: resetPassword — opens modal to set new password for user; add strength meter or email notify here
  resetPassword(id) {
    Utils.openModal('Reset Password', `
      <form id="reset-form">
        <input type="hidden" name="userId" value="${id}"/>
        <div class="form-group">
          <label class="form-label">New Password</label>
          <input name="password" type="password" class="form-input" required minlength="6"/>
        </div>
      </form>
    `, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="UsersPage.savePassword()" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Reset</button>
    `);
  },

  // SECTION: savePassword — persists new password for user; hash password before Store.update here
  savePassword() {
    const data = Utils.getFormData('reset-form');
    Store.update('users', data.userId, { password: data.password });
    Utils.closeModal();
    Utils.toast('Password reset successfully', 'success');
  },

  // SECTION: delete — confirms and removes user; prevent delete of last admin if needed
  delete(id) {
    Utils.confirm('Delete this user?', () => {
      Store.remove('users', id);
      Utils.toast('User deleted', 'success');
      Router.refresh();
    });
  },
};

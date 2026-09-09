/**
 * Suppliers Page
 */
// SECTION: Suppliers page object — CRUD for fuel suppliers with search and pagination; extend state or table columns here
const SuppliersPage = {
  searchTerm: '',
  page: 1,
  editingId: null,

  // SECTION: render — supplier list with purchase counts and actions; modify filters or KPIs here
  render() {
    // SECTION: filter suppliers — search by name or contact person; add more filter criteria here
    let suppliers = Store.get('suppliers');
    if (this.searchTerm) {
      suppliers = suppliers.filter((s) =>
        s.name.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        s.contactPerson.toLowerCase().includes(this.searchTerm.toLowerCase())
      );
    }
    const paginated = Utils.paginate(suppliers, this.page, 10);

    // SECTION: table rows — supplier rows with linked purchase count; change columns or action buttons here
    const tableRows = paginated.items.map((s) => {
      const purchaseCount = Store.get('purchases').filter((p) => p.supplierId === s.id).length;
      return `
        <tr>
          <td class="font-semibold">${Utils.escapeHtml(s.name)}</td>
          <td>${Utils.escapeHtml(s.contactPerson)}</td>
          <td class="text-data-mono">${Utils.escapeHtml(s.phone)}</td>
          <td>${Utils.escapeHtml(s.email)}</td>
          <td class="max-w-[200px] truncate">${Utils.escapeHtml(s.address)}</td>
          <td>${purchaseCount} orders</td>
          <td>
            <button onclick="SuppliersPage.openEdit('${s.id}')" class="text-secondary hover:underline text-sm mr-2">Edit</button>
            <button onclick="SuppliersPage.delete('${s.id}')" class="text-error hover:underline text-sm">Delete</button>
          </td>
        </tr>`;
    });

    return `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Supplier Management</h2>
          <p class="text-body-md text-outline mt-1">Manage fuel suppliers and view purchase history</p>
        </div>
        <button onclick="SuppliersPage.openAdd()" class="px-4 py-2 bg-primary text-on-primary rounded-lg text-body-md font-semibold flex items-center gap-2">
          <span class="material-symbols-outlined text-lg">add</span> Add Supplier
        </button>
      </div>
      ${Utils.renderSearchFilter('Search suppliers...', 'sup-search')}
      <div class="page-section">
        ${Utils.renderDataTable(
          ['Supplier', 'Contact', 'Phone', 'Email', 'Address', 'Purchases', 'Actions'],
          tableRows
        )}
        ${Utils.renderPagination(paginated.page, paginated.pages, 'SuppliersPage.goToPage')}
      </div>
    `;
  },

  // SECTION: afterRender — binds supplier search input; add sort or advanced filters here
  afterRender() {
    const search = document.getElementById('sup-search');
    if (search) {
      search.value = this.searchTerm;
      search.addEventListener('input', () => { this.searchTerm = search.value; this.page = 1; Router.refresh(); });
    }
  },

  // SECTION: goToPage — pagination handler; change page size in render() paginate call
  goToPage(p) { this.page = p; Router.refresh(); },

  // SECTION: openAdd — opens empty supplier form; use for new supplier entry
  openAdd() { this.openForm(); },
  // SECTION: openEdit — loads supplier by id into form; pass different entity loader if schema changes
  openEdit(id) { this.openForm(Store.getById('suppliers', id)); },

  // SECTION: openForm — shared add/edit modal for supplier fields; add fields or validation hints here
  openForm(supplier = null) {
    this.editingId = supplier?.id || null;
    Utils.openModal(supplier ? 'Edit Supplier' : 'Add Supplier', `
      <form id="supplier-form">
        <div class="form-group">
          <label class="form-label">Supplier Name</label>
          <input name="name" class="form-input" required value="${supplier ? Utils.escapeHtml(supplier.name) : ''}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Contact Person</label>
          <input name="contactPerson" class="form-input" required value="${supplier ? Utils.escapeHtml(supplier.contactPerson) : ''}"/>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input name="phone" class="form-input" required value="${supplier ? Utils.escapeHtml(supplier.phone) : ''}"/>
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input name="email" type="email" class="form-input" required value="${supplier ? Utils.escapeHtml(supplier.email) : ''}"/>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <textarea name="address" class="form-textarea" required>${supplier ? Utils.escapeHtml(supplier.address) : ''}</textarea>
        </div>
      </form>
    `, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="SuppliersPage.save()" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>
    `);
  },

  // SECTION: save — creates or updates supplier in Store; add duplicate checks or audit logging here
  save() {
    const data = Utils.getFormData('supplier-form');
    if (this.editingId) {
      Store.update('suppliers', this.editingId, data);
      Utils.toast('Supplier updated', 'success');
    } else {
      Store.add('suppliers', data);
      Utils.toast('Supplier added', 'success');
    }
    Utils.closeModal();
    Router.refresh();
  },

  // SECTION: delete — confirms and removes supplier; block delete if purchases exist if needed
  delete(id) {
    Utils.confirm('Delete this supplier?', () => {
      Store.remove('suppliers', id);
      Utils.toast('Supplier deleted', 'success');
      Router.refresh();
    });
  },
};

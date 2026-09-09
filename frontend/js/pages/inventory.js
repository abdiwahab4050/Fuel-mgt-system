/**
 * Inventory Page
 */
// SECTION: Inventory page object — fuel types, stock levels, adjustments, and transfers; extend state or actions here
const InventoryPage = {
  searchTerm: '',
  page: 1,

  // SECTION: render — inventory table with low-stock alert, search, and pagination; modify columns or filters here
  render() {
    // SECTION: load fuel types and inventory — base data for table rows; add related Store collections if needed
    const fuelTypes = Store.get('fuelTypes');
    const inventory = Store.get('inventory');

    // SECTION: build table rows — maps fuel types to qty, status, prices; change status rules or row fields here
    const rows = fuelTypes.map((ft) => {
      const inv = inventory.find((i) => i.fuelTypeId === ft.id);
      const qty = inv?.quantity || 0;
      const status = Utils.stockStatus(qty, ft.capacity, ft.lowStockThreshold);
      return { ft, inv, qty, status };
    }).filter((r) => !this.searchTerm || r.ft.name.toLowerCase().includes(this.searchTerm.toLowerCase()));

    const paginated = Utils.paginate(rows, this.page, 8);

    // SECTION: table row HTML — renders paginated inventory rows with Adjust/Transfer actions; add columns or buttons here
    const tableRows = paginated.items.map(({ ft, inv, qty, status }) => `
      <tr>
        <td class="font-semibold">${Utils.escapeHtml(ft.name)}</td>
        <td class="text-data-mono">${Utils.formatNumber(qty)} ${ft.unit}</td>
        <td class="text-data-mono">${Utils.formatNumber(ft.capacity)} ${ft.unit}</td>
        <td>${Utils.badge(status.label, status.type)}</td>
        <td class="text-data-mono">${inv ? Utils.formatCurrency(inv.purchasePrice) : '-'}</td>
        <td class="text-data-mono">${inv ? Utils.formatCurrency(inv.sellingPrice) : '-'}</td>
        <td>${inv ? Utils.formatDate(inv.updatedAt?.split('T')[0]) : '-'}</td>
        <td>
          <button onclick="InventoryPage.openAdjust('${ft.id}')" class="text-secondary hover:underline text-sm mr-2">Adjust</button>
          <button onclick="InventoryPage.openTransfer('${ft.id}')" class="text-primary hover:underline text-sm">Transfer</button>
        </td>
      </tr>
    `);

    // SECTION: low stock alert — lists fuel types below threshold; change threshold source or alert styling here
    const lowStock = rows.filter((r) => r.status.type === 'danger');

    return `
      <div class="page-header">
        <div>
          <h2 class="text-headline-lg font-headline-lg">Fuel Inventory</h2>
          <p class="text-body-md text-outline mt-1">Manage fuel types, stock levels, and adjustments</p>
        </div>
        <div class="flex gap-3">
          <button onclick="InventoryPage.openAddFuelType()" class="px-4 py-2 border border-outline-variant rounded-lg text-body-md font-semibold hover:bg-surface-container-low">Add Fuel Type</button>
          <button onclick="InventoryPage.openAddStock()" class="px-4 py-2 bg-primary text-on-primary rounded-lg text-body-md font-semibold">Add Stock</button>
        </div>
      </div>

      ${lowStock.length ? `
        <div class="mb-6 p-4 bg-error-container border border-error/20 rounded-xl flex items-center gap-3">
          <span class="material-symbols-outlined text-error">warning</span>
          <div>
            <p class="font-semibold text-on-error-container">Low Stock Alert</p>
            <p class="text-sm text-on-error-container/80">${lowStock.map((r) => r.ft.name).join(', ')} below threshold</p>
          </div>
        </div>
      ` : ''}

      ${Utils.renderSearchFilter('Search fuel types...', 'inv-search')}

      <div class="page-section">
        ${Utils.renderDataTable(
          ['Fuel Type', 'Quantity', 'Capacity', 'Status', 'Purchase Price', 'Selling Price', 'Last Updated', 'Actions'],
          tableRows
        )}
        ${Utils.renderPagination(paginated.page, paginated.pages, 'InventoryPage.goToPage')}
      </div>
    `;
  },

  // SECTION: afterRender — binds search input to filter and reset page; add more filter listeners here
  afterRender() {
    const search = document.getElementById('inv-search');
    if (search) {
      search.value = this.searchTerm;
      search.addEventListener('input', () => {
        this.searchTerm = search.value;
        this.page = 1;
        Router.refresh();
      });
    }
  },

  // SECTION: goToPage — updates pagination page and refreshes view; change page size in render() paginate call
  goToPage(p) {
    this.page = p;
    Router.refresh();
  },

  // SECTION: openAddFuelType — modal form for new fuel type; add fields or validation messages here
  openAddFuelType() {
    Utils.openModal('Add Fuel Type', `
      <form id="fuel-type-form">
        <div class="form-group">
          <label class="form-label">Fuel Type Name</label>
          <input name="name" class="form-input" required placeholder="e.g. Premium Diesel"/>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Capacity (L)</label>
            <input name="capacity" type="number" class="form-input" required min="1"/>
          </div>
          <div class="form-group">
            <label class="form-label">Low Stock Threshold (%)</label>
            <input name="lowStockThreshold" type="number" class="form-input" required min="5" max="50" value="20"/>
          </div>
        </div>
      </form>
    `, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="InventoryPage.saveFuelType()" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Save</button>
    `);
  },

  // SECTION: saveFuelType — persists new fuel type and audit log; extend Store.add payload or validation here
  saveFuelType() {
    const data = Utils.getFormData('fuel-type-form');
    if (!data.name) return Utils.toast('Name is required', 'error');
    Store.add('fuelTypes', { name: data.name, unit: 'L', capacity: +data.capacity, lowStockThreshold: +data.lowStockThreshold });
    const session = Auth.getSession();
    Store.addAuditLog(session.userId, 'Fuel Type Added', data.name);
    Utils.closeModal();
    Utils.toast('Fuel type added', 'success');
    Router.refresh();
  },

  // SECTION: openAddStock — modal to add quantity and pricing for a fuel type; modify supplier/price fields here
  openAddStock() {
    const fuelTypes = Store.get('fuelTypes');
    const suppliers = Store.get('suppliers');
    Utils.openModal('Add Fuel Stock', `
      <form id="stock-form">
        <div class="form-group">
          <label class="form-label">Fuel Type</label>
          <select name="fuelTypeId" class="form-select" required>
            ${fuelTypes.map((ft) => `<option value="${ft.id}">${Utils.escapeHtml(ft.name)}</option>`).join('')}
          </select>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Quantity (L)</label>
            <input name="quantity" type="number" class="form-input" required min="1"/>
          </div>
          <div class="form-group">
            <label class="form-label">Supplier</label>
            <select name="supplierId" class="form-select">
              ${suppliers.map((s) => `<option value="${s.id}">${Utils.escapeHtml(s.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="form-group">
            <label class="form-label">Purchase Price</label>
            <input name="purchasePrice" type="number" step="0.01" class="form-input" required/>
          </div>
          <div class="form-group">
            <label class="form-label">Selling Price</label>
            <input name="sellingPrice" type="number" step="0.01" class="form-input" required/>
          </div>
        </div>
      </form>
    `, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="InventoryPage.saveStock()" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Add Stock</button>
    `);
  },

  // SECTION: saveStock — increases inventory and logs stock add; adjust updateInventory options or audit text here
  saveStock() {
    const data = Utils.getFormData('stock-form');
    Store.updateInventory(data.fuelTypeId, +data.quantity, {
      purchasePrice: +data.purchasePrice,
      sellingPrice: +data.sellingPrice,
      supplierId: data.supplierId,
    });
    const session = Auth.getSession();
    Store.addAuditLog(session.userId, 'Stock Added', `${data.quantity}L to ${Store.getFuelTypeName(data.fuelTypeId)}`);
    Utils.closeModal();
    Utils.toast('Stock added successfully', 'success');
    Router.refresh();
  },

  // SECTION: openAdjust — modal for +/- stock adjustment with reason; change adjustment rules or form fields here
  openAdjust(fuelTypeId) {
    const inv = Store.getInventoryByFuelType(fuelTypeId);
    Utils.openModal('Stock Adjustment', `
      <form id="adjust-form">
        <input type="hidden" name="fuelTypeId" value="${fuelTypeId}"/>
        <p class="text-body-md mb-4">Current stock: <strong>${Utils.formatNumber(inv?.quantity || 0)}L</strong></p>
        <div class="form-group">
          <label class="form-label">Adjustment (+/- Liters)</label>
          <input name="adjustment" type="number" class="form-input" required placeholder="e.g. 500 or -200"/>
        </div>
        <div class="form-group">
          <label class="form-label">Reason</label>
          <textarea name="reason" class="form-textarea" required placeholder="Reason for adjustment"></textarea>
        </div>
      </form>
    `, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="InventoryPage.saveAdjust()" class="px-4 py-2 bg-primary text-on-primary rounded font-semibold">Apply</button>
    `);
  },

  // SECTION: saveAdjust — applies delta to inventory and writes audit log; add approval or min-stock checks here
  saveAdjust() {
    const data = Utils.getFormData('adjust-form');
    Store.updateInventory(data.fuelTypeId, +data.adjustment);
    const session = Auth.getSession();
    Store.addAuditLog(session.userId, 'Stock Adjustment', `${Store.getFuelTypeName(data.fuelTypeId)} - ${data.reason}`);
    Utils.closeModal();
    Utils.toast('Stock adjusted', 'success');
    Router.refresh();
  },

  // SECTION: openTransfer — modal for inter-terminal stock transfer; replace static terminals or add validation here
  openTransfer(fuelTypeId) {
    Utils.openModal('Stock Transfer', `
      <form id="transfer-form">
        <input type="hidden" name="fuelTypeId" value="${fuelTypeId}"/>
        <div class="form-group">
          <label class="form-label">From Terminal</label>
          <select name="from" class="form-select"><option>Terminal A</option><option>Terminal B</option><option>Terminal C</option></select>
        </div>
        <div class="form-group">
          <label class="form-label">To Terminal</label>
          <select name="to" class="form-select"><option>Terminal A</option><option>Terminal B</option><option>Terminal C</option></select>
        </div>
        <div class="form-group">
          <label class="form-label">Quantity (L)</label>
          <input name="quantity" type="number" class="form-input" required min="1"/>
        </div>
      </form>
    `, `
      <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded">Cancel</button>
      <button onclick="InventoryPage.saveTransfer()" class="px-4 py-2 bg-secondary text-on-secondary rounded font-semibold">Transfer</button>
    `);
  },

  // SECTION: saveTransfer — records transfer in audit log only; implement actual inventory move between terminals here
  saveTransfer() {
    const data = Utils.getFormData('transfer-form');
    const session = Auth.getSession();
    Store.addAuditLog(session.userId, 'Stock Transfer', `${data.quantity}L ${Store.getFuelTypeName(data.fuelTypeId)} from ${data.from} to ${data.to}`);
    Utils.closeModal();
    Utils.toast('Transfer recorded', 'success');
    Router.refresh();
  },
};

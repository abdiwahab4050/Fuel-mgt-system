/**
 * FuelFlow ERP - Utility Functions
 */
const Utils = {
  // SECTION: formats amount using settings currency symbol and locale; change locale or decimal rules here
  formatCurrency(amount) {
    const settings = Store.getAll().settings;
    return `${settings.currencySymbol}${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  // SECTION: formats numeric values with configurable decimal places; change default decimals or locale here
  formatNumber(num, decimals = 0) {
    return Number(num).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  },

  // SECTION: formats date-only strings for display; change date parsing if input format changes
  formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  },

  // SECTION: relative or absolute datetime for notifications and logs; adjust thresholds or fallback format here
  formatDateTime(isoStr) {
    if (!isoStr) return '-';
    const d = new Date(isoStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} minutes ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  },

  // SECTION: returns today's date as YYYY-MM-DD ISO date part; change timezone handling if needed
  today() {
    return new Date().toISOString().split('T')[0];
  },

  // SECTION: checks if a date string matches today; use for highlighting same-day records
  isToday(dateStr) {
    return dateStr === this.today();
  },

  // SECTION: escapes HTML to prevent XSS in dynamic templates; use before inserting user text into innerHTML
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // SECTION: shows transient toast message; change duration, styling classes, or container id here
  toast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      // SECTION: create toast container on first use
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  },

  // SECTION: opens modal overlay with title, body, and optional footer HTML; change modal structure here
  openModal(title, bodyHtml, footerHtml = '') {
    let overlay = document.getElementById('modal-overlay');
    if (!overlay) {
      // SECTION: lazily create modal overlay and backdrop click-to-close handler
      overlay = document.createElement('div');
      overlay.id = 'modal-overlay';
      overlay.className = 'modal-overlay';
      overlay.innerHTML = '<div class="modal-content" id="modal-content"></div>';
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.closeModal();
      });
      document.body.appendChild(overlay);
    }
    const content = document.getElementById('modal-content');
    content.innerHTML = `
      <div class="p-6 border-b border-outline-variant">
        <div class="flex justify-between items-center">
          <h3 class="text-headline-md font-headline-md text-on-surface">${title}</h3>
          <button onclick="Utils.closeModal()" class="material-symbols-outlined text-outline hover:text-on-surface cursor-pointer">close</button>
        </div>
      </div>
      <div class="p-6">${bodyHtml}</div>
      ${footerHtml ? `<div class="p-6 border-t border-outline-variant flex justify-end gap-3">${footerHtml}</div>` : ''}
    `;
    overlay.classList.add('active');
  },

  // SECTION: hides modal overlay; call after confirm/cancel actions
  closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.remove('active');
  },

  // SECTION: confirmation dialog wrapper around openModal; change button labels or styling here
  confirm(message, onConfirm) {
    this.openModal(
      'Confirm Action',
      `<p class="text-body-md text-on-surface-variant">${message}</p>`,
      `
        <button onclick="Utils.closeModal()" class="px-4 py-2 border border-outline-variant rounded text-body-md hover:bg-surface-container-low">Cancel</button>
        <button id="confirm-btn" class="px-4 py-2 bg-error text-on-error rounded text-body-md font-semibold">Confirm</button>
      `
    );
    document.getElementById('confirm-btn').onclick = () => {
      this.closeModal();
      onConfirm();
    };
  },

  // SECTION: returns HTML span badge with type variant; add new badge types in CSS if needed
  badge(text, type = 'neutral') {
    return `<span class="badge badge-${type}">${this.escapeHtml(text)}</span>`;
  },

  // SECTION: maps user role to labeled badge; add roles and colors when roles expand
  roleBadge(role) {
    const map = {
      admin: ['Administrator', 'info'],
      attendant: ['Fuel Attendant', 'success'],
      fleet_manager: ['Fleet Manager', 'warning'],
    };
    const [label, type] = map[role] || [role, 'neutral'];
    return this.badge(label, type);
  },

  // SECTION: computes stock level label and severity from quantity vs capacity; tune threshold multipliers here
  stockStatus(quantity, capacity, threshold) {
    const pct = (quantity / capacity) * 100;
    if (pct <= threshold) return { label: 'Low Stock', type: 'danger', pct };
    if (pct <= threshold * 1.5) return { label: 'Moderate', type: 'warning', pct };
    return { label: 'In Stock', type: 'success', pct };
  },

  // SECTION: slices array into page window with metadata; change default perPage or page clamping here
  paginate(items, page = 1, perPage = 10) {
    const total = items.length;
    const pages = Math.ceil(total / perPage) || 1;
    const currentPage = Math.min(Math.max(1, page), pages);
    const start = (currentPage - 1) * perPage;
    return {
      items: items.slice(start, start + perPage),
      page: currentPage,
      pages,
      total,
      perPage,
    };
  },

  // SECTION: builds pagination button HTML with onclick handler name; change layout or prev/next labels here
  renderPagination(page, pages, onPageFn) {
    if (pages <= 1) return '';
    let btns = '';
    for (let i = 1; i <= pages; i++) {
      btns += `<button class="${i === page ? 'active' : ''}" onclick="${onPageFn}(${i})">${i}</button>`;
    }
    return `<div class="pagination">
      <button ${page <= 1 ? 'disabled' : ''} onclick="${onPageFn}(${page - 1})">Prev</button>
      ${btns}
      <button ${page >= pages ? 'disabled' : ''} onclick="${onPageFn}(${page + 1})">Next</button>
    </div>`;
  },

  // SECTION: renders table from header labels and row HTML strings; change empty state or table classes here
  renderDataTable(headers, rows, emptyMessage = 'No records found') {
    if (!rows.length) {
      return `<div class="text-center py-12 text-outline">${emptyMessage}</div>`;
    }
    return `
      <div class="overflow-x-auto custom-scrollbar">
        <table class="data-table">
          <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    `;
  },

  // SECTION: returns search input row HTML with optional extra filter slots; change input id contract per page
  renderSearchFilter(placeholder, id, extraFilters = '') {
    return `
      <div class="flex flex-wrap gap-4 mb-6">
        <div class="relative flex-1 min-w-[200px]">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg">search</span>
          <input id="${id}" type="text" placeholder="${placeholder}" class="form-input pl-10"/>
        </div>
        ${extraFilters}
      </div>
    `;
  },

  // SECTION: reads form fields into plain object via FormData; change if checkboxes or multi-select need special handling
  getFormData(formId) {
    const form = document.getElementById(formId);
    if (!form) return {};
    const data = {};
    new FormData(form).forEach((value, key) => {
      data[key] = value;
    });
    return data;
  },

  // SECTION: triggers browser download of CSV file; change delimiter, encoding, or success toast here
  exportCSV(filename, headers, rows) {
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    Utils.toast('CSV exported successfully', 'success');
  },

  // SECTION: role-based page access matrix; update permissions when adding pages or roles
  canAccess(role, page) {
    const allPages = ['dashboard', 'inventory', 'suppliers', 'purchases', 'sales', 'vehicles', 'consumption', 'reports', 'users', 'settings'];
    const permissions = {
      admin: allPages,
      attendant: ['dashboard', 'inventory', 'suppliers', 'purchases', 'sales', 'reports', 'settings'],
      fleet_manager: ['dashboard', 'inventory', 'vehicles', 'consumption', 'reports', 'settings'],
    };
    return (permissions[role] || allPages).includes(page);
  },
};

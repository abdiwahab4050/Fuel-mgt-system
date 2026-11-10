/**
 * FuelFlow ERP - Billing helpers (status badges, printable invoices/receipts/statements)
 */
const Billing = {
  // SECTION: status → badge type for invoices, sales, payments, refunds
  STATUS_TYPES: {
    PAID: 'success', PARTIALLY_PAID: 'warning', UNPAID: 'danger', REFUNDED: 'neutral', CANCELLED: 'neutral',
    COMPLETED: 'success', PARTIALLY_REFUNDED: 'warning',
    SUCCESSFUL: 'success', PENDING: 'warning', FAILED: 'danger',
    APPROVED: 'info', REJECTED: 'neutral',
    DRAFT: 'neutral', ORDERED: 'info', PARTIALLY_RECEIVED: 'warning', RECEIVED: 'success', CONFIRMED: 'success',
  },

  METHOD_LABELS: { CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', CREDIT_ACCOUNT: 'Credit account', ZAAD: 'ZAAD', EDAHAB: 'eDAHAB', MASTERCARD: 'Mastercard' },

  badge(status) {
    return Utils.badge(String(status).replace(/_/g, ' '), this.STATUS_TYPES[status] || 'neutral');
  },

  method(m) {
    return this.METHOD_LABELS[m] || m;
  },

  // per-liter prices keep up to 4 decimals (e.g. $1.8950)
  price(v) {
    const symbol = App.settings?.['currency.symbol'] || '$';
    return symbol + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  },

  // sandbox provider references start with SBX- and must never pass as real money on paper
  isSandbox(p) {
    return String(p.providerReference || '').startsWith('SBX-');
  },

  balance(inv) {
    return Math.max(0, Number(inv.total) - Number(inv.amountPaid));
  },

  // SECTION: printable document shell — plain CSS so it prints the same everywhere
  docShell(title, body) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${Utils.escapeHtml(title)}</title><style>
      *{box-sizing:border-box} body{font-family:Inter,Arial,sans-serif;color:#0b1c30;margin:0;padding:32px;font-size:13px}
      .head{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #0b1c30;padding-bottom:16px;margin-bottom:20px}
      .brand img{max-height:56px;max-width:180px;display:block;margin-bottom:6px} .brand h1{margin:0;font-size:20px}
      .muted{color:#5b6070} .right{text-align:right} h2{margin:0 0 4px;font-size:22px;letter-spacing:.04em}
      table{width:100%;border-collapse:collapse;margin:16px 0} th{background:#eff4ff;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
      th,td{padding:8px 10px;border-bottom:1px solid #dce2ee} td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
      .totals{margin-left:auto;width:300px} .totals td{border:none;padding:4px 10px} .totals .grand td{font-weight:700;font-size:15px;border-top:2px solid #0b1c30}
      .stamp{display:inline-block;padding:4px 12px;border:2px solid;border-radius:4px;font-weight:700;letter-spacing:.08em}
      .PAID{color:#006c49} .UNPAID,.CANCELLED{color:#ba1a1a} .PARTIALLY_PAID{color:#b87500} .REFUNDED{color:#5b6070}
      .grid{display:flex;gap:32px;margin-bottom:8px} .grid div{flex:1}
      .foot{margin-top:28px;border-top:1px solid #dce2ee;padding-top:12px;text-align:center}
      .receipt{max-width:320px;margin:0 auto;padding:12px;font-size:12px} .receipt table{margin:8px 0} .receipt th,.receipt td{padding:4px 2px}
      @media print{body{padding:0} .receipt{padding:0}}
    </style></head><body>${body}</body></html>`;
  },

  brandBlock() {
    const s = App.settings || {};
    const e = (k) => Utils.escapeHtml(s[k] || '');
    return `<div class="brand">
      ${s['company.logoUrl'] ? `<img src="${e('company.logoUrl')}" alt="">` : ''}
      <h1>${e('company.name')}</h1>
      <div class="muted">${[e('company.address'), e('company.phone'), e('company.email')].filter(Boolean).join(' · ')}</div>
      ${s['company.taxId'] ? `<div class="muted">Tax No: ${e('company.taxId')}</div>` : ''}
    </div>`;
  },

  customerName(inv) {
    return inv.customer?.name || inv.sale?.walkInName || 'Walk-in customer';
  },

  // SECTION: full A4 invoice
  invoiceHtml(inv) {
    const s = App.settings || {};
    const items = inv.sale?.items || [];
    const rows = items.map((i) => `<tr>
      <td>${Utils.escapeHtml(i.product.name)}${i.nozzle ? ` <span class="muted">(Pump ${Utils.escapeHtml(i.nozzle.pump.code)}/${Utils.escapeHtml(i.nozzle.code)})</span>` : ''}</td>
      <td class="num">${Utils.formatNumber(i.quantity, 3)} ${Utils.escapeHtml(i.product.unit || 'L')}</td>
      <td class="num">${this.price(i.unitPrice)}</td>
      <td class="num">${Number(i.discount) ? Utils.formatCurrency(-i.discount) : '—'}</td>
      <td class="num">${Utils.formatCurrency(i.lineTotal)}</td></tr>`).join('');
    const payments = (inv.payments || []).filter((p) => ['SUCCESSFUL', 'REFUNDED'].includes(p.status));
    const refunds = (inv.refunds || []).filter((r) => r.status === 'COMPLETED');
    return this.docShell(inv.invoiceNo, `
      <div class="head">${this.brandBlock()}
        <div class="right"><h2>INVOICE</h2>
          <div><strong>${Utils.escapeHtml(inv.invoiceNo)}</strong></div>
          <div class="muted">Issued ${Utils.formatDate(inv.issueDate)}</div>
          ${inv.dueDate ? `<div class="muted">Due ${Utils.formatDate(inv.dueDate)}</div>` : ''}
          ${inv.sale ? `<div class="muted">Sale ${Utils.escapeHtml(inv.sale.saleNo)}</div>` : ''}
          <div style="margin-top:8px"><span class="stamp ${inv.status}">${inv.status.replace(/_/g, ' ')}</span></div>
        </div></div>
      <div class="grid">
        <div><div class="muted">BILL TO</div><strong>${Utils.escapeHtml(this.customerName(inv))}</strong>
          ${inv.customer?.customerNo ? `<div class="muted">${Utils.escapeHtml(inv.customer.customerNo)}</div>` : ''}
          ${inv.customer?.phone || inv.sale?.walkInPhone ? `<div class="muted">${Utils.escapeHtml(inv.customer?.phone || inv.sale?.walkInPhone)}</div>` : ''}
          ${inv.customer?.address ? `<div class="muted">${Utils.escapeHtml(inv.customer.address)}</div>` : ''}</div>
        <div><div class="muted">STATION</div><strong>${Utils.escapeHtml(inv.station?.name || '')}</strong>
          ${inv.sale?.cashier ? `<div class="muted">Served by ${Utils.escapeHtml(inv.sale.cashier.name)}</div>` : ''}</div>
      </div>
      <table><thead><tr><th>Fuel</th><th class="num">Quantity</th><th class="num">Price / L</th><th class="num">Discount</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>
      <table class="totals">
        <tr><td>Subtotal</td><td class="num">${Utils.formatCurrency(inv.subtotal)}</td></tr>
        ${Number(inv.discount) ? `<tr><td>Discount</td><td class="num">${Utils.formatCurrency(-inv.discount)}</td></tr>` : ''}
        ${Number(inv.tax) ? `<tr><td>${Utils.escapeHtml(s['invoice.taxLabel'] || 'Tax')} (${Number(inv.taxRate)}%)</td><td class="num">${Utils.formatCurrency(inv.tax)}</td></tr>` : ''}
        <tr class="grand"><td>Total (${Utils.escapeHtml(inv.currency)})</td><td class="num">${Utils.formatCurrency(inv.total)}</td></tr>
        <tr><td>Paid</td><td class="num">${Utils.formatCurrency(inv.amountPaid)}</td></tr>
        ${refunds.length ? `<tr><td>Refunded</td><td class="num">${Utils.formatCurrency(-refunds.reduce((a, r) => a + Number(r.amount), 0))}</td></tr>` : ''}
        <tr><td><strong>Balance due</strong></td><td class="num"><strong>${Utils.formatCurrency(this.balance(inv))}</strong></td></tr>
      </table>
      ${payments.length ? `<table><thead><tr><th>Payment</th><th>Method</th><th>Date</th><th class="num">Amount</th></tr></thead><tbody>
        ${payments.map((p) => `<tr><td>${Utils.escapeHtml(p.paymentNo)}</td><td>${this.method(p.method)}${p.cardLast4 ? ` ••${Utils.escapeHtml(p.cardLast4)}` : ''}${this.isSandbox(p) ? ' <strong>(SANDBOX — not a real payment)</strong>' : ''}</td><td>${Utils.formatDate(p.verifiedAt || p.createdAt)}</td><td class="num">${Utils.formatCurrency(p.amount)}</td></tr>`).join('')}
      </tbody></table>` : ''}
      <div class="foot muted">${Utils.escapeHtml(s['invoice.footer'] || '')}</div>`);
  },

  // SECTION: compact 80mm receipt
  receiptHtml(inv) {
    const s = App.settings || {};
    const items = inv.sale?.items || [];
    const paid = (inv.payments || []).filter((p) => p.status === 'SUCCESSFUL');
    return this.docShell(`Receipt ${inv.invoiceNo}`, `<div class="receipt">
      <div style="text-align:center">${s['company.logoUrl'] ? `<img src="${Utils.escapeHtml(s['company.logoUrl'])}" style="max-height:40px" alt="">` : ''}
        <strong style="font-size:14px">${Utils.escapeHtml(s['company.name'] || '')}</strong>
        <div class="muted">${Utils.escapeHtml(inv.station?.name || '')}</div>
        <div class="muted">${Utils.escapeHtml(s['company.phone'] || '')}</div></div>
      <hr><div>${Utils.escapeHtml(inv.invoiceNo)}${inv.sale ? ` · ${Utils.escapeHtml(inv.sale.saleNo)}` : ''}</div>
      <div class="muted">${new Date(inv.issueDate).toLocaleString()}</div>
      <div>Customer: ${Utils.escapeHtml(this.customerName(inv))}</div>
      <table>${items.map((i) => `<tr><td>${Utils.escapeHtml(i.product.name)}<br><span class="muted">${Utils.formatNumber(i.quantity, 3)} L × ${this.price(i.unitPrice)}</span></td><td class="num">${Utils.formatCurrency(i.lineTotal)}</td></tr>`).join('')}</table>
      <table class="totals" style="width:100%">
        ${Number(inv.discount) ? `<tr><td>Discount</td><td class="num">${Utils.formatCurrency(-inv.discount)}</td></tr>` : ''}
        ${Number(inv.tax) ? `<tr><td>${Utils.escapeHtml(s['invoice.taxLabel'] || 'Tax')}</td><td class="num">${Utils.formatCurrency(inv.tax)}</td></tr>` : ''}
        <tr class="grand"><td>TOTAL</td><td class="num">${Utils.formatCurrency(inv.total)}</td></tr>
        ${paid.map((p) => `<tr><td>${this.method(p.method)}${this.isSandbox(p) ? ' (SANDBOX)' : ''}</td><td class="num">${Utils.formatCurrency(p.amount)}</td></tr>`).join('')}
        ${this.balance(inv) > 0 ? `<tr><td><strong>Balance due</strong></td><td class="num"><strong>${Utils.formatCurrency(this.balance(inv))}</strong></td></tr>` : ''}
      </table>
      <div style="text-align:center"><span class="stamp ${inv.status}">${inv.status.replace(/_/g, ' ')}</span></div>
      <div class="foot muted">${Utils.escapeHtml(s['invoice.footer'] || '')}</div></div>`);
  },

  // SECTION: customer statement
  statementHtml(st) {
    const rows = st.entries.map((e) => `<tr><td>${Utils.formatDate(e.date)}</td><td>${Utils.escapeHtml(e.reference)}</td><td>${Utils.escapeHtml(e.description)}</td>
      <td class="num">${Number(e.debit) ? Utils.formatCurrency(e.debit) : ''}</td><td class="num">${Number(e.credit) ? Utils.formatCurrency(e.credit) : ''}</td><td class="num">${Utils.formatCurrency(e.balance)}</td></tr>`).join('');
    return this.docShell(`Statement ${st.customer.customerNo}`, `
      <div class="head">${this.brandBlock()}
        <div class="right"><h2>STATEMENT</h2><div class="muted">${Utils.formatDate(st.from)} – ${Utils.formatDate(st.to)}</div></div></div>
      <div><div class="muted">CUSTOMER</div><strong>${Utils.escapeHtml(st.customer.name)}</strong> <span class="muted">${Utils.escapeHtml(st.customer.customerNo)}</span></div>
      <table><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th class="num">Charges</th><th class="num">Payments</th><th class="num">Balance</th></tr></thead>
      <tbody><tr><td colspan="5"><em>Opening balance</em></td><td class="num">${Utils.formatCurrency(st.opening)}</td></tr>${rows}</tbody></table>
      <table class="totals">
        <tr><td>Charges in period</td><td class="num">${Utils.formatCurrency(st.totals.invoiced)}</td></tr>
        <tr><td>Payments in period</td><td class="num">${Utils.formatCurrency(st.totals.paid)}</td></tr>
        <tr class="grand"><td>Closing balance</td><td class="num">${Utils.formatCurrency(st.closing)}</td></tr>
      </table>`);
  },

  // SECTION: print via a hidden iframe (no popup blocker); the browser's print dialog can also save as PDF
  print(html) {
    let frame = document.getElementById('print-frame');
    if (frame) frame.remove();
    frame = document.createElement('iframe');
    frame.id = 'print-frame';
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    frame.srcdoc = html;
    frame.onload = () => setTimeout(() => frame.contentWindow.print(), 150);
  },

  async printInvoice(invoiceId, kind = 'invoice') {
    const res = await Utils.act(() => Api.get(`/invoices/${invoiceId}`));
    if (!res) return;
    Api.post(`/invoices/${invoiceId}/print`).catch(() => {});
    this.print(kind === 'receipt' ? this.receiptHtml(res.invoice) : this.invoiceHtml(res.invoice));
  },
};

window.Billing = Billing;

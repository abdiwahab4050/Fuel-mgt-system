/**
 * FuelFlow ERP - Data Store (localStorage)
 */
const Store = {
  // SECTION: localStorage key for all app data; change if migrating storage namespace
  KEY: 'fuelflow_data',

  // SECTION: returns default seed dataset for first run or reset; edit demo records, thresholds, and settings here
  seed() {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();

    return {
      fuelTypes: [
        { id: 'ft1', name: 'Petrol (95 Octane)', unit: 'L', capacity: 50000, lowStockThreshold: 20 },
        { id: 'ft2', name: 'Diesel (Standard)', unit: 'L', capacity: 50000, lowStockThreshold: 20 },
        { id: 'ft3', name: 'Kerosene', unit: 'L', capacity: 20000, lowStockThreshold: 15 },
        { id: 'ft4', name: 'Aviation Fuel (JET-A1)', unit: 'L', capacity: 20000, lowStockThreshold: 15 },
      ],
      inventory: [
        { id: 'inv1', fuelTypeId: 'ft1', quantity: 41000, purchasePrice: 1.45, sellingPrice: 1.89, supplierId: 'sup1', updatedAt: now },
        { id: 'inv2', fuelTypeId: 'ft2', quantity: 22500, purchasePrice: 1.32, sellingPrice: 1.75, supplierId: 'sup2', updatedAt: now },
        { id: 'inv3', fuelTypeId: 'ft3', quantity: 8500, purchasePrice: 1.10, sellingPrice: 1.45, supplierId: 'sup1', updatedAt: now },
        { id: 'inv4', fuelTypeId: 'ft4', quantity: 18200, purchasePrice: 2.10, sellingPrice: 2.85, supplierId: 'sup3', updatedAt: now },
      ],
      suppliers: [
        { id: 'sup1', name: 'Refinery Group Inc.', contactPerson: 'James Morrison', phone: '+1 555-0101', email: 'james@refinerygroup.com', address: '1200 Industrial Blvd, Houston, TX' },
        { id: 'sup2', name: 'Gulf Coast Fuels', contactPerson: 'Sarah Chen', phone: '+1 555-0102', email: 'sarah@gulfcoast.com', address: '450 Port Avenue, New Orleans, LA' },
        { id: 'sup3', name: 'Aviation Supply Co.', contactPerson: 'Michael Torres', phone: '+1 555-0103', email: 'mtorres@avsupply.com', address: '88 Airport Road, Dallas, TX' },
        { id: 'sup4', name: 'Midwest Petroleum', contactPerson: 'Lisa Park', phone: '+1 555-0104', email: 'lpark@midwestpet.com', address: '2200 Pipeline Way, Chicago, IL' },
      ],
      purchases: [
        { id: 'pur1', purchaseNumber: 'PUR-2026-001', supplierId: 'sup1', fuelTypeId: 'ft1', quantity: 5000, unitCost: 1.42, totalCost: 7100, purchaseDate: today, invoiceNumber: 'INV-RG-4521' },
        { id: 'pur2', purchaseNumber: 'PUR-2026-002', supplierId: 'sup2', fuelTypeId: 'ft2', quantity: 7500, unitCost: 1.30, totalCost: 9750, purchaseDate: today, invoiceNumber: 'INV-GC-8832' },
        { id: 'pur3', purchaseNumber: 'PUR-2026-003', supplierId: 'sup3', fuelTypeId: 'ft4', quantity: 3000, unitCost: 2.05, totalCost: 6150, purchaseDate: '2026-05-28', invoiceNumber: 'INV-AV-1102' },
        { id: 'pur4', purchaseNumber: 'PUR-2026-004', supplierId: 'sup1', fuelTypeId: 'ft1', quantity: 10000, unitCost: 1.40, totalCost: 14000, purchaseDate: '2026-05-25', invoiceNumber: 'INV-RG-4498' },
        { id: 'pur5', purchaseNumber: 'PUR-2026-005', supplierId: 'sup4', fuelTypeId: 'ft3', quantity: 4000, unitCost: 1.08, totalCost: 4320, purchaseDate: '2026-05-20', invoiceNumber: 'INV-MP-7721' },
      ],
      sales: [
        { id: 'sal1', saleNumber: 'SAL-2026-001', fuelTypeId: 'ft1', quantity: 450, unitPrice: 1.89, totalAmount: 850.5, attendantId: 'usr2', date: today },
        { id: 'sal2', saleNumber: 'SAL-2026-002', fuelTypeId: 'ft2', quantity: 820, unitPrice: 1.75, totalAmount: 1435, attendantId: 'usr2', date: today },
        { id: 'sal3', saleNumber: 'SAL-2026-003', fuelTypeId: 'ft1', quantity: 1200, unitPrice: 1.89, totalAmount: 2268, attendantId: 'usr5', date: today },
        { id: 'sal4', saleNumber: 'SAL-2026-004', fuelTypeId: 'ft2', quantity: 650, unitPrice: 1.75, totalAmount: 1137.5, attendantId: 'usr2', date: '2026-05-29', invoiceNumber: '' },
        { id: 'sal5', saleNumber: 'SAL-2026-005', fuelTypeId: 'ft4', quantity: 200, unitPrice: 2.85, totalAmount: 570, attendantId: 'usr5', date: '2026-05-28' },
      ],
      vehicles: [
        { id: 'veh1', registrationNumber: 'TX-4421', name: 'Delivery Truck #442', type: 'Heavy Duty', driver: 'Robert Hayes', department: 'Logistics', status: 'active' },
        { id: 'veh2', registrationNumber: 'TX-8832', name: 'Sprinter Van #12', type: 'Sprinter', driver: 'Maria Lopez', department: 'Sales', status: 'active' },
        { id: 'veh3', registrationNumber: 'TX-1105', name: 'Tanker Unit #7', type: 'Heavy Duty', driver: 'David Kim', department: 'Transport', status: 'active' },
        { id: 'veh4', registrationNumber: 'TX-2290', name: 'Mid-Range Truck #18', type: 'Mid Range', driver: 'Angela Wright', department: 'Logistics', status: 'active' },
        { id: 'veh5', registrationNumber: 'TX-3344', name: 'Service Van #3', type: 'Sprinter', driver: 'Tom Bradley', department: 'Maintenance', status: 'maintenance' },
        { id: 'veh6', registrationNumber: 'TX-5567', name: 'Fleet EV #1', type: 'EV Fleet', driver: 'Nina Patel', department: 'Executive', status: 'active' },
      ],
      consumption: [
        { id: 'con1', vehicleId: 'veh1', driver: 'Robert Hayes', fuelTypeId: 'ft2', quantity: 120, mileage: 8.2, odometerReading: 145200, date: today },
        { id: 'con2', vehicleId: 'veh2', driver: 'Maria Lopez', fuelTypeId: 'ft1', quantity: 45, mileage: 4.5, odometerReading: 89200, date: today },
        { id: 'con3', vehicleId: 'veh3', driver: 'David Kim', fuelTypeId: 'ft2', quantity: 200, mileage: 8.5, odometerReading: 312000, date: '2026-05-29' },
        { id: 'con4', vehicleId: 'veh4', driver: 'Angela Wright', fuelTypeId: 'ft2', quantity: 85, mileage: 6.1, odometerReading: 178500, date: '2026-05-28' },
      ],
      users: [
        { id: 'usr1', name: 'Admin User', email: 'admin@fuelflow.com', password: 'admin123', role: 'admin', status: 'active', createdAt: '2026-01-01' },
        { id: 'usr2', name: 'John Attendant', email: 'attendant@fuelflow.com', password: 'attendant123', role: 'attendant', status: 'active', createdAt: '2026-01-15' },
        { id: 'usr3', name: 'Fleet Manager', email: 'fleet@fuelflow.com', password: 'fleet123', role: 'fleet_manager', status: 'active', createdAt: '2026-01-15' },
        { id: 'usr4', name: 'Sarah Admin', email: 'sarah@fuelflow.com', password: 'admin123', role: 'admin', status: 'active', createdAt: '2026-02-01' },
        { id: 'usr5', name: 'Mike Attendant', email: 'mike@fuelflow.com', password: 'attendant123', role: 'attendant', status: 'active', createdAt: '2026-03-01' },
      ],
      auditLogs: [
        { id: 'log1', userId: 'usr1', action: 'Stock Adjustment', details: 'Diesel - Correction of +500L at Terminal B', timestamp: new Date(Date.now() - 120000).toISOString() },
        { id: 'log2', userId: 'usr1', action: 'Purchase Created', details: 'Refinery Group Inc. - $14,250.00', timestamp: new Date(Date.now() - 2700000).toISOString() },
        { id: 'log3', userId: 'usr3', action: 'Low Stock Alert', details: 'Aviation JET-A1 at Terminal C below 15%', timestamp: new Date(Date.now() - 7200000).toISOString() },
        { id: 'log4', userId: 'usr3', action: 'Fleet Dispatch', details: 'Truck #442 dispatched from Refinery A', timestamp: new Date(Date.now() - 10800000).toISOString() },
      ],
      notifications: [
        { id: 'n1', type: 'warning', title: 'Low Stock Alert', message: 'Kerosene stock below 15% threshold', read: false, timestamp: now },
        { id: 'n2', type: 'info', title: 'New Purchase', message: 'PUR-2026-002 received from Gulf Coast Fuels', read: false, timestamp: now },
        { id: 'n3', type: 'danger', title: 'High Consumption', message: 'Tanker Unit #7 exceeded daily fuel limit', read: true, timestamp: '2026-05-29T10:00:00Z' },
      ],
      settings: {
        currency: 'USD',
        currencySymbol: '$',
        lowStockAlertEnabled: true,
        companyName: 'Star Fuel Station',
        targetRevenue: 1800000,
      },
      counters: {
        purchase: 6,
        sale: 6,
        user: 6,
      },
    };
  },

  // SECTION: ensures localStorage has data on first load; change init condition if using remote API instead
  init() {
    if (!localStorage.getItem(this.KEY)) {
      localStorage.setItem(this.KEY, JSON.stringify(this.seed()));
    }
  },

  // SECTION: loads full data object from localStorage; always calls init first
  getAll() {
    this.init();
    return JSON.parse(localStorage.getItem(this.KEY));
  },

  // SECTION: persists entire data object to localStorage; swap for API call when backend is added
  save(data) {
    localStorage.setItem(this.KEY, JSON.stringify(data));
  },

  // SECTION: returns a collection array by name; add default for new collections here
  get(collection) {
    return this.getAll()[collection] || [];
  },

  // SECTION: finds one record by id within a collection; change id field if schema differs
  getById(collection, id) {
    return this.get(collection).find((item) => item.id === id);
  },

  // SECTION: appends a record to a collection and saves; change id generation strategy here
  add(collection, item) {
    const data = this.getAll();
    if (!item.id) {
      item.id = `${collection.slice(0, 3)}_${Date.now()}`;
    }
    data[collection].push(item);
    this.save(data);
    return item;
  },

  // SECTION: merges updates into an existing record by id; returns null when not found
  update(collection, id, updates) {
    const data = this.getAll();
    const idx = data[collection].findIndex((item) => item.id === id);
    if (idx === -1) return null;
    data[collection][idx] = { ...data[collection][idx], ...updates };
    this.save(data);
    return data[collection][idx];
  },

  // SECTION: removes a record by id from a collection; does not cascade related records
  remove(collection, id) {
    const data = this.getAll();
    data[collection] = data[collection].filter((item) => item.id !== id);
    this.save(data);
  },

  // SECTION: increments counter and returns next formatted document number; add counter types in seed and formatNumber
  nextNumber(type) {
    const data = this.getAll();
    const num = data.counters[type] || 1;
    data.counters[type] = num + 1;
    this.save(data);
    return this.formatNumber(type, num);
  },

  // SECTION: previews next number without incrementing counter; use before form display
  peekNumber(type) {
    const data = this.getAll();
    const num = data.counters[type] || 1;
    return this.formatNumber(type, num);
  },

  // SECTION: builds PUR/SAL/USR prefixed numbers; change prefix pattern or padding here
  formatNumber(type, num) {
    const prefix = type === 'purchase' ? 'PUR' : type === 'sale' ? 'SAL' : 'USR';
    const year = new Date().getFullYear();
    return `${prefix}-${year}-${String(num).padStart(3, '0')}`;
  },

  // SECTION: appends an audit log entry with timestamp; change action naming convention here
  addAuditLog(userId, action, details) {
    this.add('auditLogs', {
      userId,
      action,
      details,
      timestamp: new Date().toISOString(),
    });
  },

  // SECTION: creates an unread in-app notification; adjust default fields or types here
  addNotification(type, title, message) {
    this.add('notifications', {
      type,
      title,
      message,
      read: false,
      timestamp: new Date().toISOString(),
    });
  },

  // SECTION: resolves fuel type id to display name; change fallback label here
  getFuelTypeName(id) {
    const ft = this.getById('fuelTypes', id);
    return ft ? ft.name : 'Unknown';
  },

  // SECTION: resolves supplier id to display name; change fallback label here
  getSupplierName(id) {
    const s = this.getById('suppliers', id);
    return s ? s.name : 'Unknown';
  },

  // SECTION: resolves user id to display name; change fallback label here
  getUserName(id) {
    const u = this.getById('users', id);
    return u ? u.name : 'Unknown';
  },

  // SECTION: resolves vehicle id to display name; change fallback label here
  getVehicleName(id) {
    const v = this.getById('vehicles', id);
    return v ? v.name : 'Unknown';
  },

  // SECTION: finds inventory row for a fuel type; change lookup if multiple tanks per type
  getInventoryByFuelType(fuelTypeId) {
    return this.get('inventory').find((i) => i.fuelTypeId === fuelTypeId);
  },

  // SECTION: adjusts inventory quantity and optional prices; change create-vs-update rules here
  updateInventory(fuelTypeId, quantityDelta, prices = {}) {
    const data = this.getAll();
    let inv = data.inventory.find((i) => i.fuelTypeId === fuelTypeId);
    // SECTION: update existing inventory row; clamp quantity at zero and merge price fields
    if (inv) {
      inv.quantity = Math.max(0, inv.quantity + quantityDelta);
      if (prices.purchasePrice) inv.purchasePrice = prices.purchasePrice;
      if (prices.sellingPrice) inv.sellingPrice = prices.sellingPrice;
      inv.updatedAt = new Date().toISOString();
    } else {
      // SECTION: create new inventory row when none exists for fuel type
      inv = {
        id: `inv_${Date.now()}`,
        fuelTypeId,
        quantity: Math.max(0, quantityDelta),
        purchasePrice: prices.purchasePrice || 0,
        sellingPrice: prices.sellingPrice || 0,
        supplierId: prices.supplierId || '',
        updatedAt: new Date().toISOString(),
      };
      data.inventory.push(inv);
    }
    this.save(data);
    return inv;
  },

  // SECTION: wipes storage and re-seeds demo data; use for dev reset only in production
  reset() {
    localStorage.setItem(this.KEY, JSON.stringify(this.seed()));
  },
};

// SECTION: bootstrap store on script load so data exists before other modules run
Store.init();

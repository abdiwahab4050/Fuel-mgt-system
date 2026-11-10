/**
 * Database seed — idempotent (safe to run repeatedly).
 *
 *  Always:   permissions, roles, role→permission links, default settings,
 *            expense categories, first super administrator.
 *  Demo:     (SEED_DEMO_DATA=true, never in production) the station, fuel
 *            products, tanks, pumps, suppliers, fleet and demo users carried
 *            over from the original localStorage seed in frontend/js/store.js.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, Prisma } from '@prisma/client';
import { PERMISSIONS, ROLES } from '../src/auth/permissions.js';

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12;
const D = (v) => new Prisma.Decimal(v);

// SECTION: permissions + roles; role permission sets are re-synced on every run
async function seedAccessControl() {
  for (const [module, keys] of Object.entries(PERMISSIONS)) {
    for (const key of keys) {
      await prisma.permission.upsert({ where: { key }, update: { module }, create: { key, module } });
    }
  }
  const permIds = Object.fromEntries((await prisma.permission.findMany()).map((p) => [p.key, p.id]));

  for (const [key, role] of Object.entries(ROLES)) {
    const saved = await prisma.role.upsert({
      where: { key },
      update: { name: role.name, description: role.description },
      create: { key, name: role.name, description: role.description },
    });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: saved.id } }),
      prisma.rolePermission.createMany({ data: role.permissions.map((p) => ({ roleId: saved.id, permissionId: permIds[p] })) }),
    ]);
  }
}

// SECTION: default settings (only created if missing so admin edits survive re-seeding)
const DEFAULT_SETTINGS = {
  'company.name': 'Star Fuel Station',
  'company.address': '',
  'company.phone': '',
  'company.email': '',
  'company.taxId': '',
  'company.logoUrl': '',
  'currency.code': 'USD',
  'currency.symbol': '$',
  'invoice.taxRate': 0,
  'invoice.taxLabel': 'VAT',
  'invoice.creditTermsDays': 30,
  'invoice.footer': 'Thank you for your business.',
  'inventory.lowStockAlerts': true,
  'sales.maxDiscountPercentWithoutApproval': 0,
  'dashboard.targetRevenue': 1800000,
};

async function seedSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
}

async function seedExpenseCategories() {
  const categories = [
    ['Electricity & Utilities', 'UTILITY'],
    ['Salaries & Wages', 'EMPLOYEE'],
    ['Staff Allowances', 'EMPLOYEE'],
    ['Pump & Equipment Maintenance', 'MAINTENANCE'],
    ['Building Maintenance', 'MAINTENANCE'],
    ['Transport', 'OPERATIONAL'],
    ['Office Supplies', 'OPERATIONAL'],
    ['Licences & Fees', 'OPERATIONAL'],
    ['Other', 'OTHER'],
  ];
  for (const [name, type] of categories) {
    await prisma.expenseCategory.upsert({ where: { name }, update: {}, create: { name, type } });
  }
}

async function upsertUser({ email, password, name, roleKey, stationId = null, phone = null }) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({
    data: { email, name, phone, roleId: role.id, stationId, passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) },
  });
}

async function seedSuperAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping super admin creation');
    return null;
  }
  if (process.env.NODE_ENV === 'production' && (password.length < 12 || password === 'change-me-now')) {
    throw new Error('Refusing to seed production super admin with a weak/default password');
  }
  return upsertUser({ email, password, name: 'Admin User', roleKey: 'super_admin' });
}

// SECTION: demo data — mirrors the original frontend seed (fuel types, inventory, suppliers, fleet)
async function seedDemo(admin) {
  const station = await prisma.station.upsert({
    where: { code: 'STN-001' },
    update: {},
    create: { code: 'STN-001', name: 'Star Fuel Station — Main', address: 'Main Road', phone: '+252 63 0000000' },
  });

  // Demo staff (passwords match the original demo accounts where they existed)
  await upsertUser({ email: 'attendant@fuelflow.com', password: 'attendant123', name: 'John Attendant', roleKey: 'attendant', stationId: station.id });
  await upsertUser({ email: 'fleet@fuelflow.com', password: 'fleet123', name: 'Fleet Manager', roleKey: 'station_manager', stationId: station.id });
  await upsertUser({ email: 'manager@fuelflow.com', password: 'manager123', name: 'Station Manager', roleKey: 'station_manager', stationId: station.id });
  await upsertUser({ email: 'cashier@fuelflow.com', password: 'cashier123', name: 'Mike Cashier', roleKey: 'cashier', stationId: station.id });
  await upsertUser({ email: 'accountant@fuelflow.com', password: 'accountant123', name: 'Amina Accountant', roleKey: 'accountant' });
  const customerUser = await upsertUser({ email: 'customer@fuelflow.com', password: 'customer123', name: 'Hodan Logistics', roleKey: 'customer' });

  // Products + tanks (capacity / levels / prices from the original seed)
  const products = [
    { code: 'PETROL', name: 'Petrol (95 Octane)', sellingPrice: '1.89', costPrice: '1.45', tank: 'T1', capacity: '50000', level: '41000', min: '10000' },
    { code: 'DIESEL', name: 'Diesel (Standard)', sellingPrice: '1.75', costPrice: '1.32', tank: 'T2', capacity: '50000', level: '22500', min: '10000' },
    { code: 'KEROSENE', name: 'Kerosene', sellingPrice: '1.45', costPrice: '1.10', tank: 'T3', capacity: '20000', level: '8500', min: '3000' },
    { code: 'JETA1', name: 'Aviation Fuel (JET-A1)', sellingPrice: '2.85', costPrice: '2.10', tank: 'T4', capacity: '20000', level: '18200', min: '3000' },
  ];

  const tanks = {};
  for (const p of products) {
    const product = await prisma.fuelProduct.upsert({
      where: { code: p.code },
      update: {},
      create: { code: p.code, name: p.name, sellingPrice: D(p.sellingPrice), costPrice: D(p.costPrice) },
    });
    let tank = await prisma.tank.findUnique({ where: { stationId_code: { stationId: station.id, code: p.tank } } });
    if (!tank) {
      // Tank level and its OPENING ledger row are written together so they always agree
      tank = await prisma.$transaction(async (tx) => {
        const t = await tx.tank.create({
          data: {
            code: p.tank, name: `${p.name} Tank`, stationId: station.id, productId: product.id,
            capacityLiters: D(p.capacity), currentLiters: D(p.level), minLevelLiters: D(p.min),
          },
        });
        await tx.stockMovement.create({
          data: { tankId: t.id, type: 'OPENING', quantity: D(p.level), balanceAfter: D(p.level), unitCost: D(p.costPrice), note: 'Opening stock (seed)', createdById: admin.id },
        });
        return t;
      });
    }
    tanks[p.code] = tank;
  }

  // Pumps: P1 (petrol + diesel), P2 (petrol + diesel), P3 (kerosene)
  const pumpLayout = [
    { code: 'P1', nozzles: [['N1', 'PETROL'], ['N2', 'DIESEL']] },
    { code: 'P2', nozzles: [['N1', 'PETROL'], ['N2', 'DIESEL']] },
    { code: 'P3', nozzles: [['N1', 'KEROSENE']] },
  ];
  for (const layout of pumpLayout) {
    const pump = await prisma.pump.upsert({
      where: { stationId_code: { stationId: station.id, code: layout.code } },
      update: {},
      create: { code: layout.code, name: `Pump ${layout.code.slice(1)}`, stationId: station.id },
    });
    for (const [code, productCode] of layout.nozzles) {
      await prisma.nozzle.upsert({
        where: { pumpId_code: { pumpId: pump.id, code } },
        update: {},
        create: { code, pumpId: pump.id, tankId: tanks[productCode].id },
      });
    }
  }

  // Suppliers (original seed)
  const suppliers = [
    ['SUP-001', 'Refinery Group Inc.', 'James Morrison', '+1 555-0101', 'james@refinerygroup.com', '1200 Industrial Blvd, Houston, TX'],
    ['SUP-002', 'Gulf Coast Fuels', 'Sarah Chen', '+1 555-0102', 'sarah@gulfcoast.com', '450 Port Avenue, New Orleans, LA'],
    ['SUP-003', 'Aviation Supply Co.', 'Michael Torres', '+1 555-0103', 'mtorres@avsupply.com', '88 Airport Road, Dallas, TX'],
    ['SUP-004', 'Midwest Petroleum', 'Lisa Park', '+1 555-0104', 'lpark@midwestpet.com', '2200 Pipeline Way, Chicago, IL'],
  ];
  for (const [code, name, contactPerson, phone, email, address] of suppliers) {
    await prisma.supplier.upsert({ where: { code }, update: {}, create: { code, name, contactPerson, phone, email, address } });
  }

  // Customers: one credit (business) customer linked to the portal login, one regular
  const business = await prisma.customer.upsert({
    where: { customerNo: 'CUS-2026-000001' },
    update: {},
    create: {
      customerNo: 'CUS-2026-000001', type: 'BUSINESS', name: 'Hodan Logistics', phone: '+252 63 4444444',
      email: 'customer@fuelflow.com', creditAllowed: true, creditLimit: D('5000'), userId: customerUser.id,
    },
  });
  await prisma.customer.upsert({
    where: { customerNo: 'CUS-2026-000002' },
    update: {},
    create: { customerNo: 'CUS-2026-000002', type: 'INDIVIDUAL', name: 'Ahmed Ali', phone: '+252 63 5555555' },
  });
  // keep the customer counter ahead of the seeded numbers
  await prisma.documentCounter.upsert({ where: { key: 'CUS:2026' }, update: {}, create: { key: 'CUS:2026', value: 2 } });

  // Fleet (original seed)
  const vehicles = [
    ['TX-4421', 'Delivery Truck #442', 'Heavy Duty', 'Robert Hayes', 'Logistics', 'ACTIVE'],
    ['TX-8832', 'Sprinter Van #12', 'Sprinter', 'Maria Lopez', 'Sales', 'ACTIVE'],
    ['TX-1105', 'Tanker Unit #7', 'Heavy Duty', 'David Kim', 'Transport', 'ACTIVE'],
    ['TX-2290', 'Mid-Range Truck #18', 'Mid Range', 'Angela Wright', 'Logistics', 'ACTIVE'],
    ['TX-3344', 'Service Van #3', 'Sprinter', 'Tom Bradley', 'Maintenance', 'MAINTENANCE'],
    ['TX-5567', 'Fleet EV #1', 'EV Fleet', 'Nina Patel', 'Executive', 'ACTIVE'],
  ];
  for (const [registrationNumber, name, type, driver, department, status] of vehicles) {
    await prisma.vehicle.upsert({
      where: { registrationNumber },
      update: {},
      create: { registrationNumber, name, type, driver, department, status, customerId: registrationNumber === 'TX-4421' ? business.id : null },
    });
  }

  console.log(`Demo data ready for station ${station.code}`);
}

async function main() {
  await seedAccessControl();
  await seedSettings();
  await seedExpenseCategories();
  const admin = await seedSuperAdmin();
  console.log(`Access control: ${Object.keys(ROLES).length} roles, ${Object.values(PERMISSIONS).flat().length} permissions`);

  const demo = process.env.SEED_DEMO_DATA === 'true' && process.env.NODE_ENV !== 'production';
  if (demo) {
    if (!admin) throw new Error('Demo data needs the super admin (set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)');
    await seedDemo(admin);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

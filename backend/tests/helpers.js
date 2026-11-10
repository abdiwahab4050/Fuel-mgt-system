/**
 * Shared test setup. Import FIRST in every test file (before src/ modules)
 * so NODE_ENV is set before the config module reads it.
 *
 * Integration tests use `needsDb` and are skipped when no database is reachable.
 */
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://unconfigured:unconfigured@127.0.0.1:1/unconfigured';

const { prisma } = await import('../src/db.js');

async function probe() {
  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]);
    return true;
  } catch {
    return false;
  }
}

export const dbUp = await probe();
export const needsDb = { skip: dbUp ? false : 'no database configured (set DATABASE_URL in backend/.env, migrate and seed)' };
export { prisma };

export const CSRF = { 'X-Requested-With': 'fuelflow' };

export const ADMIN = { email: process.env.SEED_ADMIN_EMAIL || 'admin@fuelflow.com', password: process.env.SEED_ADMIN_PASSWORD };
export const DEMO = {
  manager: { email: 'manager@fuelflow.com', password: 'manager123' },
  cashier: { email: 'cashier@fuelflow.com', password: 'cashier123' },
  attendant: { email: 'attendant@fuelflow.com', password: 'attendant123' },
  accountant: { email: 'accountant@fuelflow.com', password: 'accountant123' },
  customer: { email: 'customer@fuelflow.com', password: 'customer123' },
};

// Logs in with a supertest agent (keeps the cookie) and returns the agent
export async function loginAgent(request, app, creds) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(CSRF).send(creds);
  if (res.status !== 200) throw new Error(`login failed for ${creds.email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

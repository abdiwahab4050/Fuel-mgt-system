/**
 * Process entry point.
 */
import { env } from './config/env.js';
import { prisma } from './db.js';
import { createApp } from './app.js';
import { expireStalePayments } from './services/payments/index.js';
import { runDailyAlerts } from './services/alerts.js';

// SECTION: refuse to run on a non-UTF-8 database — names in Somali/Arabic script would be rejected or corrupted
try {
  const [{ server_encoding: encoding }] = await prisma.$queryRaw`SHOW server_encoding`;
  if (encoding !== 'UTF8') {
    console.error(`Database encoding is ${encoding}; FuelFlow requires a UTF8 database. Recreate it with ENCODING 'UTF8'.`);
    process.exit(1);
  }
} catch (err) {
  console.error('[startup] could not check the database encoding:', err.message);
}

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`FuelFlow API listening on ${env.APP_URL} (${env.NODE_ENV}, payments: ${env.PAYMENT_MODE})`);
});

// SECTION: payments sweep — re-check pending electronic payments with the provider and expire stale ones
const sweep = setInterval(() => {
  expireStalePayments().catch((err) => console.error('[payments] sweep failed:', err.message));
}, 60_000);
sweep.unref();

// SECTION: housekeeping — drop sessions that expired or were revoked more than 30 days ago
const cleanSessions = () => prisma.session
  .deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(Date.now() - 30 * 86400000) } }, { revokedAt: { lt: new Date(Date.now() - 30 * 86400000) } }] } })
  .catch((err) => console.error('[sessions] cleanup failed:', err.message));
setInterval(cleanSessions, 86_400_000).unref();

// SECTION: log anything that escapes request handling instead of dying silently
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1); // state may be corrupt; let the process manager restart it
});

// SECTION: daily alerts — checked hourly, sends at most once per day
const runAlerts = () => runDailyAlerts().catch((err) => console.error('[alerts] failed:', err.message));
setTimeout(runAlerts, 15_000).unref();
setInterval(runAlerts, 3_600_000).unref();

// SECTION: graceful shutdown so in-flight DB transactions finish
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}

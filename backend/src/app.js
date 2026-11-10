/**
 * Express application — API under /api, and the existing frontend/ served
 * from the same origin so session cookies work without CORS.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { prisma } from './db.js';
import { errorHandler, notFoundApi } from './middleware/error.js';
import { authenticate, csrfGuard } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import dashboardRoutes from './routes/dashboard.js';
import inventoryRoutes from './routes/inventory.js';
import stationRoutes from './routes/stations.js';
import notificationRoutes from './routes/notifications.js';
import settingsRoutes from './routes/settings.js';
import salesRoutes from './routes/sales.js';
import customerRoutes from './routes/customers.js';
import paymentRoutes, { webhookRouter } from './routes/payments.js';
import purchasingRoutes from './routes/purchasing.js';
import financeRoutes from './routes/finance.js';
import reportRoutes from './routes/reports.js';
import fleetRoutes from './routes/fleet.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '../../frontend');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // SECTION: security headers. No third-party scripts are allowed (Tailwind is prebuilt).
  // 'unsafe-inline' remains for the inline onclick handlers the pages still use.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://lh3.googleusercontent.com'],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    })
  );

  // keep the exact bytes for webhook signature verification
  // SECTION: request id + access log (method, path, status, duration — never bodies, tokens or query strings)
  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    if (env.NODE_ENV !== 'test' && req.path.startsWith('/api/')) {
      const started = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        console.log(`${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(0)}ms ${req.id}`);
      });
    }
    next();
  });

  // SECTION: API-wide rate limit per client IP (login has its own stricter limit)
  app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    limit: env.NODE_ENV === 'test' ? 100000 : 600,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/webhooks/') || req.path === '/health',
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
  }));

  app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use(express.urlencoded({ extended: false, limit: '256kb', verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use(cookieParser());

  // SECTION: API routes (modules are mounted here as each phase lands)
  const api = express.Router();

  api.get('/health', async (req, res) => {
    let database = 'up';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    res.status(database === 'up' ? 200 : 503).json({ status: database === 'up' ? 'ok' : 'degraded', database, time: new Date().toISOString() });
  });

  // Payment-provider webhooks authenticate by signature, not cookie/CSRF, so they mount before those guards
  api.use(webhookRouter);
  api.use(csrfGuard);
  api.use(authenticate);
  api.use('/auth', authRoutes);
  api.use(userRoutes);
  api.use(dashboardRoutes);
  api.use(inventoryRoutes);
  api.use(stationRoutes);
  api.use(notificationRoutes);
  api.use(settingsRoutes);
  api.use(salesRoutes);
  api.use(customerRoutes);
  api.use(paymentRoutes);
  api.use(purchasingRoutes);
  api.use(financeRoutes);
  api.use(fleetRoutes);
  api.use(reportRoutes); // after inventory/stations so their /reports/inventory and /reports/pump-reconciliation keep working

  api.use(notFoundApi);
  app.use('/api', api);

  // SECTION: static frontend; "/" opens the login page
  app.use(express.static(FRONTEND_DIR, {
    index: 'index.html',
    extensions: ['html'],
    // always revalidate pages so a deploy is picked up immediately
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  app.use(errorHandler);
  return app;
}

/**
 * Environment configuration — validated once at startup so a missing or
 * malformed variable fails fast instead of surfacing mid-request.
 */
import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  COOKIE_SECURE: bool,
  PAYMENT_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
  SEED_DEMO_DATA: bool,
  APP_TIMEZONE: z.string().default('Africa/Mogadishu'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}\nSee backend/.env.example`);
}

export const env = parsed.data;

// SECTION: business-day boundaries ("today", daily reports) follow the station's time zone
try {
  new Intl.DateTimeFormat('en-US', { timeZone: env.APP_TIMEZONE });
} catch {
  throw new Error(`APP_TIMEZONE "${env.APP_TIMEZONE}" is not a valid IANA time zone`);
}
process.env.TZ = env.APP_TIMEZONE;

// SECTION: the payment simulator must never run against real money
if (env.NODE_ENV === 'production' && env.PAYMENT_MODE === 'sandbox') {
  throw new Error('PAYMENT_MODE=sandbox is not allowed when NODE_ENV=production');
}

// SECTION: production must run behind HTTPS with secure cookies
if (env.NODE_ENV === 'production') {
  if (!env.COOKIE_SECURE) throw new Error('COOKIE_SECURE=true is required when NODE_ENV=production');
  if (!env.APP_URL.startsWith('https://')) throw new Error('APP_URL must use https:// when NODE_ENV=production');
}

export const isProd = env.NODE_ENV === 'production';

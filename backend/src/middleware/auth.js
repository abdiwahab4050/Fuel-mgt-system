/**
 * Authentication + authorization middleware.
 *
 *  authenticate        — attaches req.user (or null) from the session cookie
 *  requireAuth         — 401 when not signed in
 *  requirePermission   — 403 unless the user holds at least one of the keys
 *  csrfGuard           — state-changing API calls must carry X-Requested-With,
 *                        which a cross-site form or <img> cannot send
 */
import { prisma } from '../db.js';
import { SESSION_COOKIE, findSession } from '../auth/session.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'fuelflow';

export async function authenticate(req, res, next) {
  req.user = null;
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const session = await findSession(prisma, token);
  if (session) {
    const u = session.user;
    req.sessionToken = token;
    req.user = {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role.key,
      permissions: new Set(u.role.permissions.map((rp) => rp.permission.key)),
      stationId: u.stationId,
      customerId: u.customer?.id ?? null,
      record: u,
    };
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function can(user, ...keys) {
  return !!user && keys.some((k) => user.permissions.has(k));
}

export function requirePermission(...keys) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!can(req.user, ...keys)) return next(forbidden());
    next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.get(CSRF_HEADER) !== CSRF_VALUE) {
    return next(forbidden('Missing request verification header'));
  }
  next();
}

// SECTION: station scoping — station-bound users only ever see their own station
export function assertStationAccess(req, stationId) {
  if (req.user?.stationId && req.user.stationId !== stationId) {
    throw forbidden('This record belongs to another station');
  }
}

export function stationScope(req) {
  if (req.user?.stationId) return req.user.stationId;
  const q = req.query?.stationId;
  return typeof q === 'string' && q ? q : undefined;
}

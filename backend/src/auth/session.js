/**
 * Server-side sessions. The browser holds a random token in an httpOnly
 * cookie; the database stores only its SHA-256 hash, so a leaked database
 * cannot be used to hijack sessions.
 */
import crypto from 'node:crypto';
import { env } from '../config/env.js';

export const SESSION_COOKIE = 'ff_session';

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(db, userId, { ip, userAgent } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600 * 1000);
  await db.session.create({
    data: { userId, tokenHash: hashToken(token), ip, userAgent: userAgent?.slice(0, 255), expiresAt },
  });
  return { token, expiresAt };
}

// SECTION: loads a live session with everything needed for authorization in one query
export async function findSession(db, token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          role: { include: { permissions: { include: { permission: { select: { key: true } } } } } },
          station: { select: { id: true, name: true, code: true } },
          customer: { select: { id: true } },
        },
      },
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (session.user.status !== 'ACTIVE') return null;
  return session;
}

export async function revokeSession(db, token) {
  if (!token) return;
  await db.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(db, userId, { exceptToken } = {}) {
  await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptToken ? { NOT: { tokenHash: hashToken(exceptToken) } } : {}) },
    data: { revokedAt: new Date() },
  });
}

export function setSessionCookie(res, token, expiresAt) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: env.COOKIE_SECURE, path: '/' });
}

// SECTION: the shape the frontend receives as "the current user"
export function toPublicUser(user) {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    role: user.role.key,
    roleName: user.role.name,
    permissions: user.role.permissions.map((rp) => rp.permission.key).sort(),
    stationId: user.stationId,
    stationName: user.station?.name ?? null,
    customerId: user.customer?.id ?? null,
  };
}

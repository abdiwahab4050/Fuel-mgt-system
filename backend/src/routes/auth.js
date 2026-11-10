/**
 * /api/auth — login, logout, current user, password change, profile picture.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env, isProd } from '../config/env.js';
import { hashPassword, passwordSchema, verifyPassword } from '../auth/password.js';
import {
  clearSessionCookie, createSession, findSession, hashToken, revokeAllSessions, revokeSession, setSessionCookie, toPublicUser,
} from '../auth/session.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { AppError, badRequest, unauthorized } from '../lib/errors.js';

import { LOCK_MINUTES, MAX_FAILED_LOGINS } from '../auth/lockout.js';

export { MAX_FAILED_LOGINS, LOCK_MINUTES };

const router = express.Router();

// SECTION: brute-force protection per IP (account lockout below covers per-user)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Please wait a few minutes.' } },
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required').max(128),
});

router.get('/config', (req, res) => {
  res.json({ demo: env.SEED_DEMO_DATA && !isProd });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    throw new AppError(423, `Account temporarily locked after repeated failed logins. Try again in ${mins} minute(s).`, 'LOCKED');
  }

  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok || user.status !== 'ACTIVE') {
    if (user && !ok) {
      const failed = user.failedLogins + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
        },
      });
      await audit(prisma, req, { action: 'auth.login_failed', entityType: 'User', entityId: user.id, details: `Failed login (${failed})` });
    }
    throw unauthorized('Invalid email or password');
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const { token, expiresAt } = await createSession(prisma, user.id, { ip: req.ip, userAgent: req.get('user-agent') });
  setSessionCookie(res, token, expiresAt);
  await audit(prisma, { ip: req.ip, user: { id: user.id } }, { action: 'auth.login', entityType: 'User', entityId: user.id, details: `${user.name} signed in` });

  const session = await findSession(prisma, token);
  res.json({ user: toPublicUser(session.user) });
});

router.post('/logout', async (req, res) => {
  if (req.user) await audit(prisma, req, { action: 'auth.logout', entityType: 'User', entityId: req.user.id, details: `${req.user.name} signed out` });
  await revokeSession(prisma, req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user.record) });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const body = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }).parse(req.body);
  if (!(await verifyPassword(body.currentPassword, req.user.record.passwordHash))) {
    throw badRequest('Current password is incorrect');
  }
  await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: await hashPassword(body.newPassword) } });
  await revokeAllSessions(prisma, req.user.id, { exceptToken: req.sessionToken });
  await audit(prisma, req, { action: 'auth.password_changed', entityType: 'User', entityId: req.user.id, details: 'Changed own password; other sessions signed out' });
  res.json({ ok: true });
});

// SECTION: active sessions — see where you are signed in and sign out other devices
router.get('/sessions', requireAuth, async (req, res) => {
  const sessions = await prisma.session.findMany({
    where: { userId: req.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true, tokenHash: true },
    orderBy: { createdAt: 'desc' },
  });
  const current = req.sessionToken ? hashToken(req.sessionToken) : null;
  res.json({ sessions: sessions.map(({ tokenHash, ...s }) => ({ ...s, current: tokenHash === current })) });
});

router.post('/sessions/revoke-others', requireAuth, async (req, res) => {
  await revokeAllSessions(prisma, req.user.id, { exceptToken: req.sessionToken });
  await audit(prisma, req, { action: 'auth.sessions_revoked', entityType: 'User', entityId: req.user.id, details: 'Signed out all other devices' });
  res.json({ ok: true });
});

// SECTION: profile picture stored as a validated data URL (≤ 512 KB image)
const MAX_AVATAR_BYTES = 512 * 1024;
const avatarSchema = z.object({
  dataUrl: z
    .string()
    .regex(/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/, 'Must be a PNG, JPG, GIF or WebP image')
    .refine((v) => Math.floor((v.length - v.indexOf(',') - 1) * 0.75) <= MAX_AVATAR_BYTES, 'Image must be smaller than 512KB'),
});

router.put('/me/avatar', requireAuth, async (req, res) => {
  const { dataUrl } = avatarSchema.parse(req.body);
  await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl: dataUrl } });
  await audit(prisma, req, { action: 'profile.avatar_updated', entityType: 'User', entityId: req.user.id, details: 'Changed profile picture' });
  res.json({ avatarUrl: dataUrl });
});

router.delete('/me/avatar', requireAuth, async (req, res) => {
  await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl: null } });
  await audit(prisma, req, { action: 'profile.avatar_removed', entityType: 'User', entityId: req.user.id, details: 'Removed profile picture' });
  res.json({ avatarUrl: null });
});

export default router;

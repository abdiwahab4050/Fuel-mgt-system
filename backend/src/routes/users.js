/**
 * /api/users, /api/roles, /api/stations (list) — staff accounts and access.
 *
 * Rules:
 *  - Users are never hard-deleted (sales, payments and audit rows reference them); "delete" disables.
 *  - Nobody can change their own role or status (prevents accidental self-lockout).
 *  - The last active super administrator cannot be demoted or disabled.
 *  - Disabling a user or resetting their password signs out all their sessions.
 */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { hashPassword, passwordSchema } from '../auth/password.js';
import { revokeAllSessions } from '../auth/session.js';
import { requirePermission, stationScope } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';

const router = express.Router();

const userSelect = {
  id: true, name: true, email: true, phone: true, status: true, avatarUrl: true,
  lastLoginAt: true, createdAt: true, stationId: true, lockedUntil: true,
  role: { select: { key: true, name: true } },
  station: { select: { id: true, name: true, code: true } },
};

// What audit rows record about a user (never the password hash)
const snapshot = (u) => ({ name: u.name, email: u.email, phone: u.phone, status: u.status, role: u.role?.key, stationId: u.stationId });

async function assertNotLastSuperAdmin(userId) {
  const others = await prisma.user.count({ where: { id: { not: userId }, status: 'ACTIVE', role: { key: 'super_admin' } } });
  if (others === 0) throw conflict('This is the last active Super Administrator and cannot be demoted or disabled');
}

// Only super admins may grant or touch super admin accounts
function assertCanManageRole(req, roleKey) {
  if (roleKey === 'super_admin' && req.user.role !== 'super_admin') {
    throw forbidden('Only a Super Administrator can manage Super Administrator accounts');
  }
}

// SECTION: list — station-bound viewers only see their own station's staff
router.get('/users', requirePermission('users.view', 'users.manage'), async (req, res) => {
  const { search, role, status } = req.query;
  const stationId = stationScope(req);
  const users = await prisma.user.findMany({
    where: {
      ...(stationId ? { stationId } : {}),
      ...(role ? { role: { key: String(role) } } : {}),
      ...(status ? { status: String(status) } : {}),
      ...(search ? { OR: [{ name: { contains: String(search), mode: 'insensitive' } }, { email: { contains: String(search), mode: 'insensitive' } }] } : {}),
    },
    select: userSelect,
    orderBy: { createdAt: 'asc' },
  });
  res.json({ users });
});

router.get('/roles', requirePermission('users.view', 'users.manage'), async (req, res) => {
  const roles = await prisma.role.findMany({
    include: { permissions: { include: { permission: { select: { key: true } } } }, _count: { select: { users: true } } },
    orderBy: { name: 'asc' },
  });
  res.json({
    roles: roles.map((r) => ({
      key: r.key, name: r.name, description: r.description, userCount: r._count.users,
      permissions: r.permissions.map((rp) => rp.permission.key).sort(),
    })),
  });
});

const baseUser = {
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(30).optional().nullable(),
  roleKey: z.string(),
  stationId: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']).default('ACTIVE'),
};

async function resolveRole(roleKey) {
  const role = await prisma.role.findUnique({ where: { key: roleKey } });
  if (!role) throw badRequest(`Unknown role "${roleKey}"`);
  return role;
}

router.post('/users', requirePermission('users.manage'), async (req, res) => {
  const body = z.object({ ...baseUser, password: passwordSchema }).parse(req.body);
  assertCanManageRole(req, body.roleKey);
  const role = await resolveRole(body.roleKey);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: body.name, email: body.email, phone: body.phone || null, status: body.status,
        roleId: role.id, stationId: body.stationId || null, passwordHash: await hashPassword(body.password),
      },
      select: userSelect,
    });
    await audit(tx, req, { action: 'user.create', entityType: 'User', entityId: created.id, details: `Created ${created.email} as ${role.name}`, after: snapshot(created) });
    return created;
  });
  res.status(201).json({ user });
});

router.patch('/users/:id', requirePermission('users.manage'), async (req, res) => {
  const body = z.object(baseUser).partial().parse(req.body);
  const existing = await prisma.user.findUnique({ where: { id: req.params.id }, select: userSelect });
  if (!existing) throw notFound('User not found');
  assertCanManageRole(req, existing.role.key);
  if (body.roleKey) assertCanManageRole(req, body.roleKey);

  const isSelf = existing.id === req.user.id;
  const roleChanging = body.roleKey && body.roleKey !== existing.role.key;
  const statusChanging = body.status && body.status !== existing.status;
  if (isSelf && (roleChanging || statusChanging)) throw badRequest('You cannot change your own role or status');
  if (existing.role.key === 'super_admin' && existing.status === 'ACTIVE' && (roleChanging || (statusChanging && body.status !== 'ACTIVE'))) {
    await assertNotLastSuperAdmin(existing.id);
  }

  const role = body.roleKey ? await resolveRole(body.roleKey) : null;
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: existing.id },
      data: {
        name: body.name, email: body.email, phone: body.phone, status: body.status,
        ...(role ? { roleId: role.id } : {}),
        ...(body.stationId !== undefined ? { stationId: body.stationId || null } : {}),
      },
      select: userSelect,
    });
    if (statusChanging && body.status !== 'ACTIVE') await revokeAllSessions(tx, existing.id);
    await audit(tx, req, { action: 'user.update', entityType: 'User', entityId: existing.id, details: `Updated ${updated.email}`, before: snapshot(existing), after: snapshot(updated) });
    return updated;
  });
  res.json({ user });
});

router.post('/users/:id/reset-password', requirePermission('users.manage'), async (req, res) => {
  const { password } = z.object({ password: passwordSchema }).parse(req.body);
  const existing = await prisma.user.findUnique({ where: { id: req.params.id }, select: userSelect });
  if (!existing) throw notFound('User not found');
  assertCanManageRole(req, existing.role.key);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: existing.id }, data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null } });
    await revokeAllSessions(tx, existing.id);
    await audit(tx, req, { action: 'user.password_reset', entityType: 'User', entityId: existing.id, details: `Password reset for ${existing.email}` });
  });
  res.json({ ok: true });
});

// SECTION: "delete" = disable; history that references the user stays intact
router.delete('/users/:id', requirePermission('users.manage'), async (req, res) => {
  const existing = await prisma.user.findUnique({ where: { id: req.params.id }, select: userSelect });
  if (!existing) throw notFound('User not found');
  if (existing.id === req.user.id) throw badRequest('You cannot disable your own account');
  assertCanManageRole(req, existing.role.key);
  if (existing.role.key === 'super_admin' && existing.status === 'ACTIVE') await assertNotLastSuperAdmin(existing.id);

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: existing.id }, data: { status: 'DISABLED' }, select: userSelect });
    await revokeAllSessions(tx, existing.id);
    await audit(tx, req, { action: 'user.disable', entityType: 'User', entityId: existing.id, details: `Disabled ${existing.email}`, before: snapshot(existing), after: snapshot(updated) });
    return updated;
  });
  res.json({ user });
});

export default router;

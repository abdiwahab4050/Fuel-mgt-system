/**
 * /api/notifications — the header bell.
 *
 * Visibility: notifications addressed to the user, to the user's station, or
 * to everyone. Users not bound to a station see every station's alerts.
 *
 * Read state: personal notifications carry their own readAt. Shared
 * (station/global) ones count as read when older than the user's
 * notificationsSeenAt, which "mark all read" moves forward.
 */
import express from 'express';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/auth.js';

const router = express.Router();

function visibleTo(user) {
  const or = [{ userId: user.id }, { userId: null, stationId: null }];
  or.push(user.stationId ? { userId: null, stationId: user.stationId } : { userId: null });
  return { OR: or };
}

router.get('/notifications', requirePermission('notifications.view'), async (req, res) => {
  const rows = await prisma.notification.findMany({ where: visibleTo(req.user), orderBy: { createdAt: 'desc' }, take: 30 });
  const seenAt = req.user.record.notificationsSeenAt ?? new Date(0);
  const notifications = rows.map((n) => ({
    id: n.id, type: n.type, title: n.title, message: n.message, link: n.link, createdAt: n.createdAt,
    read: n.userId ? !!n.readAt : n.createdAt <= seenAt,
  }));
  res.json({ notifications, unread: notifications.filter((n) => !n.read).length });
});

router.post('/notifications/read-all', requirePermission('notifications.view'), async (req, res) => {
  const now = new Date();
  await prisma.$transaction([
    prisma.notification.updateMany({ where: { userId: req.user.id, readAt: null }, data: { readAt: now } }),
    prisma.user.update({ where: { id: req.user.id }, data: { notificationsSeenAt: now } }),
  ]);
  res.json({ ok: true });
});

export default router;

/**
 * Audit trail helper. Pass the transaction client when logging a change made
 * inside a transaction so the log entry commits (or rolls back) with it.
 */
export function audit(db, req, { action, entityType, entityId, details, before, after }) {
  return db.auditLog.create({
    data: {
      userId: req?.user?.id ?? null,
      action,
      entityType,
      entityId,
      details,
      before: before ?? undefined,
      after: after ?? undefined,
      ip: req?.ip ?? null,
    },
  });
}

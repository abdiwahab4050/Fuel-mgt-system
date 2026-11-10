/**
 * In-app notifications. userId targets one person; stationId targets that
 * station's staff; neither targets everyone with notifications.view.
 */
export function notify(db, { type = 'INFO', title, message, link = null, userId = null, stationId = null }) {
  return db.notification.create({ data: { type, title, message, link, userId, stationId } });
}

export function notify(db, userIds, { shopId = null, bookingId = null, message }) {
  const unique = [...new Set(userIds.filter(Boolean))];
  const stmt = db.prepare(
    'INSERT INTO notifications (user_id, shop_id, booking_id, message) VALUES (?, ?, ?, ?)',
  );
  for (const userId of unique) stmt.run(userId, shopId, bookingId, message);
}

export function staffWithRole(db, shopId, role) {
  return db
    .prepare('SELECT user_id FROM memberships WHERE shop_id = ? AND role = ? AND active = 1')
    .all(shopId, role)
    .map((r) => r.user_id);
}

// SAs get booking events; the owner is copied so a one-person shop still sees them.
export function shopDesk(db, shopId) {
  return [...staffWithRole(db, shopId, 'SA'), ...staffWithRole(db, shopId, 'OWNER')];
}

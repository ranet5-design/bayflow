import bcrypt from 'bcryptjs';

export const hashPassword = (plain) => bcrypt.hash(plain, 10);
export const checkPassword = (plain, hash) => bcrypt.compare(plain, hash);

export function findByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

export function getMemberships(db, userId) {
  return db
    .prepare(
      `SELECT m.id, m.shop_id AS shopId, m.role, s.name AS shopName, s.city
       FROM memberships m JOIN shops s ON s.id = m.shop_id
       WHERE m.user_id = ? AND m.active = 1
       ORDER BY s.name`,
    )
    .all(userId);
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    isOwner: Boolean(user.is_owner),
  };
}

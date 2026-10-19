import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { forbidden, notFound, unauthorized } from '../utils/errors.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function readUser(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  let payload;
  try {
    payload = jwt.verify(header.slice(7), config.jwtSecret);
  } catch {
    throw unauthorized('Session expired, please log in again');
  }
  const user = req.db
    .prepare('SELECT id, name, email, phone, is_owner FROM users WHERE id = ?')
    .get(payload.sub);
  if (!user) throw unauthorized();
  return user;
}

export function requireAuth(req, res, next) {
  const user = readUser(req);
  if (!user) throw unauthorized();
  req.user = user;
  next();
}

export function optionalAuth(req, res, next) {
  req.user = readUser(req);
  next();
}

/**
 * Loads the caller's membership for :shopId. Users without an active
 * membership get 404 so they can't even tell the shop's records exist.
 * OWNER passes every role check inside their own shop.
 */
export function shopAccess(...roles) {
  return (req, res, next) => {
    const shopId = Number(req.params.shopId);
    const membership = req.db
      .prepare(
        `SELECT m.role FROM memberships m
         WHERE m.shop_id = ? AND m.user_id = ? AND m.active = 1`,
      )
      .get(shopId, req.user.id);

    if (!membership) throw notFound('Shop not found');
    if (roles.length && membership.role !== 'OWNER' && !roles.includes(membership.role)) {
      throw forbidden(`This needs one of these roles: ${roles.join(', ')}`);
    }
    req.shopId = shopId;
    req.role = membership.role;
    next();
  };
}

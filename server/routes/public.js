import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, signToken } from '../middleware/auth.js';
import { createBooking } from '../services/bookingService.js';
import { getSlots, workingDays } from '../services/slotService.js';
import {
  checkPassword,
  findByEmail,
  getMemberships,
  hashPassword,
  publicUser,
} from '../services/userService.js';
import { notFound, unauthorized } from '../utils/errors.js';
import { date, email, id, parse, password, time } from '../utils/validate.js';

const router = Router();

function shopCard(db, shop) {
  const services = db
    .prepare('SELECT id, name FROM services WHERE shop_id = ? AND active = 1 ORDER BY name')
    .all(shop.id);
  return {
    id: shop.id,
    name: shop.name,
    city: shop.city,
    address: shop.address,
    phone: shop.phone,
    description: shop.description,
    logoUrl: shop.logo_url,
    rating: shop.rating,
    openTime: shop.open_time,
    closeTime: shop.close_time,
    workingDays: workingDays(shop),
    services,
  };
}

router.get('/shops', (req, res) => {
  const { city, q } = parse(
    z.object({ city: z.string().trim().optional(), q: z.string().trim().max(60).optional() }),
    req.query,
  );
  const where = [];
  const params = [];
  if (city) {
    where.push('s.city = ? COLLATE NOCASE');
    params.push(city);
  }
  if (q) {
    where.push(
      `(s.name LIKE ? OR s.city LIKE ? OR EXISTS (
         SELECT 1 FROM services sv WHERE sv.shop_id = s.id AND sv.active = 1 AND sv.name LIKE ?))`,
    );
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const shops = req.db
    .prepare(`SELECT s.* FROM shops s ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.name`)
    .all(...params);
  const cities = req.db
    .prepare('SELECT DISTINCT city FROM shops ORDER BY city')
    .all()
    .map((r) => r.city);

  res.json({ shops: shops.map((s) => shopCard(req.db, s)), cities });
});

router.get('/shops/:shopId', (req, res) => {
  const shop = req.db.prepare('SELECT * FROM shops WHERE id = ?').get(parse(id, req.params.shopId));
  if (!shop) throw notFound('Shop not found');
  const services = req.db
    .prepare(
      `SELECT id, name, description, duration_min AS durationMin, base_price AS basePrice
       FROM services WHERE shop_id = ? AND active = 1 ORDER BY name`,
    )
    .all(shop.id);
  res.json({ shop: { ...shopCard(req.db, shop), services, slotMinutes: shop.slot_minutes } });
});

router.get('/shops/:shopId/slots', (req, res) => {
  const shop = req.db.prepare('SELECT * FROM shops WHERE id = ?').get(parse(id, req.params.shopId));
  if (!shop) throw notFound('Shop not found');
  const day = parse(z.object({ date }), req.query).date;
  res.json({ date: day, slots: getSlots(req.db, shop, day) });
});

const bookingSchema = z.object({
  serviceIds: z.array(id).min(1, 'Pick at least one service').max(20),
  notes: z.string().trim().max(1000).optional(),
  slotDate: date,
  slotTime: time,
  customer: z
    .object({
      name: z.string().trim().min(2).max(80),
      email,
      phone: z.string().trim().max(30).optional(),
      password,
    })
    .optional(),
  vehicle: z.object({
    regNo: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .transform((v) => v.toUpperCase()),
    make: z.string().trim().min(1).max(40),
    model: z.string().trim().min(1).max(40),
    year: z.coerce
      .number()
      .int()
      .min(1950)
      .max(new Date().getFullYear() + 1),
    color: z.string().trim().max(30).optional(),
    mileage: z.coerce.number().int().min(0).max(2_000_000).optional(),
  }),
});

/**
 * Books a slot. A logged-in user books as themselves. Otherwise we look up the
 * email: existing account -> password must match, new email -> account created.
 */
router.post('/shops/:shopId/bookings', optionalAuth, async (req, res) => {
  const shopId = parse(id, req.params.shopId);
  const body = parse(bookingSchema, req.body);

  let user = req.user ? req.db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) : null;

  if (!user) {
    if (!body.customer) throw unauthorized('Please enter your details or log in');
    const existing = findByEmail(req.db, body.customer.email);
    if (existing) {
      if (!(await checkPassword(body.customer.password, existing.password_hash))) {
        throw unauthorized('This email already has an account and the password did not match');
      }
      user = existing;
    } else {
      const hash = await hashPassword(body.customer.password);
      const result = req.db
        .prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)')
        .run(body.customer.name, body.customer.email, body.customer.phone ?? null, hash);
      user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    }
  }

  const bookingId = createBooking(req.db, {
    shopId,
    customerId: user.id,
    serviceIds: body.serviceIds,
    notes: body.notes,
    slotDate: body.slotDate,
    slotTime: body.slotTime,
    vehicle: body.vehicle,
  });

  res.status(201).json({
    bookingId,
    token: signToken(user),
    user: publicUser(user),
    memberships: getMemberships(req.db, user.id),
  });
});

export default router;

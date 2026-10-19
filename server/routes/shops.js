import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, shopAccess } from '../middleware/auth.js';
import { transaction } from '../db/connection.js';
import { findByEmail, hashPassword } from '../services/userService.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { email, id, money, parse, password, time } from '../utils/validate.js';
import { toMinutes } from '../utils/time.js';

const router = Router();
router.use(requireAuth);

const shopFields = {
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().min(3).max(200),
  city: z.string().trim().min(2).max(50),
  phone: z.string().trim().min(5).max(30),
  description: z.string().trim().max(500).optional(),
  logoUrl: z.string().trim().url().max(300).optional().or(z.literal('')),
  openTime: time,
  closeTime: time,
  workingDays: z.array(z.number().int().min(0).max(6)).min(1),
  slotMinutes: z.coerce.number().int().min(15).max(240),
  slotCapacity: z.coerce.number().int().min(1).max(20),
};

const shopSchema = z
  .object(shopFields)
  .refine((s) => toMinutes(s.closeTime) - toMinutes(s.openTime) >= s.slotMinutes, {
    message: 'Closing time must leave room for at least one slot',
    path: ['closeTime'],
  });

function shopDto(shop) {
  return {
    id: shop.id,
    name: shop.name,
    address: shop.address,
    city: shop.city,
    phone: shop.phone,
    description: shop.description,
    logoUrl: shop.logo_url,
    openTime: shop.open_time,
    closeTime: shop.close_time,
    workingDays: shop.working_days.split(',').map(Number),
    slotMinutes: shop.slot_minutes,
    slotCapacity: shop.slot_capacity,
  };
}

// ---------- shops ----------

router.post('/', (req, res) => {
  if (!req.user.is_owner) throw forbidden('Only owner accounts can create shops');
  const s = parse(shopSchema, req.body);
  const shopId = transaction(req.db, () => {
    const result = req.db
      .prepare(
        `INSERT INTO shops (owner_id, name, address, city, phone, description, logo_url,
           open_time, close_time, working_days, slot_minutes, slot_capacity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        req.user.id,
        s.name,
        s.address,
        s.city,
        s.phone,
        s.description ?? null,
        s.logoUrl || null,
        s.openTime,
        s.closeTime,
        [...new Set(s.workingDays)].sort().join(','),
        s.slotMinutes,
        s.slotCapacity,
      );
    const newId = Number(result.lastInsertRowid);
    req.db.prepare("INSERT INTO memberships (shop_id, user_id, role) VALUES (?, ?, 'OWNER')").run(newId, req.user.id);
    return newId;
  });
  const shop = req.db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
  res.status(201).json({ shop: shopDto(shop) });
});

router.get('/:shopId', shopAccess(), (req, res) => {
  const shop = req.db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shopId);
  res.json({ shop: shopDto(shop), role: req.role });
});

router.patch('/:shopId', shopAccess('OWNER'), (req, res) => {
  const s = parse(shopSchema, req.body);
  req.db
    .prepare(
      `UPDATE shops SET name = ?, address = ?, city = ?, phone = ?, description = ?, logo_url = ?,
         open_time = ?, close_time = ?, working_days = ?, slot_minutes = ?, slot_capacity = ?
       WHERE id = ?`,
    )
    .run(
      s.name,
      s.address,
      s.city,
      s.phone,
      s.description ?? null,
      s.logoUrl || null,
      s.openTime,
      s.closeTime,
      [...new Set(s.workingDays)].sort().join(','),
      s.slotMinutes,
      s.slotCapacity,
      req.shopId,
    );
  res.json({ shop: shopDto(req.db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shopId)) });
});

router.get('/:shopId/overview', shopAccess('OWNER'), (req, res) => {
  const byStatus = req.db
    .prepare('SELECT status, COUNT(*) AS count FROM bookings WHERE shop_id = ? GROUP BY status')
    .all(req.shopId);
  const team = req.db
    .prepare(
      `SELECT m.role, COUNT(*) AS count FROM memberships m
       WHERE m.shop_id = ? AND m.active = 1 GROUP BY m.role`,
    )
    .all(req.shopId);
  const inventory = req.db
    .prepare(
      `SELECT COUNT(*) AS parts, COALESCE(SUM(qty_on_hand * unit_cost), 0) AS stockValue,
              SUM(CASE WHEN qty_on_hand <= reorder_level THEN 1 ELSE 0 END) AS lowStock
       FROM parts WHERE shop_id = ?`,
    )
    .get(req.shopId);
  const lowStockParts = req.db
    .prepare(
      `SELECT id, sku, name, qty_on_hand AS qtyOnHand, reorder_level AS reorderLevel
       FROM parts WHERE shop_id = ? AND qty_on_hand <= reorder_level ORDER BY name`,
    )
    .all(req.shopId);
  const openQcIssues = req.db
    .prepare(
      `SELECT COUNT(*) AS n FROM qc_issues i JOIN bookings b ON b.id = i.booking_id
       WHERE b.shop_id = ? AND i.resolved_at IS NULL`,
    )
    .get(req.shopId).n;

  res.json({ byStatus, team, inventory, lowStockParts, openQcIssues });
});

// ---------- team ----------

const STAFF_ROLES = ['SA', 'TECHNICIAN', 'QC', 'PARTS'];

router.get('/:shopId/team', shopAccess('SA'), (req, res) => {
  const team = req.db
    .prepare(
      `SELECT m.id, m.role, m.active, u.id AS userId, u.name, u.email, u.phone
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.shop_id = ? ORDER BY m.role, u.name`,
    )
    .all(req.shopId)
    .map((m) => ({ ...m, active: Boolean(m.active) }));
  res.json({ team });
});

const newMemberSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email,
  phone: z.string().trim().max(30).optional(),
  password: password.optional(),
  role: z.enum(STAFF_ROLES),
});

/**
 * Owner adds a staff member. If the email already has an account (e.g. they
 * work at another shop too) we just add a membership and keep their password.
 */
router.post('/:shopId/team', shopAccess('OWNER'), async (req, res) => {
  const body = parse(newMemberSchema, req.body);
  let user = findByEmail(req.db, body.email);

  if (!user) {
    if (!body.password) throw badRequest('Set a password for the new staff account');
    const hash = await hashPassword(body.password);
    const result = req.db
      .prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)')
      .run(body.name, body.email, body.phone ?? null, hash);
    user = { id: Number(result.lastInsertRowid) };
  }

  const already = req.db.prepare('SELECT 1 FROM memberships WHERE shop_id = ? AND user_id = ?').get(req.shopId, user.id);
  if (already) throw conflict('This person is already on the team');

  req.db.prepare('INSERT INTO memberships (shop_id, user_id, role) VALUES (?, ?, ?)').run(req.shopId, user.id, body.role);
  res.status(201).json({ ok: true });
});

router.patch('/:shopId/team/:membershipId', shopAccess('OWNER'), (req, res) => {
  const membershipId = parse(id, req.params.membershipId);
  const body = parse(
    z.object({ role: z.enum(STAFF_ROLES).optional(), active: z.boolean().optional() }),
    req.body,
  );
  const m = req.db.prepare('SELECT * FROM memberships WHERE id = ? AND shop_id = ?').get(membershipId, req.shopId);
  if (!m) throw notFound('Team member not found');
  if (m.role === 'OWNER') throw badRequest("The owner's membership can't be changed");

  req.db
    .prepare('UPDATE memberships SET role = COALESCE(?, role), active = COALESCE(?, active) WHERE id = ?')
    .run(body.role ?? null, body.active === undefined ? null : Number(body.active), membershipId);
  res.json({ ok: true });
});

// ---------- services ----------

const serviceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  durationMin: z.coerce.number().int().min(10).max(600),
  basePrice: money.optional().nullable(),
  active: z.boolean().optional(),
});

router.get('/:shopId/services', shopAccess(), (req, res) => {
  const services = req.db
    .prepare(
      `SELECT id, name, description, duration_min AS durationMin, base_price AS basePrice, active
       FROM services WHERE shop_id = ? ORDER BY name`,
    )
    .all(req.shopId)
    .map((s) => ({ ...s, active: Boolean(s.active) }));
  res.json({ services });
});

router.post('/:shopId/services', shopAccess('OWNER'), (req, res) => {
  const s = parse(serviceSchema, req.body);
  const result = req.db
    .prepare('INSERT INTO services (shop_id, name, description, duration_min, base_price) VALUES (?, ?, ?, ?, ?)')
    .run(req.shopId, s.name, s.description ?? null, s.durationMin, s.basePrice ?? null);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.patch('/:shopId/services/:serviceId', shopAccess('OWNER'), (req, res) => {
  const serviceId = parse(id, req.params.serviceId);
  const s = parse(serviceSchema, req.body);
  const result = req.db
    .prepare(
      `UPDATE services SET name = ?, description = ?, duration_min = ?, base_price = ?, active = COALESCE(?, active)
       WHERE id = ? AND shop_id = ?`,
    )
    .run(
      s.name,
      s.description ?? null,
      s.durationMin,
      s.basePrice ?? null,
      s.active === undefined ? null : Number(s.active),
      serviceId,
      req.shopId,
    );
  if (result.changes === 0) throw notFound('Service not found');
  res.json({ ok: true });
});

export default router;

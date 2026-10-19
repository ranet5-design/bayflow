import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, shopAccess } from '../middleware/auth.js';
import {
  createPurchaseOrder,
  listPurchaseOrders,
  receivePurchaseOrder,
  shortages,
} from '../services/inventoryService.js';
import { STATUS } from '../services/bookingMachine.js';
import { notify } from '../services/notificationService.js';
import { conflict, notFound } from '../utils/errors.js';
import { id, money, parse } from '../utils/validate.js';

// Mounted at /api/shops/:shopId
const router = Router({ mergeParams: true });
router.use(requireAuth);

const partSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2).max(80),
  qtyOnHand: z.coerce.number().int().min(0).max(100000),
  reorderLevel: z.coerce.number().int().min(0).max(100000),
  unitCost: money,
});

// Technicians read the catalog to build estimates, so any member can list parts.
router.get('/parts', shopAccess(), (req, res) => {
  const parts = req.db
    .prepare(
      `SELECT id, sku, name, qty_on_hand AS qtyOnHand, reorder_level AS reorderLevel, unit_cost AS unitCost,
              qty_on_hand <= reorder_level AS lowStock
       FROM parts WHERE shop_id = ? ORDER BY name`,
    )
    .all(req.shopId)
    .map((p) => ({ ...p, lowStock: Boolean(p.lowStock) }));
  res.json({ parts });
});

router.post('/parts', shopAccess('PARTS'), (req, res) => {
  const p = parse(partSchema, req.body);
  const dup = req.db.prepare('SELECT 1 FROM parts WHERE shop_id = ? AND sku = ?').get(req.shopId, p.sku);
  if (dup) throw conflict(`SKU ${p.sku} already exists in this shop`);
  const result = req.db
    .prepare(
      'INSERT INTO parts (shop_id, sku, name, qty_on_hand, reorder_level, unit_cost) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(req.shopId, p.sku, p.name, p.qtyOnHand, p.reorderLevel, p.unitCost);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.patch('/parts/:partId', shopAccess('PARTS'), (req, res) => {
  const p = parse(partSchema.omit({ sku: true, qtyOnHand: true }), req.body);
  const result = req.db
    .prepare('UPDATE parts SET name = ?, reorder_level = ?, unit_cost = ? WHERE id = ? AND shop_id = ?')
    .run(p.name, p.reorderLevel, p.unitCost, parse(id, req.params.partId), req.shopId);
  if (result.changes === 0) throw notFound('Part not found');
  res.json({ ok: true });
});

router.get('/purchase-orders', shopAccess('PARTS'), (req, res) => {
  res.json({ purchaseOrders: listPurchaseOrders(req.db, req.shopId) });
});

// Manual restock order, not linked to a booking.
router.post('/purchase-orders', shopAccess('PARTS'), (req, res) => {
  const body = parse(
    z.object({
      supplier: z.string().trim().max(100).optional(),
      items: z.array(z.object({ partId: id, qty: z.coerce.number().int().min(1).max(10000) })).min(1),
    }),
    req.body,
  );
  const poId = createPurchaseOrder(req.db, { shopId: req.shopId, userId: req.user.id, ...body });
  res.status(201).json({ id: poId });
});

router.post('/purchase-orders/:poId/receive', shopAccess('PARTS'), (req, res) => {
  const body = parse(
    z.object({
      items: z.array(z.object({ poItemId: id, qty: z.coerce.number().int().min(0).max(10000) })).min(1),
    }),
    req.body,
  );
  const result = receivePurchaseOrder(req.db, {
    shopId: req.shopId,
    poId: parse(id, req.params.poId),
    items: body.items,
  });

  // If the booking this PO was for now has everything, tell its parts person.
  if (result.bookingId) {
    const booking = req.db.prepare('SELECT * FROM bookings WHERE id = ?').get(result.bookingId);
    if (booking?.status === STATUS.PARTS_ORDERED && shortages(req.db, booking.id).length === 0) {
      notify(req.db, [booking.parts_person_id], {
        shopId: req.shopId,
        bookingId: booking.id,
        message: `All parts for booking #${booking.id} have arrived, ready to allocate`,
      });
    }
  }
  res.json(result);
});

export default router;

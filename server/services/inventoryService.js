import { badRequest, conflict, notFound } from '../utils/errors.js';
import { transaction } from '../db/connection.js';

/**
 * Parts needed by a booking's current estimate compared with stock.
 * Parts already allocated to the booking count as covered.
 */
export function partsRequirement(db, bookingId) {
  const rows = db
    .prepare(
      `SELECT p.id AS partId, p.sku, p.name, p.qty_on_hand AS onHand, SUM(ei.qty) AS required,
         COALESCE((SELECT SUM(a.qty) FROM allocations a
                   WHERE a.booking_id = e.booking_id AND a.part_id = p.id AND a.status = 'ALLOCATED'), 0) AS allocated
       FROM estimates e
       JOIN estimate_items ei ON ei.estimate_id = e.id
       JOIN parts p ON p.id = ei.part_id
       WHERE e.booking_id = ?
       GROUP BY p.id
       ORDER BY p.name`,
    )
    .all(bookingId);

  return rows.map((r) => {
    const stillNeeded = Math.max(0, r.required - r.allocated);
    return { ...r, shortage: Math.max(0, stillNeeded - r.onHand) };
  });
}

export function shortages(db, bookingId) {
  return partsRequirement(db, bookingId).filter((r) => r.shortage > 0);
}

export function allocateForBooking(db, bookingId) {
  const missing = shortages(db, bookingId);
  if (missing.length) {
    throw conflict(
      `Not enough stock: ${missing.map((m) => `${m.name} (short ${m.shortage})`).join(', ')}`,
      missing,
    );
  }
  const take = db.prepare('UPDATE parts SET qty_on_hand = qty_on_hand - ? WHERE id = ? AND qty_on_hand >= ?');
  const record = db.prepare('INSERT INTO allocations (booking_id, part_id, qty) VALUES (?, ?, ?)');

  for (const row of partsRequirement(db, bookingId)) {
    const qty = row.required - row.allocated;
    if (qty <= 0) continue;
    const res = take.run(qty, row.partId, qty);
    if (res.changes === 0) throw conflict(`Stock for ${row.name} changed, please retry`);
    record.run(bookingId, row.partId, qty);
  }
}

// Used on cancellation: puts reserved parts back on the shelf.
export function releaseAllocations(db, bookingId) {
  const rows = db
    .prepare("SELECT id, part_id, qty FROM allocations WHERE booking_id = ? AND status = 'ALLOCATED'")
    .all(bookingId);
  for (const a of rows) {
    db.prepare('UPDATE parts SET qty_on_hand = qty_on_hand + ? WHERE id = ?').run(a.qty, a.part_id);
    db.prepare("UPDATE allocations SET status = 'RELEASED' WHERE id = ?").run(a.id);
  }
  return rows.length;
}

export function createPurchaseOrder(db, { shopId, bookingId = null, userId, supplier, items }) {
  if (!items.length) throw badRequest('A purchase order needs at least one item');
  return transaction(db, () => {
    for (const item of items) {
      const part = db.prepare('SELECT id FROM parts WHERE id = ? AND shop_id = ?').get(item.partId, shopId);
      if (!part) throw badRequest(`Part ${item.partId} does not belong to this shop`);
    }
    const po = db
      .prepare(
        "INSERT INTO purchase_orders (shop_id, booking_id, status, supplier, created_by) VALUES (?, ?, 'ORDERED', ?, ?)",
      )
      .run(shopId, bookingId, supplier ?? null, userId);
    const poId = Number(po.lastInsertRowid);
    const addItem = db.prepare('INSERT INTO po_items (po_id, part_id, qty_ordered) VALUES (?, ?, ?)');
    for (const item of items) addItem.run(poId, item.partId, item.qty);
    return poId;
  });
}

/**
 * Receives some or all of a PO. Stock goes up by what actually arrived.
 * Returns the updated PO status.
 */
export function receivePurchaseOrder(db, { shopId, poId, items }) {
  return transaction(db, () => {
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND shop_id = ?').get(poId, shopId);
    if (!po) throw notFound('Purchase order not found');
    if (po.status === 'RECEIVED') throw conflict('This purchase order is already fully received');

    for (const { poItemId, qty } of items) {
      if (qty <= 0) continue;
      const line = db.prepare('SELECT * FROM po_items WHERE id = ? AND po_id = ?').get(poItemId, poId);
      if (!line) throw badRequest(`Item ${poItemId} is not on this purchase order`);
      const open = line.qty_ordered - line.qty_received;
      if (qty > open) throw badRequest(`Only ${open} still expected for item ${poItemId}`);

      db.prepare('UPDATE po_items SET qty_received = qty_received + ? WHERE id = ?').run(qty, poItemId);
      db.prepare('UPDATE parts SET qty_on_hand = qty_on_hand + ? WHERE id = ?').run(qty, line.part_id);
    }

    const { open } = db
      .prepare('SELECT SUM(qty_ordered - qty_received) AS open FROM po_items WHERE po_id = ?')
      .get(poId);
    const anyReceived = db.prepare('SELECT 1 FROM po_items WHERE po_id = ? AND qty_received > 0').get(poId);
    const status = open === 0 ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : 'ORDERED';
    db.prepare("UPDATE purchase_orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
      status,
      poId,
    );
    return { status, bookingId: po.booking_id };
  });
}

export function listPurchaseOrders(db, shopId, { bookingId } = {}) {
  const pos = bookingId
    ? db
        .prepare('SELECT * FROM purchase_orders WHERE shop_id = ? AND booking_id = ? ORDER BY id DESC')
        .all(shopId, bookingId)
    : db.prepare('SELECT * FROM purchase_orders WHERE shop_id = ? ORDER BY id DESC').all(shopId);

  const itemsStmt = db.prepare(
    `SELECT pi.id, pi.part_id AS partId, p.sku, p.name, pi.qty_ordered AS qtyOrdered, pi.qty_received AS qtyReceived
     FROM po_items pi JOIN parts p ON p.id = pi.part_id WHERE pi.po_id = ?`,
  );
  return pos.map((po) => ({
    id: po.id,
    bookingId: po.booking_id,
    status: po.status,
    supplier: po.supplier,
    createdAt: po.created_at,
    items: itemsStmt.all(po.id),
  }));
}

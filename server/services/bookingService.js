import { z } from 'zod';
import { transaction } from '../db/connection.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../utils/errors.js';
import { id, money, parse } from '../utils/validate.js';
import { ACTIONS, availableActions, checkAction, STATUS } from './bookingMachine.js';
import { notify, shopDesk, staffWithRole } from './notificationService.js';
import { getSlots } from './slotService.js';
import {
  allocateForBooking,
  createPurchaseOrder,
  listPurchaseOrders,
  partsRequirement,
  releaseAllocations,
  shortages,
} from './inventoryService.js';

// ---------- creating ----------

export function createBooking(db, { shopId, customerId, serviceIds, notes, slotDate, slotTime, vehicle }) {
  return transaction(db, () => {
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
    if (!shop) throw notFound('Shop not found');

    const uniqueServices = [...new Set(serviceIds)];
    const found = db
      .prepare(
        `SELECT id FROM services WHERE shop_id = ? AND active = 1
         AND id IN (${uniqueServices.map(() => '?').join(',')})`,
      )
      .all(shopId, ...uniqueServices);
    if (found.length !== uniqueServices.length) throw badRequest('One or more services are not offered by this shop');

    // Capacity check and insert happen inside the same write transaction,
    // so two customers can't both take the last place in a slot.
    const slot = getSlots(db, shop, slotDate).find((s) => s.time === slotTime);
    if (!slot) throw badRequest('That time slot does not exist for this shop');
    if (!slot.available) throw conflict('That slot was just taken, please pick another time');

    db.prepare(
      `INSERT INTO vehicles (customer_id, reg_no, make, model, year, color, mileage)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (customer_id, reg_no) DO UPDATE SET
         make = excluded.make, model = excluded.model, year = excluded.year,
         color = excluded.color, mileage = excluded.mileage`,
    ).run(
      customerId,
      vehicle.regNo,
      vehicle.make,
      vehicle.model,
      vehicle.year,
      vehicle.color ?? null,
      vehicle.mileage ?? null,
    );
    const vehicleId = db
      .prepare('SELECT id FROM vehicles WHERE customer_id = ? AND reg_no = ?')
      .get(customerId, vehicle.regNo).id;

    const result = db
      .prepare(
        `INSERT INTO bookings (shop_id, customer_id, vehicle_id, slot_date, slot_time, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(shopId, customerId, vehicleId, slotDate, slotTime, STATUS.PENDING, notes ?? null);
    const bookingId = Number(result.lastInsertRowid);

    const link = db.prepare('INSERT INTO booking_services (booking_id, service_id) VALUES (?, ?)');
    for (const sid of uniqueServices) link.run(bookingId, sid);

    db.prepare(
      `INSERT INTO booking_history (booking_id, action, from_status, to_status, actor_id, actor_role, note)
       VALUES (?, 'create', NULL, ?, ?, 'CUSTOMER', 'Booking created')`,
    ).run(bookingId, STATUS.PENDING, customerId);

    notify(db, shopDesk(db, shopId), {
      shopId,
      bookingId,
      message: `New booking #${bookingId}: ${vehicle.make} ${vehicle.model} on ${slotDate} at ${slotTime}`,
    });

    return bookingId;
  });
}

// ---------- reading ----------

const BOOKING_SELECT = `
  SELECT b.*, s.name AS shop_name, s.city AS shop_city, s.phone AS shop_phone,
         u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
         v.reg_no, v.make, v.model, v.year, v.color, v.mileage,
         t.name AS technician_name, pp.name AS parts_person_name, q.name AS qc_name
  FROM bookings b
  JOIN shops s ON s.id = b.shop_id
  JOIN users u ON u.id = b.customer_id
  JOIN vehicles v ON v.id = b.vehicle_id
  LEFT JOIN users t ON t.id = b.technician_id
  LEFT JOIN users pp ON pp.id = b.parts_person_id
  LEFT JOIN users q ON q.id = b.qc_inspector_id`;

function servicesFor(db, bookingId) {
  return db
    .prepare(
      `SELECT sv.id, sv.name FROM booking_services bs JOIN services sv ON sv.id = bs.service_id
       WHERE bs.booking_id = ? ORDER BY sv.name`,
    )
    .all(bookingId);
}

function summary(db, row) {
  return {
    id: row.id,
    shopId: row.shop_id,
    shopName: row.shop_name,
    status: row.status,
    slotDate: row.slot_date,
    slotTime: row.slot_time,
    customer: { name: row.customer_name, email: row.customer_email, phone: row.customer_phone },
    vehicle: {
      regNo: row.reg_no,
      make: row.make,
      model: row.model,
      year: row.year,
      color: row.color,
      mileage: row.mileage,
    },
    services: servicesFor(db, row.id),
    technician: row.technician_id ? { id: row.technician_id, name: row.technician_name } : null,
    partsPerson: row.parts_person_id ? { id: row.parts_person_id, name: row.parts_person_name } : null,
    qcInspector: row.qc_inspector_id ? { id: row.qc_inspector_id, name: row.qc_name } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getEstimate(db, bookingId) {
  const est = db.prepare('SELECT * FROM estimates WHERE booking_id = ?').get(bookingId);
  if (!est) return null;
  const items = db
    .prepare(
      `SELECT ei.id, ei.part_id AS partId, p.sku, p.name, ei.qty, ei.unit_cost AS unitCost,
              ei.qty * ei.unit_cost AS lineTotal
       FROM estimate_items ei JOIN parts p ON p.id = ei.part_id
       WHERE ei.estimate_id = ? ORDER BY ei.id`,
    )
    .all(est.id);
  const partsTotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
  return {
    id: est.id,
    revision: est.revision,
    status: est.status,
    labourCost: est.labour_cost,
    partsTotal,
    total: partsTotal + est.labour_cost,
    decisionNote: est.decision_note,
    submittedAt: est.submitted_at,
    sentAt: est.sent_at,
    decidedAt: est.decided_at,
    items,
  };
}

function loadRow(db, bookingId) {
  return db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(bookingId);
}

export function canView(booking, actor) {
  switch (actor.role) {
    case 'CUSTOMER':
      return booking.customer_id === actor.userId;
    case 'OWNER':
    case 'SA':
      return true;
    case 'TECHNICIAN':
      return booking.technician_id === actor.userId;
    case 'PARTS':
      return booking.parts_person_id === actor.userId;
    case 'QC':
      return booking.status === STATUS.QC_PENDING || booking.qc_inspector_id === actor.userId;
    default:
      return false;
  }
}

/**
 * Full booking for a detail screen. shopId is required for staff so a booking
 * from another shop is reported as "not found" instead of leaking.
 */
export function getBookingDetail(db, bookingId, actor, shopId = null) {
  const row = loadRow(db, bookingId);
  if (!row) throw notFound('Booking not found');
  if (shopId !== null && row.shop_id !== shopId) throw notFound('Booking not found');
  if (!canView(row, actor)) throw notFound('Booking not found');

  const isCustomer = actor.role === 'CUSTOMER';
  const estimate = getEstimate(db, bookingId);

  const detail = {
    ...summary(db, row),
    notes: row.notes,
    customerNotifiedAt: row.customer_notified_at,
    shop: { id: row.shop_id, name: row.shop_name, city: row.shop_city, phone: row.shop_phone },
    // Customers only see an estimate once the SA has sent it.
    estimate: isCustomer && estimate && estimate.status === 'SUBMITTED' ? null : estimate,
    history: db
      .prepare(
        `SELECT h.action, h.from_status AS fromStatus, h.to_status AS toStatus, h.note,
                h.actor_role AS actorRole, u.name AS actorName, h.created_at AS at
         FROM booking_history h LEFT JOIN users u ON u.id = h.actor_id
         WHERE h.booking_id = ? ORDER BY h.id`,
      )
      .all(bookingId),
    issues: db
      .prepare(
        `SELECT i.id, i.title, i.description, i.created_at AS createdAt, i.resolved_at AS resolvedAt,
                u.name AS raisedBy
         FROM qc_issues i LEFT JOIN users u ON u.id = i.raised_by
         WHERE i.booking_id = ? ORDER BY i.id DESC`,
      )
      .all(bookingId),
    availableActions: availableActions(row, actor),
  };

  if (!isCustomer) {
    detail.parts = partsRequirement(db, bookingId);
    detail.purchaseOrders = listPurchaseOrders(db, row.shop_id, { bookingId });
    detail.allocations = db
      .prepare(
        `SELECT a.id, p.name, a.qty, a.status FROM allocations a JOIN parts p ON p.id = a.part_id
         WHERE a.booking_id = ? ORDER BY a.id`,
      )
      .all(bookingId);
  }
  return detail;
}

const ROLE_VIEW_STATUSES = {
  TECHNICIAN: [STATUS.ASSIGNED, STATUS.INSPECTING, STATUS.IN_REPAIR],
  PARTS: [STATUS.PARTS_PENDING, STATUS.PARTS_ORDERED, STATUS.PARTS_READY],
  QC: [STATUS.QC_PENDING, STATUS.QC_IN_PROGRESS],
};

/**
 * Bookings list for the POS. Each role only gets its own work; the owner can
 * pass `view` to look at the shop through another role's eyes.
 */
export function listShopBookings(db, { shopId, role, userId, status, view }) {
  const where = ['b.shop_id = ?'];
  const params = [shopId];

  if (role === 'TECHNICIAN') {
    where.push('b.technician_id = ?');
    params.push(userId);
  } else if (role === 'PARTS') {
    where.push('b.parts_person_id = ?');
    params.push(userId);
  } else if (role === 'QC') {
    where.push("(b.status = 'QC_PENDING' OR b.qc_inspector_id = ?)");
    params.push(userId);
  } else if (role === 'OWNER' && ROLE_VIEW_STATUSES[view]) {
    where.push(`b.status IN (${ROLE_VIEW_STATUSES[view].map(() => '?').join(',')})`);
    params.push(...ROLE_VIEW_STATUSES[view]);
  }

  if (status) {
    where.push('b.status = ?');
    params.push(status);
  }

  const rows = db
    .prepare(`${BOOKING_SELECT} WHERE ${where.join(' AND ')} ORDER BY b.slot_date DESC, b.slot_time DESC, b.id DESC`)
    .all(...params);
  return rows.map((r) => summary(db, r));
}

export function listCustomerBookings(db, customerId) {
  const rows = db
    .prepare(`${BOOKING_SELECT} WHERE b.customer_id = ? ORDER BY b.id DESC`)
    .all(customerId);
  return rows.map((r) => {
    const est = db.prepare('SELECT status FROM estimates WHERE booking_id = ?').get(r.id);
    return {
      ...summary(db, r),
      availableActions: availableActions(r, { role: 'CUSTOMER', userId: customerId }),
      estimateStatus: est?.status ?? null,
    };
  });
}

// ---------- estimate editing ----------

const estimateSchema = z.object({
  labourCost: money,
  items: z
    .array(z.object({ partId: id, qty: z.coerce.number().int().min(1).max(999), unitCost: money.optional() }))
    .max(50),
});

function saveEstimate(db, booking, userId, input) {
  for (const item of input.items) {
    const part = db.prepare('SELECT unit_cost FROM parts WHERE id = ? AND shop_id = ?').get(item.partId, booking.shop_id);
    if (!part) throw badRequest(`Part ${item.partId} is not in this shop's inventory`);
    item.unitCost ??= part.unit_cost;
  }

  const existing = db.prepare('SELECT id, revision FROM estimates WHERE booking_id = ?').get(booking.id);
  let estimateId;
  if (existing) {
    db.prepare(
      `UPDATE estimates SET revision = revision + 1, labour_cost = ?, status = 'SUBMITTED',
         decision_note = NULL, submitted_by = ?, submitted_at = datetime('now'), sent_at = NULL, decided_at = NULL
       WHERE id = ?`,
    ).run(input.labourCost, userId, existing.id);
    db.prepare('DELETE FROM estimate_items WHERE estimate_id = ?').run(existing.id);
    estimateId = existing.id;
  } else {
    const res = db
      .prepare(
        `INSERT INTO estimates (booking_id, labour_cost, status, submitted_by, submitted_at)
         VALUES (?, ?, 'SUBMITTED', ?, datetime('now'))`,
      )
      .run(booking.id, input.labourCost, userId);
    estimateId = Number(res.lastInsertRowid);
  }

  const add = db.prepare('INSERT INTO estimate_items (estimate_id, part_id, qty, unit_cost) VALUES (?, ?, ?, ?)');
  for (const item of input.items) add.run(estimateId, item.partId, item.qty, item.unitCost);
  return getEstimate(db, booking.id);
}

/** SA edits the estimate while it is under review. Bumps the revision. */
export function editEstimate(db, { bookingId, shopId, actor, body }) {
  const input = parse(estimateSchema, body);
  return transaction(db, () => {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND shop_id = ?').get(bookingId, shopId);
    if (!booking) throw notFound('Booking not found');
    if (!['SA', 'OWNER'].includes(actor.role)) throw forbidden('Only the service advisor can edit estimates');
    if (booking.status !== STATUS.ESTIMATE_REVIEW) {
      throw conflict('Estimate can only be edited while it is in ESTIMATE_REVIEW');
    }
    const est = saveEstimate(db, booking, actor.userId, input);
    logHistory(db, booking.id, 'edit_estimate', booking.status, booking.status, actor, `Estimate revised (rev ${est.revision}), total PKR ${est.total}`);
    return est;
  });
}

// ---------- transitions ----------

function logHistory(db, bookingId, action, from, to, actor, note) {
  db.prepare(
    `INSERT INTO booking_history (booking_id, action, from_status, to_status, actor_id, actor_role, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(bookingId, action, from, to, actor.userId, actor.role, note ?? null);
}

function requireMember(db, shopId, userId, role) {
  const m = db
    .prepare('SELECT 1 FROM memberships WHERE shop_id = ? AND user_id = ? AND role = ? AND active = 1')
    .get(shopId, userId, role);
  if (!m) throw badRequest(`That person is not an active ${role} in this shop`);
}

const optionalNote = z.object({ note: z.string().trim().max(500).optional() });

// Per-action payload rules and side effects. Each returns
// { fields, note, after } where `fields` are extra booking columns to set
// and `after` runs once the status update succeeded.
const handlers = {
  confirm: ({ db, booking }) => ({
    after: () =>
      notify(db, [booking.customer_id], {
        shopId: booking.shop_id,
        bookingId: booking.id,
        message: `Your booking #${booking.id} has been confirmed`,
      }),
  }),

  assign_technician: ({ db, booking, payload }) => {
    const { technicianId } = parse(z.object({ technicianId: id }), payload);
    requireMember(db, booking.shop_id, technicianId, 'TECHNICIAN');
    return {
      fields: { technician_id: technicianId },
      after: () =>
        notify(db, [technicianId], {
          shopId: booking.shop_id,
          bookingId: booking.id,
          message: `Job #${booking.id} has been assigned to you`,
        }),
    };
  },

  submit_estimate: ({ db, booking, actor, payload }) => {
    const input = parse(estimateSchema, payload);
    const est = saveEstimate(db, booking, actor.userId, input);
    return {
      note: `Estimate rev ${est.revision}: ${est.items.length} part line(s), labour PKR ${est.labourCost}, total PKR ${est.total}`,
      after: () =>
        notify(db, shopDesk(db, booking.shop_id), {
          shopId: booking.shop_id,
          bookingId: booking.id,
          message: `Estimate submitted for booking #${booking.id} (PKR ${est.total})`,
        }),
    };
  },

  return_to_technician: ({ db, booking, payload }) => {
    const { note } = parse(optionalNote, payload);
    return {
      note,
      after: () =>
        notify(db, [booking.technician_id], {
          shopId: booking.shop_id,
          bookingId: booking.id,
          message: `Estimate for job #${booking.id} was sent back to you${note ? `: ${note}` : ''}`,
        }),
    };
  },

  send_estimate: ({ db, booking }) => {
    const est = getEstimate(db, booking.id);
    if (!est) throw conflict('There is no estimate to send yet');
    db.prepare("UPDATE estimates SET status = 'SENT', sent_at = datetime('now') WHERE id = ?").run(est.id);
    return {
      note: `Estimate rev ${est.revision} sent, total PKR ${est.total}`,
      after: () =>
        notify(db, [booking.customer_id], {
          shopId: booking.shop_id,
          bookingId: booking.id,
          message: `Estimate for booking #${booking.id} is waiting for your approval (PKR ${est.total})`,
        }),
    };
  },

  approve_estimate: ({ db, booking }) => {
    db.prepare("UPDATE estimates SET status = 'APPROVED', decided_at = datetime('now') WHERE booking_id = ?").run(
      booking.id,
    );
    return {
      note: 'Customer accepted the estimate',
      after: () =>
        notify(db, shopDesk(db, booking.shop_id), {
          shopId: booking.shop_id,
          bookingId: booking.id,
          message: `Customer approved the estimate for booking #${booking.id}`,
        }),
    };
  },

  reject_estimate: ({ db, booking, payload }) => {
    const { note } = parse(optionalNote, payload);
    db.prepare(
      "UPDATE estimates SET status = 'REJECTED', decision_note = ?, decided_at = datetime('now') WHERE booking_id = ?",
    ).run(note ?? null, booking.id);
    return {
      note: note ? `Customer rejected: ${note}` : 'Customer rejected the estimate',
      after: () =>
        notify(db, shopDesk(db, booking.shop_id), {
          shopId: booking.shop_id,
          bookingId: booking.id,
          message: `Customer rejected the estimate for booking #${booking.id}`,
        }),
    };
  },

  revise_with_technician: ({ db, booking, payload }) => {
    const { note } = parse(optionalNote, payload);
    return {
      note,
      after: () =>
        notify(db, [booking.technician_id], {
          shopId: booking.shop_id,
          bookingId: booking.id,
          message: `Customer rejected the estimate for job #${booking.id}, please revise it`,
        }),
    };
  },

  revise_estimate: ({ db, booking }) => {
    db.prepare("UPDATE estimates SET status = 'SUBMITTED' WHERE booking_id = ?").run(booking.id);
    return {};
  },

  assign_parts_person: ({ db, booking, payload }) => {
    const { partsPersonId } = parse(z.object({ partsPersonId: id }), payload);
    requireMember(db, booking.shop_id, partsPersonId, 'PARTS');
    return {
      fields: { parts_person_id: partsPersonId },
      after: () =>
        notify(db, [partsPersonId], {
          shopId: booking.shop_id,
          bookingId: booking.id,
          message: `Parts needed for booking #${booking.id}`,
        }),
    };
  },

  order_parts: ({ db, booking, actor, payload }) => {
    const { supplier } = parse(z.object({ supplier: z.string().trim().max(100).optional() }), payload);
    const missing = shortages(db, booking.id);
    if (!missing.length) throw conflict('Everything is in stock, allocate the parts instead');
    const poId = createPurchaseOrder(db, {
      shopId: booking.shop_id,
      bookingId: booking.id,
      userId: actor.userId,
      supplier,
      items: missing.map((m) => ({ partId: m.partId, qty: m.shortage })),
    });
    return { note: `PO #${poId}: ${missing.map((m) => `${m.name} x${m.shortage}`).join(', ')}` };
  },

  allocate_parts: ({ db, booking }) => {
    allocateForBooking(db, booking.id);
    return {
      note: 'Parts allocated from stock',
      after: () =>
        notify(db, [booking.technician_id], {
          shopId: booking.shop_id,
          bookingId: booking.id,
          message: `Parts are ready for job #${booking.id}`,
        }),
    };
  },

  release_to_repair: ({ db, booking }) => ({
    after: () =>
      notify(db, [booking.technician_id], {
        shopId: booking.shop_id,
        bookingId: booking.id,
        message: `Job #${booking.id} is ready for repair`,
      }),
  }),

  send_to_qc: ({ db, booking }) => {
    db.prepare("UPDATE qc_issues SET resolved_at = datetime('now') WHERE booking_id = ? AND resolved_at IS NULL").run(
      booking.id,
    );
    return {
      fields: { qc_inspector_id: null },
      after: () =>
        notify(db, staffWithRole(db, booking.shop_id, 'QC'), {
          shopId: booking.shop_id,
          bookingId: booking.id,
          message: `Job #${booking.id} is waiting in the QC queue`,
        }),
    };
  },

  pick_qc: ({ actor }) => ({ fields: { qc_inspector_id: actor.userId } }),

  pass_qc: ({ db, booking, payload }) => {
    const { note } = parse(optionalNote, payload);
    return {
      note: note ? `QC passed: ${note}` : 'QC passed',
      after: () =>
        notify(db, shopDesk(db, booking.shop_id), {
          shopId: booking.shop_id,
          bookingId: booking.id,
          message: `Booking #${booking.id} passed QC and is ready for pick-up`,
        }),
    };
  },

  fail_qc: ({ db, booking, actor, payload }) => {
    const issue = parse(
      z.object({
        title: z.string().trim().min(3, 'Give the issue a short title').max(120),
        description: z.string().trim().max(1000).optional(),
      }),
      payload,
    );
    db.prepare('INSERT INTO qc_issues (booking_id, title, description, raised_by) VALUES (?, ?, ?, ?)').run(
      booking.id,
      issue.title,
      issue.description ?? null,
      actor.userId,
    );
    return {
      note: `QC failed: ${issue.title}`,
      after: () =>
        notify(db, [booking.technician_id], {
          shopId: booking.shop_id,
          bookingId: booking.id,
          message: `QC failed for job #${booking.id}: ${issue.title}`,
        }),
    };
  },

  notify_ready: ({ db, booking }) => ({
    fields: { customer_notified_at: new Date().toISOString() },
    note: 'Customer told the vehicle is ready',
    after: () =>
      notify(db, [booking.customer_id], {
        shopId: booking.shop_id,
        bookingId: booking.id,
        message: `Your vehicle is ready for pick-up at ${booking.shop_name} (booking #${booking.id})`,
      }),
  }),

  complete: ({ db, booking, actor }) => ({
    after: () =>
      notify(db, actor.role === 'CUSTOMER' ? shopDesk(db, booking.shop_id) : [booking.customer_id], {
        shopId: booking.shop_id,
        bookingId: booking.id,
        message: `Booking #${booking.id} is completed`,
      }),
  }),

  cancel: ({ db, booking, actor, payload }) => {
    const { note } = parse(optionalNote, payload);
    const released = releaseAllocations(db, booking.id);
    const byCustomer = actor.role === 'CUSTOMER';
    return {
      note: [note, released ? `${released} reserved part line(s) returned to stock` : null].filter(Boolean).join('. '),
      after: () =>
        notify(db, byCustomer ? shopDesk(db, booking.shop_id) : [booking.customer_id], {
          shopId: booking.shop_id,
          bookingId: booking.id,
          message: `Booking #${booking.id} was cancelled${byCustomer ? ' by the customer' : ' by the shop'}`,
        }),
    };
  },
};

const ALLOWED_FIELDS = new Set(['technician_id', 'parts_person_id', 'qc_inspector_id', 'customer_notified_at']);

/**
 * Runs one state machine action. Everything (checks, side effects, status
 * change, audit log, notifications) happens in one transaction.
 * The UPDATE also matches on the old status, which is what makes
 * "first QC to pick wins" safe.
 */
export function performAction(db, { bookingId, shopId = null, actor, action, payload = {} }) {
  return transaction(db, () => {
    const booking = loadRow(db, bookingId);
    if (!booking || (shopId !== null && booking.shop_id !== shopId) || !canView(booking, actor)) {
      throw notFound('Booking not found');
    }

    const check = checkAction(action, booking, actor);
    if (!check.ok) throw new HttpError(check.status, check.reason);

    const def = ACTIONS[action];
    const result = handlers[action]?.({ db, booking, actor, payload }) ?? {};
    const fields = result.fields ?? {};
    for (const key of Object.keys(fields)) {
      if (!ALLOWED_FIELDS.has(key)) throw new Error(`Handler tried to set ${key}`);
    }

    const newStatus = def.to ?? booking.status;
    const sets = ['status = ?', "updated_at = datetime('now')", ...Object.keys(fields).map((k) => `${k} = ?`)];
    const update = db
      .prepare(`UPDATE bookings SET ${sets.join(', ')} WHERE id = ? AND status = ?`)
      .run(newStatus, ...Object.values(fields), booking.id, booking.status);
    if (update.changes === 0) throw conflict('Someone else updated this booking first, refresh and try again');

    logHistory(db, booking.id, action, booking.status, newStatus, actor, result.note);
    result.after?.();

    return getBookingDetail(db, booking.id, actor, shopId);
  });
}

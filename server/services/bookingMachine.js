// Single source of truth for booking statuses and who may move them.
// Routes never update bookings.status directly, they go through performAction().

export const STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  ASSIGNED: 'ASSIGNED',
  INSPECTING: 'INSPECTING',
  ESTIMATE_REVIEW: 'ESTIMATE_REVIEW',
  AWAITING_CUSTOMER: 'AWAITING_CUSTOMER',
  ESTIMATE_APPROVED: 'ESTIMATE_APPROVED',
  ESTIMATE_REJECTED: 'ESTIMATE_REJECTED',
  PARTS_PENDING: 'PARTS_PENDING',
  PARTS_ORDERED: 'PARTS_ORDERED',
  PARTS_READY: 'PARTS_READY',
  IN_REPAIR: 'IN_REPAIR',
  QC_PENDING: 'QC_PENDING',
  QC_IN_PROGRESS: 'QC_IN_PROGRESS',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

const S = STATUS;

// Cancelling is allowed for the customer or SA until the repair starts.
export const CANCELLABLE = [
  S.PENDING,
  S.CONFIRMED,
  S.ASSIGNED,
  S.INSPECTING,
  S.ESTIMATE_REVIEW,
  S.AWAITING_CUSTOMER,
  S.ESTIMATE_REJECTED,
  S.ESTIMATE_APPROVED,
  S.PARTS_PENDING,
  S.PARTS_ORDERED,
  S.PARTS_READY,
];

// assignee: booking column that must match the acting user (owner bypasses it).
// to: null means the action doesn't change status (only logged).
export const ACTIONS = {
  confirm: { label: 'Confirm booking', from: [S.PENDING], to: S.CONFIRMED, roles: ['SA'] },
  assign_technician: {
    label: 'Assign technician',
    from: [S.CONFIRMED],
    to: S.ASSIGNED,
    roles: ['SA'],
  },
  start_inspection: {
    label: 'Start inspection',
    from: [S.ASSIGNED],
    to: S.INSPECTING,
    roles: ['TECHNICIAN'],
    assignee: 'technician_id',
  },
  submit_estimate: {
    label: 'Submit estimate to SA',
    from: [S.INSPECTING],
    to: S.ESTIMATE_REVIEW,
    roles: ['TECHNICIAN'],
    assignee: 'technician_id',
  },
  return_to_technician: {
    label: 'Send back to technician',
    from: [S.ESTIMATE_REVIEW],
    to: S.INSPECTING,
    roles: ['SA'],
  },
  send_estimate: {
    label: 'Send estimate to customer',
    from: [S.ESTIMATE_REVIEW],
    to: S.AWAITING_CUSTOMER,
    roles: ['SA'],
  },
  approve_estimate: {
    label: 'Accept estimate',
    from: [S.AWAITING_CUSTOMER],
    to: S.ESTIMATE_APPROVED,
    roles: ['CUSTOMER'],
  },
  reject_estimate: {
    label: 'Reject estimate',
    from: [S.AWAITING_CUSTOMER],
    to: S.ESTIMATE_REJECTED,
    roles: ['CUSTOMER'],
  },
  revise_with_technician: {
    label: 'Revise with technician',
    from: [S.ESTIMATE_REJECTED],
    to: S.INSPECTING,
    roles: ['SA'],
  },
  revise_estimate: {
    label: 'Edit estimate myself',
    from: [S.ESTIMATE_REJECTED],
    to: S.ESTIMATE_REVIEW,
    roles: ['SA'],
  },
  assign_parts_person: {
    label: 'Assign parts person',
    from: [S.ESTIMATE_APPROVED],
    to: S.PARTS_PENDING,
    roles: ['SA'],
  },
  order_parts: {
    label: 'Order missing parts',
    from: [S.PARTS_PENDING],
    to: S.PARTS_ORDERED,
    roles: ['PARTS'],
    assignee: 'parts_person_id',
  },
  allocate_parts: {
    label: 'Allocate parts',
    from: [S.PARTS_PENDING, S.PARTS_ORDERED],
    to: S.PARTS_READY,
    roles: ['PARTS'],
    assignee: 'parts_person_id',
  },
  release_to_repair: {
    label: 'Hand over to technician',
    from: [S.PARTS_READY],
    to: S.IN_REPAIR,
    roles: ['PARTS'],
    assignee: 'parts_person_id',
  },
  send_to_qc: {
    label: 'Send to QC',
    from: [S.IN_REPAIR],
    to: S.QC_PENDING,
    roles: ['TECHNICIAN'],
    assignee: 'technician_id',
  },
  pick_qc: { label: 'Pick for QC', from: [S.QC_PENDING], to: S.QC_IN_PROGRESS, roles: ['QC'] },
  pass_qc: {
    label: 'Pass QC',
    from: [S.QC_IN_PROGRESS],
    to: S.READY_FOR_PICKUP,
    roles: ['QC'],
    assignee: 'qc_inspector_id',
  },
  fail_qc: {
    label: 'Fail QC (raise issue)',
    from: [S.QC_IN_PROGRESS],
    to: S.IN_REPAIR,
    roles: ['QC'],
    assignee: 'qc_inspector_id',
  },
  notify_ready: {
    label: 'Notify customer: ready',
    from: [S.READY_FOR_PICKUP],
    to: null,
    roles: ['SA'],
  },
  complete: {
    label: 'Mark as picked up',
    from: [S.READY_FOR_PICKUP],
    to: S.COMPLETED,
    roles: ['SA', 'CUSTOMER'],
  },
  cancel: { label: 'Cancel booking', from: CANCELLABLE, to: S.CANCELLED, roles: ['SA', 'CUSTOMER'] },
};

/**
 * actor = { userId, role } where role is OWNER | SA | TECHNICIAN | QC | PARTS | CUSTOMER
 * Returns { ok: true } or { ok: false, status, reason }.
 */
export function checkAction(action, booking, actor) {
  const def = ACTIONS[action];
  if (!def) return { ok: false, status: 400, reason: `Unknown action "${action}"` };

  if (actor.role === 'CUSTOMER') {
    if (!def.roles.includes('CUSTOMER') || booking.customer_id !== actor.userId) {
      return { ok: false, status: 403, reason: 'Customers cannot perform this action' };
    }
  } else {
    const staffRoles = def.roles.filter((r) => r !== 'CUSTOMER');
    if (staffRoles.length === 0) {
      return { ok: false, status: 403, reason: 'Only the customer can do this' };
    }
    const isOwner = actor.role === 'OWNER';
    if (!isOwner && !staffRoles.includes(actor.role)) {
      return { ok: false, status: 403, reason: `Only ${staffRoles.join('/')} can do this` };
    }
    if (def.assignee && !isOwner && booking[def.assignee] !== actor.userId) {
      return { ok: false, status: 403, reason: 'This job is not assigned to you' };
    }
  }

  if (!def.from.includes(booking.status)) {
    return {
      ok: false,
      status: 409,
      reason: `Cannot "${def.label}" while booking is ${booking.status}`,
    };
  }
  return { ok: true };
}

export function availableActions(booking, actor) {
  return Object.keys(ACTIONS)
    .filter((name) => checkAction(name, booking, actor).ok)
    .map((name) => ({ name, label: ACTIONS[name].label }));
}

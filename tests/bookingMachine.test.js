import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableActions, checkAction } from '../server/services/bookingMachine.js';

const booking = (status, extra = {}) => ({
  status,
  customer_id: 1,
  technician_id: 10,
  parts_person_id: 20,
  qc_inspector_id: 30,
  ...extra,
});

test('only valid transitions are allowed', () => {
  assert.equal(checkAction('confirm', booking('PENDING'), { role: 'SA', userId: 5 }).ok, true);
  const res = checkAction('confirm', booking('CONFIRMED'), { role: 'SA', userId: 5 });
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
});

test('roles are enforced per action', () => {
  assert.equal(checkAction('confirm', booking('PENDING'), { role: 'TECHNICIAN', userId: 10 }).status, 403);
  assert.equal(
    checkAction('approve_estimate', booking('AWAITING_CUSTOMER'), { role: 'SA', userId: 5 }).status,
    403,
  );
  assert.equal(
    checkAction('approve_estimate', booking('AWAITING_CUSTOMER'), { role: 'OWNER', userId: 2 }).status,
    403,
  );
  assert.equal(
    checkAction('approve_estimate', booking('AWAITING_CUSTOMER'), { role: 'CUSTOMER', userId: 1 }).ok,
    true,
  );
});

test('assigned staff only, owner can step in', () => {
  const b = booking('ASSIGNED');
  assert.equal(checkAction('start_inspection', b, { role: 'TECHNICIAN', userId: 11 }).status, 403);
  assert.equal(checkAction('start_inspection', b, { role: 'TECHNICIAN', userId: 10 }).ok, true);
  assert.equal(checkAction('start_inspection', b, { role: 'OWNER', userId: 2 }).ok, true);
});

test('customer cannot act on someone else booking', () => {
  assert.equal(checkAction('cancel', booking('PENDING'), { role: 'CUSTOMER', userId: 99 }).status, 403);
});

test('cancel is not possible once repair started', () => {
  for (const status of ['IN_REPAIR', 'QC_PENDING', 'READY_FOR_PICKUP', 'COMPLETED']) {
    assert.equal(checkAction('cancel', booking(status), { role: 'SA', userId: 5 }).ok, false, status);
  }
});

test('availableActions lists what the actor can do now', () => {
  const names = availableActions(booking('PARTS_PENDING'), { role: 'PARTS', userId: 20 }).map((a) => a.name);
  assert.deepEqual(names.sort(), ['allocate_parts', 'order_parts']);
});

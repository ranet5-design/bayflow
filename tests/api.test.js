import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { nextWorkingDate, startTestServer, vehicle } from './helpers.js';

let t;
let users;
let shop1Services;
let parts;

before(async () => {
  t = await startTestServer();
  const emails = {
    owner: 'fatima@bayflow.pk',
    sa: 'bilal@lahoreautocare.pk',
    imran: 'imran@lahoreautocare.pk',
    ali: 'ali@lahoreautocare.pk',
    qc: 'sara@lahoreautocare.pk',
    parts: 'usman@lahoreautocare.pk',
    karachiSa: 'sa@carclinic.pk',
    ayesha: 'ayesha@mail.com',
  };
  users = {};
  for (const [key, email] of Object.entries(emails)) users[key] = await t.login(email);
  shop1Services = (await t.request('GET', '/public/shops/1')).body.shop.services;
  parts = Object.fromEntries(
    (await t.request('GET', '/shops/1/parts', { token: users.parts.token })).body.parts.map((p) => [
      p.sku,
      p,
    ]),
  );
});

after(() => t.close());

const svc = (name) => shop1Services.find((s) => s.name === name).id;

async function book({
  time = '10:00',
  date = nextWorkingDate(),
  email = 'ahmed@mail.com',
  regNo = 'LEA-1234',
} = {}) {
  const res = await t.request('POST', '/public/shops/1/bookings', {
    body: {
      serviceIds: [svc('Check engine light'), svc('Oil change')],
      notes: 'Light came on yesterday',
      slotDate: date,
      slotTime: time,
      customer: { name: 'Ahmed Ali', email, password: 'Demo@1234' },
      vehicle: { ...vehicle, regNo },
    },
  });
  return res;
}

function act(user, bookingId, action, body = {}, shopId = 1) {
  return t.request('POST', `/shops/${shopId}/bookings/${bookingId}/actions/${action}`, {
    token: user.token,
    body,
  });
}

function customerAct(token, bookingId, action, body = {}) {
  return t.request('POST', `/me/bookings/${bookingId}/actions/${action}`, { token, body });
}

const estimate = () => ({
  labourCost: 4000,
  items: [
    { partId: parts['IGN-COIL'].id, qty: 1 },
    { partId: parts['OIL-FLT'].id, qty: 1 },
    { partId: parts['ENG-OIL-4L'].id, qty: 1 },
  ],
});

async function stock(sku) {
  const res = await t.request('GET', '/shops/1/parts', { token: users.parts.token });
  return res.body.parts.find((p) => p.sku === sku).qtyOnHand;
}

describe('full booking lifecycle (worked example)', () => {
  test('goes from PENDING to COMPLETED with QC fail loop', async () => {
    const created = await book({ time: '10:00' });
    assert.equal(created.status, 201);
    const id = created.body.bookingId;
    const customer = created.body.token;
    const imranId = users.imran.user.id;

    assert.equal((await act(users.sa, id, 'confirm')).body.booking.status, 'CONFIRMED');
    assert.equal(
      (await act(users.sa, id, 'assign_technician', { technicianId: imranId })).body.booking.status,
      'ASSIGNED',
    );

    // Ali is a technician too, but this job isn't his.
    assert.equal((await act(users.ali, id, 'start_inspection')).status, 404);
    assert.equal((await act(users.imran, id, 'start_inspection')).body.booking.status, 'INSPECTING');

    const submitted = await act(users.imran, id, 'submit_estimate', estimate());
    assert.equal(submitted.body.booking.status, 'ESTIMATE_REVIEW');
    assert.equal(submitted.body.booking.estimate.total, 16600);

    // SA trims labour before sending: revision goes up.
    const edited = await t.request('PUT', `/shops/1/bookings/${id}/estimate`, {
      token: users.sa.token,
      body: { ...estimate(), labourCost: 3500 },
    });
    assert.equal(edited.body.estimate.total, 16100);
    assert.equal(edited.body.estimate.revision, 2);

    assert.equal((await act(users.sa, id, 'send_estimate')).body.booking.status, 'AWAITING_CUSTOMER');
    // SA can't approve on behalf of the customer.
    assert.equal((await act(users.sa, id, 'approve_estimate')).status, 403);
    assert.equal(
      (await customerAct(customer, id, 'approve_estimate')).body.booking.status,
      'ESTIMATE_APPROVED',
    );

    const partsId = users.parts.user.id;
    assert.equal(
      (await act(users.sa, id, 'assign_parts_person', { partsPersonId: partsId })).body.booking.status,
      'PARTS_PENDING',
    );

    // Coil is out of stock in the seed, so allocation must fail first.
    assert.equal((await act(users.parts, id, 'allocate_parts')).status, 409);
    const ordered = await act(users.parts, id, 'order_parts', { supplier: 'Test supplier' });
    assert.equal(ordered.body.booking.status, 'PARTS_ORDERED');
    const po = ordered.body.booking.purchaseOrders[0];
    assert.equal(po.items[0].sku, 'IGN-COIL');

    const oilBefore = await stock('ENG-OIL-4L');
    const received = await t.request('POST', `/shops/1/purchase-orders/${po.id}/receive`, {
      token: users.parts.token,
      body: { items: [{ poItemId: po.items[0].id, qty: 1 }] },
    });
    assert.equal(received.body.status, 'RECEIVED');
    assert.equal(await stock('IGN-COIL'), 1);

    assert.equal((await act(users.parts, id, 'allocate_parts')).body.booking.status, 'PARTS_READY');
    assert.equal(await stock('IGN-COIL'), 0);
    assert.equal(await stock('ENG-OIL-4L'), oilBefore - 1);
    assert.equal((await act(users.parts, id, 'release_to_repair')).body.booking.status, 'IN_REPAIR');

    assert.equal((await act(users.imran, id, 'send_to_qc')).body.booking.status, 'QC_PENDING');
    assert.equal((await act(users.qc, id, 'pick_qc')).body.booking.status, 'QC_IN_PROGRESS');

    // Issue title is required when failing QC.
    assert.equal((await act(users.qc, id, 'fail_qc', {})).status, 400);
    const failed = await act(users.qc, id, 'fail_qc', {
      title: 'Oil leak at filter',
      description: 'Minor seep',
    });
    assert.equal(failed.body.booking.status, 'IN_REPAIR');
    assert.equal(failed.body.booking.issues.length, 1);

    assert.equal((await act(users.imran, id, 'send_to_qc')).body.booking.status, 'QC_PENDING');
    await act(users.qc, id, 'pick_qc');
    assert.equal((await act(users.qc, id, 'pass_qc')).body.booking.status, 'READY_FOR_PICKUP');

    // Too late to cancel now.
    assert.equal((await customerAct(customer, id, 'cancel')).status, 409);

    await act(users.sa, id, 'notify_ready');
    const done = await customerAct(customer, id, 'complete');
    assert.equal(done.body.booking.status, 'COMPLETED');

    const detail = await t.request('GET', `/shops/1/bookings/${id}`, { token: users.owner.token });
    const actions = detail.body.booking.history.map((h) => h.action);
    assert.ok(actions.includes('fail_qc'));
    assert.ok(actions.includes('edit_estimate'));
    assert.equal(detail.body.booking.issues[0].resolvedAt !== null, true);
  });
});

describe('estimate rejected path', () => {
  test('SA can send it back to the technician and resend', async () => {
    const created = await book({ time: '11:00', email: 'reject.test@mail.com', regNo: 'LEB-1111' });
    const id = created.body.bookingId;
    const customer = created.body.token;

    await act(users.sa, id, 'confirm');
    await act(users.sa, id, 'assign_technician', { technicianId: users.imran.user.id });
    await act(users.imran, id, 'start_inspection');
    await act(users.imran, id, 'submit_estimate', estimate());
    await act(users.sa, id, 'send_estimate');

    const rejected = await customerAct(customer, id, 'reject_estimate', { note: 'Too expensive' });
    assert.equal(rejected.body.booking.status, 'ESTIMATE_REJECTED');

    const revise = await act(users.sa, id, 'revise_with_technician', { note: 'Drop the coil' });
    assert.equal(revise.body.booking.status, 'INSPECTING');

    const cheaper = { labourCost: 2000, items: [{ partId: parts['OIL-FLT'].id, qty: 1 }] };
    const resubmitted = await act(users.imran, id, 'submit_estimate', cheaper);
    assert.equal(resubmitted.body.booking.estimate.revision, 2);
    await act(users.sa, id, 'send_estimate');
    assert.equal(
      (await customerAct(customer, id, 'approve_estimate')).body.booking.status,
      'ESTIMATE_APPROVED',
    );
  });
});

describe('cancellation', () => {
  test('releases reserved parts back to stock', async () => {
    const created = await book({ time: '12:00', email: 'cancel.test@mail.com', regNo: 'LEC-2222' });
    const id = created.body.bookingId;
    await act(users.sa, id, 'confirm');
    await act(users.sa, id, 'assign_technician', { technicianId: users.imran.user.id });
    await act(users.imran, id, 'start_inspection');
    await act(users.imran, id, 'submit_estimate', {
      labourCost: 500,
      items: [{ partId: parts['SPARK-PLG'].id, qty: 4 }],
    });
    await act(users.sa, id, 'send_estimate');
    await customerAct(created.body.token, id, 'approve_estimate');
    await act(users.sa, id, 'assign_parts_person', { partsPersonId: users.parts.user.id });

    const before = await stock('SPARK-PLG');
    await act(users.parts, id, 'allocate_parts');
    assert.equal(await stock('SPARK-PLG'), before - 4);

    const cancelled = await customerAct(created.body.token, id, 'cancel', { note: 'Changed my mind' });
    assert.equal(cancelled.body.booking.status, 'CANCELLED');
    assert.equal(await stock('SPARK-PLG'), before);
  });
});

describe('tenant isolation and access control', () => {
  test('staff of another shop cannot see or touch shop 1 data', async () => {
    const list = await t.request('GET', '/shops/1/bookings', { token: users.karachiSa.token });
    assert.equal(list.status, 404);
    const parts1 = await t.request('GET', '/shops/1/parts', { token: users.karachiSa.token });
    assert.equal(parts1.status, 404);
  });

  test('booking ids from another shop are not found through your own shop', async () => {
    // Booking 1 (seeded) belongs to shop 1; Karachi SA asks for it through shop 3.
    const res = await t.request('GET', '/shops/3/bookings/1', { token: users.karachiSa.token });
    assert.equal(res.status, 404);
    const action = await act(users.karachiSa, 1, 'cancel', {}, 3);
    assert.equal(action.status, 404);
  });

  test('a customer only sees their own bookings', async () => {
    const res = await t.request('GET', '/me/bookings/1', { token: (await t.login('ahmed@mail.com')).token });
    assert.equal(res.status, 404);
    const own = await t.request('GET', '/me/bookings/1', { token: users.ayesha.token });
    assert.equal(own.status, 200);
  });

  test('roles are checked on endpoints', async () => {
    const created = await book({ time: '13:00', email: 'roles.test@mail.com', regNo: 'LED-3333' });
    const id = created.body.bookingId;
    assert.equal((await act(users.parts, id, 'confirm')).status, 404); // parts person can't even see it yet
    assert.equal((await act(users.qc, id, 'confirm')).status, 404);
    assert.equal((await t.request('POST', '/shops/1/team', { token: users.sa.token, body: {} })).status, 403);
    assert.equal((await t.request('GET', '/shops/1/overview', { token: users.sa.token })).status, 403);
    assert.equal((await t.request('GET', '/shops/1/bookings')).status, 401);
  });

  test('wrong password for an existing customer email is rejected', async () => {
    const res = await t.request('POST', '/public/shops/1/bookings', {
      body: {
        serviceIds: [svc('Oil change')],
        slotDate: nextWorkingDate(),
        slotTime: '14:00',
        customer: { name: 'Someone', email: 'ayesha@mail.com', password: 'wrong-pass' },
        vehicle,
      },
    });
    assert.equal(res.status, 401);
  });
});

describe('double booking and race conditions', () => {
  test('a slot cannot be booked beyond its capacity', async () => {
    const date = nextWorkingDate(3);
    const a = await book({ date, time: '15:00', email: 'slot1@mail.com', regNo: 'S-1' });
    const b = await book({ date, time: '15:00', email: 'slot2@mail.com', regNo: 'S-2' });
    const c = await book({ date, time: '15:00', email: 'slot3@mail.com', regNo: 'S-3' });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(c.status, 409);

    const slots = await t.request('GET', `/public/shops/1/slots?date=${date}`);
    assert.equal(slots.body.slots.find((s) => s.time === '15:00').available, false);
  });

  test('only one QC inspector can pick a job', async () => {
    // Owner adds a second QC inspector.
    await t.request('POST', '/shops/1/team', {
      token: users.owner.token,
      body: { name: 'Second QC', email: 'qc2@lahoreautocare.pk', password: 'Demo@1234', role: 'QC' },
    });
    const qc2 = await t.login('qc2@lahoreautocare.pk');

    const created = await book({ time: '16:00', email: 'qc.lock@mail.com', regNo: 'Q-1' });
    const id = created.body.bookingId;
    await act(users.sa, id, 'confirm');
    await act(users.sa, id, 'assign_technician', { technicianId: users.imran.user.id });
    await act(users.imran, id, 'start_inspection');
    await act(users.imran, id, 'submit_estimate', { labourCost: 1000, items: [] });
    await act(users.sa, id, 'send_estimate');
    await customerAct(created.body.token, id, 'approve_estimate');
    await act(users.sa, id, 'assign_parts_person', { partsPersonId: users.parts.user.id });
    await act(users.parts, id, 'allocate_parts');
    await act(users.parts, id, 'release_to_repair');
    await act(users.imran, id, 'send_to_qc');

    const [first, second] = await Promise.all([act(users.qc, id, 'pick_qc'), act(qc2, id, 'pick_qc')]);
    const statuses = [first.status, second.status].sort();
    assert.equal(statuses[0], 200);
    assert.notEqual(statuses[1], 200);
  });
});

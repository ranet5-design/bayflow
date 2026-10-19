import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { dropAll, openDatabase, transaction } from './connection.js';
import { hashPassword } from '../services/userService.js';
import { createBooking, performAction } from '../services/bookingService.js';
import { workingDays } from '../services/slotService.js';
import { addDays, dayOfWeek, todayString } from '../utils/time.js';

// Every demo account uses this password. It is listed in the README.
export const DEMO_PASSWORD = 'Demo@1234';

const SERVICES = [
  ['Oil change', 'Engine oil and filter replacement', 45, 3500],
  ['Brake inspection / repair', 'Pads, discs and brake fluid check', 90, 2500],
  ['Check engine light', 'Computer scan and diagnosis', 60, 2000],
  ['Tire rotation', 'Rotate and balance all four tyres', 30, 1200],
  ['AC service', 'Gas top-up, leak check and filter clean', 90, 4500],
  ['General inspection', '40 point safety check', 60, 1500],
  ['Battery replacement', 'Test and replace battery', 30, 1000],
  ['Wheel alignment', 'Computerised alignment', 45, 2000],
];

const PARTS = [
  ['IGN-COIL', 'Ignition coil', 6500, 3, 2],
  ['OIL-FLT', 'Oil filter', 900, 15, 5],
  ['ENG-OIL-4L', 'Engine oil 4L (5W-30)', 5200, 10, 4],
  ['BRK-PAD-F', 'Front brake pads (set)', 4800, 6, 2],
  ['BRK-DISC', 'Brake disc', 7500, 2, 2],
  ['AIR-FLT', 'Air filter', 1200, 8, 3],
  ['SPARK-PLG', 'Spark plug', 850, 20, 8],
  ['BATT-55', 'Battery 55Ah', 18000, 3, 1],
  ['AC-GAS', 'AC gas R134a (can)', 3000, 5, 2],
  ['WIPER', 'Wiper blade', 1100, 1, 4],
  ['COOLANT', 'Coolant 1L', 1500, 7, 3],
];

const OWNERS = [
  { key: 'fatima', name: 'Fatima Raza', email: 'fatima@bayflow.pk', phone: '0300-1111111' },
  { key: 'kamran', name: 'Kamran Sheikh', email: 'kamran@bayflow.pk', phone: '0300-2222222' },
  { key: 'hina', name: 'Hina Malik', email: 'hina@bayflow.pk', phone: '0300-3333333' },
];

// The first shop follows the worked example in the brief.
const SHOPS = [
  {
    owner: 'fatima',
    name: 'Lahore Auto Care',
    city: 'Lahore',
    address: '45 Main Boulevard, Gulberg III',
    phone: '042-35761234',
    domain: 'lahoreautocare.pk',
    rating: 4.6,
    description: 'Family run workshop for Japanese cars since 2009.',
    team: [
      ['Bilal Ahmed', 'bilal', 'SA'],
      ['Imran Khan', 'imran', 'TECHNICIAN'],
      ['Ali Hassan', 'ali', 'TECHNICIAN'],
      ['Sara Iqbal', 'sara', 'QC'],
      ['Usman Tariq', 'usman', 'PARTS'],
    ],
    noStock: ['IGN-COIL'],
  },
  {
    owner: 'fatima',
    name: 'Raza Motors DHA',
    city: 'Lahore',
    address: 'Plot 12, Phase 5 Commercial, DHA',
    phone: '042-37189900',
    domain: 'razamotors.pk',
    rating: 4.3,
    description: 'Second branch with a dedicated AC and electrical bay.',
  },
  {
    owner: 'kamran',
    name: 'Karachi Car Clinic',
    city: 'Karachi',
    address: 'Shop 7, Shahrah-e-Faisal, PECHS',
    phone: '021-34567890',
    domain: 'carclinic.pk',
    rating: 4.4,
    description: 'Quick diagnostics and same day repairs.',
  },
  {
    owner: 'kamran',
    name: 'Clifton Auto Works',
    city: 'Karachi',
    address: 'Block 5, Clifton',
    phone: '021-35876543',
    domain: 'cliftonauto.pk',
    rating: 4.1,
    description: 'Brakes, suspension and alignment specialists.',
  },
  {
    owner: 'hina',
    name: 'Capital Auto Service',
    city: 'Islamabad',
    address: 'I-10 Markaz, Street 3',
    phone: '051-4441122',
    domain: 'capitalauto.pk',
    rating: 4.7,
    description: 'Authorised style service at independent prices.',
  },
  {
    owner: 'hina',
    name: 'Pindi Motor Garage',
    city: 'Rawalpindi',
    address: 'Saddar, Bank Road',
    phone: '051-5567788',
    domain: 'pindimotors.pk',
    rating: 3.9,
    description: 'Old school mechanics, honest prices.',
  },
];

const DEFAULT_TEAM = [
  ['Service Desk', 'sa', 'SA'],
  ['Tech One', 'tech1', 'TECHNICIAN'],
  ['Tech Two', 'tech2', 'TECHNICIAN'],
  ['QC Inspector', 'qc', 'QC'],
  ['Parts Counter', 'parts', 'PARTS'],
];

function nextWorkingDay(shop, from) {
  let date = addDays(from, 1);
  const days = workingDays(shop);
  while (!days.includes(dayOfWeek(date))) date = addDays(date, 1);
  return date;
}

export async function seed(db) {
  const hash = await hashPassword(DEMO_PASSWORD);
  const ids = {};

  transaction(db, () => {
    const addUser = db.prepare(
      'INSERT INTO users (name, email, phone, password_hash, is_owner) VALUES (?, ?, ?, ?, ?)',
    );
    const user = (name, email, phone, isOwner = 0) =>
      Number(addUser.run(name, email, phone ?? null, hash, isOwner).lastInsertRowid);

    for (const o of OWNERS) ids[o.key] = user(o.name, o.email, o.phone, 1);
    ids.ahmed = user('Ahmed Ali', 'ahmed@mail.com', '0321-4567890');
    ids.ayesha = user('Ayesha Noor', 'ayesha@mail.com', '0333-7654321');

    SHOPS.forEach((s, index) => {
      const shopId = Number(
        db
          .prepare(
            `INSERT INTO shops (owner_id, name, address, city, phone, description, rating,
               open_time, close_time, working_days, slot_minutes, slot_capacity)
             VALUES (?, ?, ?, ?, ?, ?, ?, '09:00', '18:00', '1,2,3,4,5,6', 60, 2)`,
          )
          .run(ids[s.owner], s.name, s.address, s.city, s.phone, s.description, s.rating).lastInsertRowid,
      );
      s.id = shopId;

      const member = db.prepare('INSERT INTO memberships (shop_id, user_id, role) VALUES (?, ?, ?)');
      member.run(shopId, ids[s.owner], 'OWNER');
      s.staff = {};
      for (const [name, handle, role] of s.team ?? DEFAULT_TEAM) {
        const staffName = s.team ? name : `${name} (${s.city})`;
        const userId = user(staffName, `${handle}@${s.domain}`, null);
        member.run(shopId, userId, role);
        s.staff[handle] = userId;
      }

      const service = db.prepare(
        'INSERT INTO services (shop_id, name, description, duration_min, base_price) VALUES (?, ?, ?, ?, ?)',
      );
      // Not every shop offers everything, and prices differ a little.
      SERVICES.filter((_, i) => (index + i) % 7 !== 6).forEach(([name, desc, mins, price]) =>
        service.run(shopId, name, desc, mins, price + index * 100),
      );

      const part = db.prepare(
        'INSERT INTO parts (shop_id, sku, name, unit_cost, qty_on_hand, reorder_level) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const [sku, name, cost, qty, reorder] of PARTS) {
        part.run(shopId, sku, name, cost, s.noStock?.includes(sku) ? 0 : qty, reorder);
      }
    });
  });

  seedHistory(db, ids);
  return ids;
}

// A finished booking for Ayesha so the dashboards are not empty on first open.
function seedHistory(db, ids) {
  const shop = SHOPS[0];
  const row = db.prepare('SELECT * FROM shops WHERE id = ?').get(shop.id);
  const serviceIds = db
    .prepare("SELECT id FROM services WHERE shop_id = ? AND name IN ('Oil change', 'General inspection')")
    .all(shop.id)
    .map((r) => r.id);
  const part = (sku) => db.prepare('SELECT id FROM parts WHERE shop_id = ? AND sku = ?').get(shop.id, sku).id;

  const bookingId = createBooking(db, {
    shopId: shop.id,
    customerId: ids.ayesha,
    serviceIds,
    notes: 'Due for 10,000 km service',
    slotDate: nextWorkingDay(row, todayString()),
    slotTime: '11:00',
    vehicle: {
      regNo: 'LEB-7788',
      make: 'Toyota',
      model: 'Corolla',
      year: 2019,
      color: 'White',
      mileage: 58000,
    },
  });

  const sa = { userId: shop.staff.bilal, role: 'SA' };
  const tech = { userId: shop.staff.imran, role: 'TECHNICIAN' };
  const parts = { userId: shop.staff.usman, role: 'PARTS' };
  const qc = { userId: shop.staff.sara, role: 'QC' };
  const customer = { userId: ids.ayesha, role: 'CUSTOMER' };
  const step = (actor, action, payload) => performAction(db, { bookingId, actor, action, payload });

  step(sa, 'confirm');
  step(sa, 'assign_technician', { technicianId: tech.userId });
  step(tech, 'start_inspection');
  step(tech, 'submit_estimate', {
    labourCost: 1500,
    items: [
      { partId: part('ENG-OIL-4L'), qty: 1 },
      { partId: part('OIL-FLT'), qty: 1 },
    ],
  });
  step(sa, 'send_estimate');
  step(customer, 'approve_estimate');
  step(sa, 'assign_parts_person', { partsPersonId: parts.userId });
  step(parts, 'allocate_parts');
  step(parts, 'release_to_repair');
  step(tech, 'send_to_qc');
  step(qc, 'pick_qc');
  step(qc, 'pass_qc', { note: 'Road test fine' });
  step(sa, 'notify_ready');
  step(customer, 'complete');

  // Move it into the past so it reads as history.
  const lastWeek = addDays(todayString(), -7);
  db.prepare('UPDATE bookings SET slot_date = ? WHERE id = ?').run(lastWeek, bookingId);
  db.prepare('UPDATE notifications SET is_read = 1').run();
}

// `npm run seed` wipes the database and loads fresh demo data.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDatabase(config.dbPath);
  dropAll(db);
  await seed(db);
  console.log(`Seeded ${path.resolve(config.dbPath)}`);
  console.log(`All demo accounts use password: ${DEMO_PASSWORD}`);
}

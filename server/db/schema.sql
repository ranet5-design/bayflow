-- BayFlow schema (SQLite)
-- Every shop-owned table carries shop_id directly or through bookings.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  is_owner      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shops (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      INTEGER NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,
  address       TEXT NOT NULL,
  city          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  description   TEXT,
  logo_url      TEXT,
  open_time     TEXT NOT NULL DEFAULT '09:00',
  close_time    TEXT NOT NULL DEFAULT '18:00',
  working_days  TEXT NOT NULL DEFAULT '1,2,3,4,5,6',
  slot_minutes  INTEGER NOT NULL DEFAULT 60,
  slot_capacity INTEGER NOT NULL DEFAULT 2,
  rating        REAL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memberships (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id    INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL CHECK (role IN ('OWNER', 'SA', 'TECHNICIAN', 'QC', 'PARTS')),
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (shop_id, user_id)
);

CREATE TABLE IF NOT EXISTS services (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id      INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  duration_min INTEGER NOT NULL DEFAULT 60,
  base_price   INTEGER,
  active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vehicles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  reg_no      TEXT NOT NULL,
  make        TEXT NOT NULL,
  model       TEXT NOT NULL,
  year        INTEGER NOT NULL,
  color       TEXT,
  mileage     INTEGER,
  UNIQUE (customer_id, reg_no)
);

CREATE TABLE IF NOT EXISTS bookings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id              INTEGER NOT NULL REFERENCES shops(id),
  customer_id          INTEGER NOT NULL REFERENCES users(id),
  vehicle_id           INTEGER NOT NULL REFERENCES vehicles(id),
  slot_date            TEXT NOT NULL,
  slot_time            TEXT NOT NULL,
  status               TEXT NOT NULL,
  notes                TEXT,
  technician_id        INTEGER REFERENCES users(id),
  parts_person_id      INTEGER REFERENCES users(id),
  qc_inspector_id      INTEGER REFERENCES users(id),
  customer_notified_at TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_shop_status ON bookings (shop_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings (shop_id, slot_date, slot_time);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings (customer_id);

CREATE TABLE IF NOT EXISTS booking_services (
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id),
  PRIMARY KEY (booking_id, service_id)
);

CREATE TABLE IF NOT EXISTS booking_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor_id    INTEGER REFERENCES users(id),
  actor_role  TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS estimates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id    INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  revision      INTEGER NOT NULL DEFAULT 1,
  labour_cost   INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'SENT', 'APPROVED', 'REJECTED')),
  decision_note TEXT,
  submitted_by  INTEGER REFERENCES users(id),
  submitted_at  TEXT,
  sent_at       TEXT,
  decided_at    TEXT
);

CREATE TABLE IF NOT EXISTS parts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id       INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  sku           TEXT NOT NULL,
  name          TEXT NOT NULL,
  qty_on_hand   INTEGER NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 0,
  unit_cost     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (shop_id, sku)
);

CREATE TABLE IF NOT EXISTS estimate_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  part_id     INTEGER NOT NULL REFERENCES parts(id),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  unit_cost   INTEGER NOT NULL CHECK (unit_cost >= 0)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id    INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  booking_id INTEGER REFERENCES bookings(id),
  status     TEXT NOT NULL CHECK (status IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED')),
  supplier   TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS po_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id        INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  part_id      INTEGER NOT NULL REFERENCES parts(id),
  qty_ordered  INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS allocations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  part_id    INTEGER NOT NULL REFERENCES parts(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  status     TEXT NOT NULL DEFAULT 'ALLOCATED' CHECK (status IN ('ALLOCATED', 'RELEASED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS qc_issues (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  raised_by   INTEGER REFERENCES users(id),
  resolved_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  shop_id    INTEGER REFERENCES shops(id),
  booking_id INTEGER REFERENCES bookings(id),
  message    TEXT NOT NULL,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read);

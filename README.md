# BayFlow

Multi-tenant management system for independent auto repair shops.

Customers find a shop, book a slot and follow their car from check-in to pick-up. Shop staff (Owner, Service Advisor, Technician, Parts Person, QC Inspector) work the whole repair job in one role-based POS, and every step is recorded.

- **Live demo:** https://bayflow-production-c33a.up.railway.app
- **Repository:** https://github.com/ranet5-design/bayflow

## Features

**Customer portal**

- Landing page with all shops, search (shop name, city or service) and a city filter
- Booking wizard: shop > services/problem + notes > date and time slot > personal and vehicle details > review
- Only free slots are shown, and a slot can never go over its capacity
- Account is created during booking (or reused if the email and password match)
- Dashboard with a status timeline, "estimate awaiting your approval" banner, itemized estimate with accept/reject, ready-for-pickup message, cancel button (until repair starts)

**Shop POS**

- Shop switcher for owners with several shops (and for staff working at more than one shop)
- Each role only sees its own work:
  - **Service Advisor:** all bookings with status filters, confirm/cancel, assign technician, review and edit estimate, send to customer, assign parts person, notify ready, complete
  - **Technician:** jobs assigned to them, inspection, estimate builder (parts from inventory + labour), send to QC, sees QC issues sent back
  - **Parts Person:** jobs waiting for parts with required vs available stock, purchase orders, receiving (partial deliveries allowed), allocation
  - **QC Inspector:** shared QC queue, pick a job (first one wins), checklist and notes, pass or raise an issue
  - **Owner:** overview per shop, team management (add, change role, deactivate), service catalog, shop settings, and can open any role view
- Notification bell with unread count for every event listed in the brief

**Backend**

- Booking state machine in one file (`server/services/bookingMachine.js`). Every status has an owner role and a fixed list of next steps. Anything else is rejected with 403/409.
- Every transition is written to `booking_history` (who, when, from, to, note)
- Estimate revision counter, bumped when the technician resubmits or the SA edits
- Tenant isolation: all shop routes go through `/api/shops/:shopId/...`, the caller's membership in that shop is checked first, and every query is filtered by `shop_id`. Staff of shop A asking for shop B data get **404**.

## Tech stack

| Part        | Choice                                                                 |
| ----------- | ---------------------------------------------------------------------- |
| Runtime     | Node.js 22.16+ (tested on Node 24)                                     |
| Backend     | Express 5, Zod for input validation, JWT auth, bcryptjs for passwords  |
| Database    | SQLite through Node's built-in `node:sqlite` module (no native builds) |
| Frontend    | Plain HTML, CSS and ES modules (no build step), served by Express      |
| Tests       | Node's built-in test runner (`node:test`)                              |
| Lint/format | ESLint 9 + Prettier                                                    |

Why this stack: one service, one command, nothing to install apart from Node. SQLite is enough for a single-server deployment and the whole booking engine runs inside real transactions. The data access is plain SQL, so moving to PostgreSQL later would mostly be a driver change.

## Prerequisites

- **Node.js 22.16 or newer** (`node -v`). Node 24 LTS is recommended.
- npm 10+ (comes with Node)
- Git

No database server or Docker is needed.

## Getting started

```bash
git clone <your-repo-url> bayflow
cd bayflow
npm install
cp .env.example .env        # on Windows PowerShell: Copy-Item .env.example .env
npm run seed                # creates ./data/bayflow.db with demo data
npm start                   # http://localhost:4000
```

For development with auto restart: `npm run dev`

### Environment variables

Copy `.env.example` to `.env`. Every variable is commented there; the important ones:

| Variable         | What it does                                                                 |
| ---------------- | ---------------------------------------------------------------------------- |
| `PORT`           | Port for the server (default 4000)                                           |
| `DATABASE_PATH`  | SQLite file location (default `./data/bayflow.db`)                           |
| `JWT_SECRET`     | Secret for signing login tokens. **Required** when `NODE_ENV=production`     |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `7d`                                                    |
| `SEED_ON_START`  | `true` loads demo data on startup if the database is empty                   |
| `TZ`             | Timezone for slots and "today" (default in example: `Asia/Karachi`)          |
| `CLIENT_URL`     | Only if you host the frontend somewhere else (turns on CORS for that origin) |

The email and calling/AI keys are placeholders for the optional features and are not used.

### Database

- The schema is in `server/db/schema.sql` and is applied automatically on startup (`CREATE TABLE IF NOT EXISTS`), so there is no separate migrate step.
- `npm run seed` **wipes** the database and loads fresh demo data.
- With `SEED_ON_START=true` the server seeds itself only when the database has no users.

### Tests

```bash
npm test
```

Runs against an in-memory database. Covers:

- the full worked example from booking to COMPLETED, including SA estimate edit, missing part > purchase order > receiving > allocation, and the QC fail loop
- estimate rejected path (back to technician, new revision, approved)
- cancellation returning reserved parts to stock
- tenant isolation (staff token for one shop gets 404 on another shop's data and bookings)
- role checks (wrong role 403, unassigned technician cannot act, SA cannot approve for the customer)
- slot capacity (third booking for a 2-car slot gets 409)
- two QC inspectors picking the same job at once (only one succeeds)
- state machine unit tests

Lint and format: `npm run lint`, `npm run format`

## Demo accounts

All demo accounts use the password **`Demo@1234`**. They are also listed on the login page of the live site.

| Role            | Email                   | Shop                                            |
| --------------- | ----------------------- | ----------------------------------------------- |
| Owner           | fatima@bayflow.pk       | Lahore Auto Care + Raza Motors DHA (2 shops)    |
| Service Advisor | bilal@lahoreautocare.pk | Lahore Auto Care                                |
| Technician      | imran@lahoreautocare.pk | Lahore Auto Care                                |
| Technician      | ali@lahoreautocare.pk   | Lahore Auto Care                                |
| QC Inspector    | sara@lahoreautocare.pk  | Lahore Auto Care                                |
| Parts Person    | usman@lahoreautocare.pk | Lahore Auto Care                                |
| Customer        | ahmed@mail.com          | no bookings yet, use him for the worked example |
| Customer        | ayesha@mail.com         | has one completed booking                       |

Other owners: `kamran@bayflow.pk` (Karachi Car Clinic, Clifton Auto Works) and `hina@bayflow.pk` (Capital Auto Service, Pindi Motor Garage).
Staff of the other shops follow the pattern `sa@`, `tech1@`, `tech2@`, `qc@`, `parts@` + the shop domain, for example `sa@carclinic.pk`, `qc@capitalauto.pk`. Domains: `razamotors.pk`, `carclinic.pk`, `cliftonauto.pk`, `capitalauto.pk`, `pindimotors.pk`.

In the seed, the **ignition coil is out of stock at Lahore Auto Care** on purpose, so the worked example goes through the purchase order path.

### Trying the worked example

1. Open the site, pick **Lahore Auto Care**, choose "Check engine light" + "Oil change", pick a slot, enter `ahmed@mail.com` / `Demo@1234` and a Honda Civic 2016, confirm.
2. Log in as Bilal (SA): confirm the booking and assign Imran.
3. Log in as Imran: start inspection, add ignition coil, oil filter, engine oil 4L, labour 4000, submit.
4. Bilal: change labour to 3500 (revision 2), send to customer.
5. Ahmed: accept the estimate.
6. Bilal: assign Usman as parts person.
7. Usman: "Order missing parts" (PO for the coil), then Inventory tab > Receive, then back on the job: Allocate parts, Hand over to technician.
8. Imran: send to QC. Sara: pick, fail with an issue. Imran: send to QC again. Sara: pass.
9. Bilal: notify customer. Ahmed: "I have collected my car" (or Bilal completes it).

## Booking lifecycle

```
PENDING -> CONFIRMED -> ASSIGNED -> INSPECTING -> ESTIMATE_REVIEW -> AWAITING_CUSTOMER
   -> ESTIMATE_APPROVED -> PARTS_PENDING -> (PARTS_ORDERED) -> PARTS_READY -> IN_REPAIR
   -> QC_PENDING -> QC_IN_PROGRESS -> READY_FOR_PICKUP -> COMPLETED

AWAITING_CUSTOMER -> ESTIMATE_REJECTED -> INSPECTING (revise with technician) or ESTIMATE_REVIEW (SA edits)
QC_IN_PROGRESS -> IN_REPAIR (QC failed, issue recorded) -> QC_PENDING ...
any status before IN_REPAIR -> CANCELLED (customer or SA, reserved parts go back to stock)
```

| Action                 | Who                         | From -> To                                     |
| ---------------------- | --------------------------- | ---------------------------------------------- |
| confirm                | SA                          | PENDING -> CONFIRMED                           |
| assign_technician      | SA                          | CONFIRMED -> ASSIGNED                          |
| start_inspection       | assigned technician         | ASSIGNED -> INSPECTING                         |
| submit_estimate        | assigned technician         | INSPECTING -> ESTIMATE_REVIEW                  |
| return_to_technician   | SA                          | ESTIMATE_REVIEW -> INSPECTING                  |
| send_estimate          | SA                          | ESTIMATE_REVIEW -> AWAITING_CUSTOMER           |
| approve / reject       | customer (own booking only) | AWAITING_CUSTOMER -> APPROVED / REJECTED       |
| revise_with_technician | SA                          | ESTIMATE_REJECTED -> INSPECTING                |
| revise_estimate        | SA                          | ESTIMATE_REJECTED -> ESTIMATE_REVIEW           |
| assign_parts_person    | SA                          | ESTIMATE_APPROVED -> PARTS_PENDING             |
| order_parts            | assigned parts person       | PARTS_PENDING -> PARTS_ORDERED                 |
| allocate_parts         | assigned parts person       | PARTS_PENDING/ORDERED -> PARTS_READY           |
| release_to_repair      | assigned parts person       | PARTS_READY -> IN_REPAIR                       |
| send_to_qc             | assigned technician         | IN_REPAIR -> QC_PENDING                        |
| pick_qc                | any QC of the shop          | QC_PENDING -> QC_IN_PROGRESS                   |
| pass_qc / fail_qc      | QC who picked it            | QC_IN_PROGRESS -> READY_FOR_PICKUP / IN_REPAIR |
| notify_ready           | SA                          | READY_FOR_PICKUP (no status change)            |
| complete               | customer or SA              | READY_FOR_PICKUP -> COMPLETED                  |
| cancel                 | customer or SA              | anything before IN_REPAIR -> CANCELLED         |

The owner passes every staff role check inside their own shops (for support), but cannot approve or reject an estimate for the customer.

## Architecture

```
Browser (public/)  --fetch JSON-->  Express routes (server/routes)
                                       |  auth + shopAccess middleware
                                       v
                                  services (server/services)
                                  bookingMachine  -> rules: who can do what, from which status
                                  bookingService  -> runs an action in one transaction:
                                                     check -> side effects -> conditional UPDATE
                                                     -> history row -> notifications
                                  inventoryService, slotService, notificationService
                                       |
                                       v
                                  SQLite (node:sqlite), schema.sql
```

## Project structure

```
bayflow/
  server/
    index.js              start the server (and seed if empty)
    app.js                express app, route mounting, static frontend
    config.js             env vars
    db/                   schema.sql, connection + transaction helper, seed.js
    middleware/auth.js    JWT check, per-shop membership/role check
    routes/               auth, public (shops, slots, booking), customer (/me),
                          shops (owner: shop, team, services, overview),
                          shopBookings (POS bookings + actions), inventory, notifications
    services/             bookingMachine, bookingService, inventoryService,
                          slotService, notificationService, userService
    utils/                errors, validation, time helpers
  public/
    index.html, css/, img/
    js/app.js             hash router, nav, notification bell
    js/api.js             fetch wrapper + session
    js/ui.js              helpers (escape, badges, modals, toasts)
    js/components.js      timeline, estimate table
    js/pages/             landing, booking wizard, auth, customer, POS (+ booking drawer, inventory)
  tests/                  API tests and state machine unit tests
```

## Design decisions

- **One state machine table.** `ACTIONS` in `bookingMachine.js` lists every action with its allowed from-statuses, target status, roles and (where needed) which booking column must match the user (`technician_id`, `parts_person_id`, `qc_inspector_id`). The API also returns `availableActions` for each booking, so the UI never has to guess which buttons to show.
- **Optimistic locking on status.** The status update is `UPDATE ... WHERE id = ? AND status = <old status>`. If two people act at the same time, the second one gets a 409. This is what makes "first QC to pick wins" safe.
- **Slots are calculated, not stored.** Working hours, slot length and capacity live on the shop. Free slots = generated times minus non-cancelled bookings. The capacity check and the insert run in the same `BEGIN IMMEDIATE` transaction so two customers can't take the last place.
- **Inventory.** Required parts come from the approved estimate. Allocation deducts stock and writes `allocations` rows; cancelling releases them. Purchase orders track `qty_ordered` / `qty_received` per line, so partial deliveries leave the PO as `PARTIALLY_RECEIVED` and the booking stays in `PARTS_ORDERED`.
- **404 instead of 403 across tenants.** A user without a membership in a shop can't tell whether the shop's bookings exist.
- **Roles per shop.** `memberships(shop_id, user_id, role)`, one role per shop. The same person can work at two shops with different roles. Owners add staff; there is no staff self sign-up.
- **Customers are global accounts.** The same email/password works at every shop.

## Deployment

The live demo runs on [Railway](https://railway.com):

1. New Project > GitHub Repository > `ranet5-design/bayflow`. Railway detects Node and runs `npm install` / `npm start`.
2. Service > Variables: `NODE_ENV=production`, `TZ=Asia/Karachi`, `DATABASE_PATH=./data/bayflow.db`, `SEED_ON_START=true`, `JWT_EXPIRES_IN=7d` and a long random `JWT_SECRET`.
3. Settings > Networking > Generate Domain (target port 8080, which Railway passes in as `PORT`).
4. Open the URL. The first start seeds the demo data. Health check: `/api/health`.

The repo also has a `render.yaml` Blueprint for [Render](https://render.com) with the same settings. Any host that runs Node 22.16+ works the same way: set the env vars from `.env.example` and run `npm start`.

Note: the container disk is not persistent, so data goes back to the seed after a redeploy. That is fine for a demo; for real use attach a volume and point `DATABASE_PATH` at it.

## Known limitations / not done

- Bonus track (in-app calling and AI front desk) is not implemented.
- Notifications are in-app only (bell, refreshed every 20 seconds); no email or SMS.
- One role per person per shop.
- Shop ratings are a placeholder value from the seed.

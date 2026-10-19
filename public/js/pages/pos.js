import { api, session } from '../api.js';
import {
  ALL_STATUSES,
  busy,
  esc,
  fmtDate,
  formValues,
  money,
  openModal,
  promptForm,
  ROLE_LABEL,
  statusBadge,
  statusLabel,
  toast,
} from '../ui.js';
import { navigate, currentQuery } from '../app.js';
import { openBookingDrawer } from './posBooking.js';
import { renderInventory } from './posInventory.js';

const TABS = {
  OWNER: [
    ['overview', 'Overview'],
    ['bookings', 'All bookings'],
    ['jobs', 'Technician view'],
    ['parts', 'Parts jobs'],
    ['inventory', 'Inventory'],
    ['qc', 'QC queue'],
    ['team', 'Team'],
    ['services', 'Services'],
    ['settings', 'Shop settings'],
  ],
  SA: [['bookings', 'Bookings']],
  TECHNICIAN: [['jobs', 'My jobs']],
  PARTS: [
    ['parts', 'Jobs awaiting parts'],
    ['inventory', 'Inventory & orders'],
  ],
  QC: [['qc', 'QC queue']],
};

async function refreshMemberships() {
  const me = await api('/auth/me');
  session.save(me);
  window.dispatchEvent(new Event('session-changed'));
}

export async function renderPos(root, [shopIdParam, tabParam]) {
  if (!session.user) return navigate('/login');
  await refreshMemberships();
  const memberships = session.memberships;

  if (!memberships.length) {
    root.innerHTML = session.user.isOwner
      ? `<div class="empty card"><h2>Welcome to BayFlow</h2><p>You don't have a shop yet.</p>
          <a class="btn" href="#/pos/new-shop">Create your first shop</a></div>`
      : '<div class="empty card"><h2>No shop access</h2><p>Your account is not part of any shop team.</p></div>';
    return;
  }

  const membership = memberships.find((m) => String(m.shopId) === shopIdParam) ?? memberships[0];
  const tabs = TABS[membership.role];
  const tab = tabs.find(([key]) => key === tabParam)?.[0] ?? tabs[0][0];
  if (String(membership.shopId) !== shopIdParam || tab !== tabParam) {
    return navigate(`/pos/${membership.shopId}/${tab}`);
  }
  const shopId = membership.shopId;

  root.innerHTML = `
    <div class="pos-head">
      <div>
        <h1 style="margin:0">${esc(membership.shopName)}</h1>
        <span class="muted small">${esc(membership.city)} &middot; you are <b>${ROLE_LABEL[membership.role]}</b></span>
      </div>
      <div class="row">
        ${
          memberships.length > 1
            ? `<select id="shopSwitch" aria-label="Switch shop" style="width:auto">
                ${memberships.map((m) => `<option value="${m.shopId}" ${m.shopId === shopId ? 'selected' : ''}>${esc(m.shopName)} (${ROLE_LABEL[m.role]})</option>`).join('')}
               </select>`
            : ''
        }
        ${session.user.isOwner ? '<a class="btn secondary" href="#/pos/new-shop">+ New shop</a>' : ''}
      </div>
    </div>
    <nav class="tabs">${tabs.map(([key, label]) => `<a href="#/pos/${shopId}/${key}" class="${key === tab ? 'active' : ''}">${label}</a>`).join('')}</nav>
    <div id="tabBody"><p class="muted">Loading...</p></div>`;

  root.querySelector('#shopSwitch')?.addEventListener('change', (e) => navigate(`/pos/${e.target.value}`));

  const body = root.querySelector('#tabBody');
  const isOwner = membership.role === 'OWNER';
  const views = {
    overview: () => renderOverview(body, shopId),
    bookings: () => renderBookingList(body, shopId, { filters: true }),
    jobs: () =>
      renderBookingList(body, shopId, {
        view: isOwner ? 'TECHNICIAN' : undefined,
        empty: 'No jobs assigned to you right now.',
      }),
    parts: () =>
      renderBookingList(body, shopId, {
        view: isOwner ? 'PARTS' : undefined,
        empty: 'No bookings waiting on parts.',
        hideDone: !isOwner,
      }),
    qc: () => renderBookingList(body, shopId, { view: isOwner ? 'QC' : undefined, empty: 'The QC queue is empty.' }),
    inventory: () => renderInventory(body, shopId),
    team: () => renderTeam(body, shopId),
    services: () => renderServices(body, shopId),
    settings: () => renderSettings(body, shopId),
  };
  await views[tab]();
}

// ---------- bookings list ----------

const FINISHED = ['COMPLETED', 'CANCELLED'];

async function renderBookingList(box, shopId, { filters = false, view, empty = 'No bookings yet.', hideDone = false }) {
  let statusFilter = filters ? 'ACTIVE' : '';
  let all = [];

  async function load() {
    const query = view ? `?view=${view}` : '';
    all = (await api(`/shops/${shopId}/bookings${query}`)).bookings;
    if (hideDone) all = all.filter((b) => !FINISHED.includes(b.status) && b.status !== 'IN_REPAIR');
    draw();
  }

  function draw() {
    const counts = Object.fromEntries(ALL_STATUSES.map((s) => [s, all.filter((b) => b.status === s).length]));
    const list =
      statusFilter === 'ACTIVE'
        ? all.filter((b) => !FINISHED.includes(b.status))
        : statusFilter
          ? all.filter((b) => b.status === statusFilter)
          : all;

    box.innerHTML = `
      ${
        filters
          ? `<div class="filter-chips">
              <button class="chip ${statusFilter === 'ACTIVE' ? 'active' : ''}" data-f="ACTIVE">Active (${all.filter((b) => !FINISHED.includes(b.status)).length})</button>
              <button class="chip ${statusFilter === '' ? 'active' : ''}" data-f="">All (${all.length})</button>
              ${ALL_STATUSES.filter((s) => counts[s])
                .map((s) => `<button class="chip ${statusFilter === s ? 'active' : ''}" data-f="${s}">${statusLabel(s)} (${counts[s]})</button>`)
                .join('')}
            </div>`
          : ''
      }
      ${
        list.length
          ? `<div class="card" style="padding:0"><div class="table-wrap"><table>
              <thead><tr><th>#</th><th>When</th><th>Vehicle</th><th class="hide-sm">Customer</th><th class="hide-sm">Services</th><th>Status</th><th class="hide-sm">Technician</th></tr></thead>
              <tbody>${list
                .map(
                  (b) => `<tr class="clickable" data-id="${b.id}">
                    <td>${b.id}</td>
                    <td>${fmtDate(b.slotDate)}<div class="muted small">${b.slotTime}</div></td>
                    <td>${esc(b.vehicle.make)} ${esc(b.vehicle.model)}<div class="muted small">${esc(b.vehicle.regNo)}</div></td>
                    <td class="hide-sm">${esc(b.customer.name)}</td>
                    <td class="hide-sm small">${b.services.map((s) => esc(s.name)).join(', ')}</td>
                    <td>${statusBadge(b.status)}</td>
                    <td class="hide-sm">${b.technician ? esc(b.technician.name) : '<span class="muted">-</span>'}</td>
                  </tr>`,
                )
                .join('')}</tbody></table></div></div>`
          : `<div class="empty card">${esc(empty)}</div>`
      }`;

    box.querySelectorAll('[data-f]').forEach((chip) => {
      chip.onclick = () => {
        statusFilter = chip.dataset.f;
        draw();
      };
    });
    box.querySelectorAll('tr[data-id]').forEach((row) => {
      row.onclick = () => openBookingDrawer(shopId, row.dataset.id, load);
    });
  }

  await load();
  const { open } = currentQuery();
  if (open) openBookingDrawer(shopId, open, load);
}

// ---------- owner: overview ----------

async function renderOverview(box, shopId) {
  const o = await api(`/shops/${shopId}/overview`);
  const count = (s) => o.byStatus.find((x) => x.status === s)?.count ?? 0;
  const total = o.byStatus.reduce((n, x) => n + x.count, 0);
  const active = total - count('COMPLETED') - count('CANCELLED');

  box.innerHTML = `
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <div class="card stat"><b>${active}</b><span>Active bookings</span></div>
      <div class="card stat"><b>${count('PENDING')}</b><span>Waiting for confirmation</span></div>
      <div class="card stat"><b>${count('AWAITING_CUSTOMER')}</b><span>Estimates with customer</span></div>
      <div class="card stat"><b>${count('READY_FOR_PICKUP')}</b><span>Ready for pick-up</span></div>
      <div class="card stat"><b>${count('COMPLETED')}</b><span>Completed</span></div>
      <div class="card stat"><b>${o.openQcIssues}</b><span>Open QC issues</span></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Bookings by status</h3>
        ${
          o.byStatus.length
            ? `<table>${o.byStatus.map((s) => `<tr><td>${statusBadge(s.status)}</td><td class="num">${s.count}</td></tr>`).join('')}</table>`
            : '<p class="muted">No bookings yet.</p>'
        }
      </div>
      <div class="card">
        <h3>Team</h3>
        <table>${o.team.map((t) => `<tr><td>${ROLE_LABEL[t.role]}</td><td class="num">${t.count}</td></tr>`).join('')}</table>
        <h3 style="margin-top:16px">Inventory</h3>
        <p>${o.inventory.parts} parts &middot; stock value ${money(o.inventory.stockValue)}</p>
        ${
          o.lowStockParts.length
            ? `<div class="alert warn small"><b>Low stock:</b> ${o.lowStockParts.map((p) => `${esc(p.name)} (${p.qtyOnHand})`).join(', ')}</div>`
            : '<p class="muted small">No low stock items.</p>'
        }
      </div>
    </div>`;
}

// ---------- owner: team ----------

async function renderTeam(box, shopId) {
  const { team } = await api(`/shops/${shopId}/team`);
  const staffRoles = ['SA', 'TECHNICIAN', 'QC', 'PARTS'];

  box.innerHTML = `
    <div class="card">
      <div class="row spread"><h3 style="margin:0">Team members</h3><button class="btn small" id="addMember">Add member</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>${team
          .map(
            (m) => `<tr>
              <td>${esc(m.name)}</td><td>${esc(m.email)}</td>
              <td>${
                m.role === 'OWNER'
                  ? 'Owner'
                  : `<select data-role="${m.id}" style="width:auto">${staffRoles.map((r) => `<option value="${r}" ${r === m.role ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select>`
              }</td>
              <td>${m.active ? '<span class="badge green">active</span>' : '<span class="badge red">deactivated</span>'}</td>
              <td>${m.role === 'OWNER' ? '' : `<button class="btn small secondary" data-toggle="${m.id}" data-active="${m.active}">${m.active ? 'Deactivate' : 'Reactivate'}</button>`}</td>
            </tr>`,
          )
          .join('')}</tbody>
      </table></div>
      <p class="muted small">Staff log in with the email and password you set here. Deactivated members lose access to this shop straight away.</p>
    </div>`;

  const reload = () => renderTeam(box, shopId);
  const patch = (membershipId, body) =>
    api(`/shops/${shopId}/team/${membershipId}`, { method: 'PATCH', body })
      .then(() => {
        toast('Team updated');
        reload();
      })
      .catch((err) => toast(err.message, 'error'));

  box.querySelectorAll('[data-role]').forEach((sel) => {
    sel.onchange = () => patch(sel.dataset.role, { role: sel.value });
  });
  box.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.onclick = () => patch(btn.dataset.toggle, { active: btn.dataset.active !== 'true' });
  });

  box.querySelector('#addMember').onclick = async () => {
    const values = await promptForm({
      title: 'Add team member',
      intro: '<p class="small muted">If the email already has a BayFlow account (e.g. works at your other shop), the password is ignored and they are just added here.</p>',
      fields: [
        { name: 'name', label: 'Full name', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'phone', label: 'Phone' },
        { name: 'role', label: 'Role', type: 'select', options: staffRoles.map((r) => ({ value: r, label: ROLE_LABEL[r] })) },
        { name: 'password', label: 'Password (min 6 characters)', type: 'password' },
      ],
      submitLabel: 'Add member',
    });
    if (!values) return;
    if (!values.phone) delete values.phone;
    if (!values.password) delete values.password;
    try {
      await api(`/shops/${shopId}/team`, { method: 'POST', body: values });
      toast('Member added');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// ---------- owner: services ----------

async function renderServices(box, shopId) {
  const { services } = await api(`/shops/${shopId}/services`);

  box.innerHTML = `
    <div class="card">
      <div class="row spread"><h3 style="margin:0">Service catalog</h3><button class="btn small" id="addService">Add service</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th class="hide-sm">Description</th><th class="num">Duration</th><th class="num">Base price</th><th>Status</th><th></th></tr></thead>
        <tbody>${services
          .map(
            (s) => `<tr>
              <td>${esc(s.name)}</td><td class="hide-sm small">${esc(s.description ?? '')}</td>
              <td class="num">${s.durationMin} min</td><td class="num">${s.basePrice != null ? money(s.basePrice) : '-'}</td>
              <td>${s.active ? '<span class="badge green">listed</span>' : '<span class="badge">hidden</span>'}</td>
              <td><button class="btn small secondary" data-edit="${s.id}">Edit</button></td>
            </tr>`,
          )
          .join('')}</tbody>
      </table></div>
    </div>`;

  const edit = async (service) => {
    const values = await promptForm({
      title: service ? 'Edit service' : 'Add service',
      fields: [
        { name: 'name', label: 'Name', required: true, value: service?.name },
        { name: 'description', label: 'Description', type: 'textarea', value: service?.description },
        { name: 'durationMin', label: 'Estimated duration (minutes)', type: 'number', required: true, value: service?.durationMin ?? 60 },
        { name: 'basePrice', label: 'Base price PKR (optional)', type: 'number', value: service?.basePrice ?? '' },
        ...(service
          ? [
              {
                name: 'active',
                label: 'Show to customers',
                type: 'select',
                value: String(service.active),
                options: [
                  { value: 'true', label: 'Yes' },
                  { value: 'false', label: 'No' },
                ],
              },
            ]
          : []),
      ],
    });
    if (!values) return;
    const body = {
      name: values.name,
      description: values.description || undefined,
      durationMin: Number(values.durationMin),
      basePrice: values.basePrice === '' ? null : Number(values.basePrice),
      active: values.active === undefined ? undefined : values.active === 'true',
    };
    try {
      if (service) await api(`/shops/${shopId}/services/${service.id}`, { method: 'PATCH', body });
      else await api(`/shops/${shopId}/services`, { method: 'POST', body });
      toast('Saved');
      renderServices(box, shopId);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  box.querySelector('#addService').onclick = () => edit(null);
  box.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.onclick = () => edit(services.find((s) => s.id === Number(btn.dataset.edit)));
  });
}

// ---------- shop form (new shop + settings) ----------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shopForm(shop = {}) {
  const days = shop.workingDays ?? [1, 2, 3, 4, 5, 6];
  return `
    <div class="form-grid">
      <div class="field"><label>Shop name</label><input name="name" required value="${esc(shop.name ?? '')}" /></div>
      <div class="field"><label>City</label><input name="city" required value="${esc(shop.city ?? '')}" /></div>
      <div class="field"><label>Address</label><input name="address" required value="${esc(shop.address ?? '')}" /></div>
      <div class="field"><label>Phone</label><input name="phone" required value="${esc(shop.phone ?? '')}" /></div>
      <div class="field"><label>Opens at</label><input name="openTime" type="time" required value="${shop.openTime ?? '09:00'}" /></div>
      <div class="field"><label>Closes at</label><input name="closeTime" type="time" required value="${shop.closeTime ?? '18:00'}" /></div>
      <div class="field"><label>Slot length (minutes)</label><input name="slotMinutes" type="number" min="15" max="240" required value="${shop.slotMinutes ?? 60}" /></div>
      <div class="field"><label>Cars per slot (capacity)</label><input name="slotCapacity" type="number" min="1" max="20" required value="${shop.slotCapacity ?? 2}" /></div>
      <div class="field"><label>Logo URL (optional)</label><input name="logoUrl" type="url" value="${esc(shop.logoUrl ?? '')}" /></div>
    </div>
    <div class="field"><label>Working days</label><div class="row">
      ${DAYS.map((d, i) => `<label class="checkbox"><input type="checkbox" name="day" value="${i}" ${days.includes(i) ? 'checked' : ''} /> ${d}</label>`).join('')}
    </div></div>
    <div class="field"><label>Short description</label><textarea name="description" rows="2">${esc(shop.description ?? '')}</textarea></div>`;
}

function readShopForm(form) {
  const v = formValues(form);
  return {
    name: v.name,
    city: v.city,
    address: v.address,
    phone: v.phone,
    openTime: v.openTime,
    closeTime: v.closeTime,
    slotMinutes: Number(v.slotMinutes),
    slotCapacity: Number(v.slotCapacity),
    logoUrl: v.logoUrl || undefined,
    description: v.description || undefined,
    workingDays: [...form.querySelectorAll('[name=day]:checked')].map((c) => Number(c.value)),
  };
}

async function renderSettings(box, shopId) {
  const { shop } = await api(`/shops/${shopId}`);
  box.innerHTML = `<form class="card" id="shopForm"><h3>Shop settings</h3>${shopForm(shop)}<button class="btn">Save settings</button></form>`;
  const form = box.querySelector('#shopForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      await api(`/shops/${shopId}`, { method: 'PATCH', body: readShopForm(form) });
      toast('Settings saved');
      await refreshMemberships();
    });
  });
}

export async function renderNewShop(root) {
  if (!session.user?.isOwner) {
    root.innerHTML = '<div class="alert err">Only owner accounts can create shops.</div>';
    return;
  }
  root.innerHTML = `
    <a href="#/pos" class="small">&larr; Back to POS</a>
    <form class="card" id="shopForm" style="margin-top:10px">
      <h2>Create a shop</h2>
      <p class="muted small">Each shop has its own team, services, slots, inventory and bookings.</p>
      ${shopForm()}
      <button class="btn">Create shop</button>
    </form>`;
  const form = root.querySelector('#shopForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const { shop } = await api('/shops', { method: 'POST', body: readShopForm(form) });
      await refreshMemberships();
      toast('Shop created. Add your services and team next.');
      openModal(`<h3>${esc(shop.name)} is ready</h3>
        <p>Next steps: add services so customers can book, then add your team and parts.</p>
        <button class="btn" data-close>Got it</button>`);
      navigate(`/pos/${shop.id}/services`);
    });
  });
}

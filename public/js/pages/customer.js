import { api, session } from '../api.js';
import { busy, confirmBox, esc, fmtDate, promptForm, statusBadge, toast } from '../ui.js';
import { estimateTable, historyList, progressBar, vehicleLine } from '../components.js';
import { navigate } from '../app.js';

function needsLogin(root) {
  if (session.user) return false;
  root.innerHTML = `<div class="empty card"><h2>Log in to see your bookings</h2>
    <a class="btn" href="#/login">Log in</a></div>`;
  return true;
}

function pendingBanner(b) {
  if (b.status === 'AWAITING_CUSTOMER') {
    return '<div class="alert warn"><b>Estimate awaiting your approval.</b> Please review the cost and accept or reject it.</div>';
  }
  if (b.status === 'READY_FOR_PICKUP') {
    return `<div class="alert ok"><b>Your vehicle is ready for pick-up</b> at ${esc(b.shopName)}.</div>`;
  }
  return '';
}

export async function renderMyBookings(root) {
  if (needsLogin(root)) return;
  const { bookings } = await api('/me/bookings');

  root.innerHTML = `
    <div class="row spread"><h1>My bookings</h1><a class="btn" href="#/">New booking</a></div>
    ${
      bookings.length
        ? `<div class="stack">${bookings
            .map(
              (b) => `
          <a class="card" href="#/my/${b.id}" style="display:block;text-decoration:none;color:inherit">
            <div class="row spread">
              <div><b>#${b.id} &middot; ${esc(b.shopName)}</b><div class="muted small">${vehicleLine(b.vehicle)}</div></div>
              ${statusBadge(b.status)}
            </div>
            <div class="small" style="margin-top:6px">${fmtDate(b.slotDate)} at ${b.slotTime} &middot; ${b.services.map((s) => esc(s.name)).join(', ')}</div>
            ${progressBar(b.status)}
            ${pendingBanner(b) ? `<div style="margin-top:10px">${pendingBanner(b)}</div>` : ''}
          </a>`,
            )
            .join('')}</div>`
        : '<div class="empty card"><p>You have no bookings yet.</p><a class="btn" href="#/">Find a shop</a></div>'
    }`;
}

export async function renderMyBooking(root, [bookingId]) {
  if (needsLogin(root)) return;
  const { booking: b } = await api(`/me/bookings/${bookingId}`);
  const can = (name) => b.availableActions.some((a) => a.name === name);

  root.innerHTML = `
    <a href="#/my" class="small">&larr; My bookings</a>
    <div class="row spread" style="margin:8px 0 4px">
      <h1 style="margin:0">Booking #${b.id}</h1>${statusBadge(b.status)}
    </div>
    <p class="muted">${esc(b.shop.name)}, ${esc(b.shop.city)} &middot; ${esc(b.shop.phone)}</p>
    ${progressBar(b.status)}
    <div style="margin:14px 0">${pendingBanner(b)}</div>

    <div class="grid grid-2">
      <div>
        <div class="card">
          <h3>Details</h3>
          <dl class="summary">
            <dt>When</dt><dd>${fmtDate(b.slotDate)} at ${b.slotTime}</dd>
            <dt>Vehicle</dt><dd>${vehicleLine(b.vehicle)}</dd>
            <dt>Services</dt><dd>${b.services.map((s) => esc(s.name)).join(', ')}</dd>
            <dt>Your notes</dt><dd>${esc(b.notes) || '<span class="muted">None</span>'}</dd>
            <dt>Technician</dt><dd>${b.technician ? esc(b.technician.name) : '<span class="muted">Not assigned yet</span>'}</dd>
          </dl>
        </div>
        <div class="card">
          <h3>Estimate</h3>
          ${estimateTable(b.estimate)}
          <div class="action-bar">
            ${can('approve_estimate') ? '<button class="btn" data-act="approve_estimate">Accept estimate</button>' : ''}
            ${can('reject_estimate') ? '<button class="btn danger" data-act="reject_estimate">Reject</button>' : ''}
          </div>
        </div>
        <div class="card action-bar">
          ${can('complete') ? '<button class="btn" data-act="complete">I have collected my car</button>' : ''}
          ${can('cancel') ? '<button class="btn danger" data-act="cancel">Cancel booking</button>' : ''}
          ${!can('complete') && !can('cancel') ? '<span class="muted small">No actions needed from you right now.</span>' : ''}
        </div>
      </div>
      <div class="card">
        <h3>Timeline</h3>
        ${historyList(b.history.filter((h) => h.action !== 'edit_estimate'))}
      </div>
    </div>`;

  root.querySelectorAll('[data-act]').forEach((btn) => {
    btn.onclick = async () => {
      const action = btn.dataset.act;
      let payload = {};
      if (action === 'reject_estimate') {
        const values = await promptForm({
          title: 'Reject estimate',
          fields: [{ name: 'note', label: 'Reason (helps the shop revise it)', type: 'textarea' }],
          submitLabel: 'Reject estimate',
        });
        if (!values) return;
        payload = { note: values.note || undefined };
      } else if (action === 'cancel') {
        const values = await promptForm({
          title: 'Cancel booking',
          fields: [{ name: 'note', label: 'Reason (optional)', type: 'textarea' }],
          submitLabel: 'Cancel booking',
        });
        if (!values) return;
        payload = { note: values.note || undefined };
      } else if (action === 'approve_estimate') {
        if (
          !(await confirmBox(
            `Accept the estimate of ${b.estimate.total.toLocaleString('en-PK')} PKR?`,
            'Accept',
          ))
        )
          return;
      }

      await busy(btn, async () => {
        await api(`/me/bookings/${b.id}/actions/${action}`, { method: 'POST', body: payload });
        toast('Done');
        window.dispatchEvent(new Event('data-changed'));
        navigate(`/my/${b.id}`);
      });
    };
  });
}

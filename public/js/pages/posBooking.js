// Booking detail drawer for shop staff. What shows up depends on the
// availableActions list the server sends back for the current user.
import { api } from '../api.js';
import { busy, esc, fmtDate, money, openDrawer, promptForm, statusBadge, toast } from '../ui.js';
import { estimateTable, historyList, vehicleLine } from '../components.js';

// Actions that get their own form instead of a plain button.
const INLINE = new Set(['submit_estimate', 'pass_qc', 'fail_qc', 'assign_technician', 'assign_parts_person']);

const NOTE_ACTIONS = {
  cancel: 'Reason for cancelling',
  return_to_technician: 'What should the technician change?',
  revise_with_technician: 'Note for the technician',
};

export function poBadge(status) {
  const color = status === 'RECEIVED' ? 'green' : status === 'PARTIALLY_RECEIVED' ? 'amber' : 'blue';
  return `<span class="badge ${color}">${status.replace('_', ' ').toLowerCase()}</span>`;
}

export function openBookingDrawer(shopId, bookingId, onChange) {
  const drawer = openDrawer('<p class="muted">Loading...</p>');
  const base = `/shops/${shopId}/bookings/${bookingId}`;
  let cache = { team: null, parts: null };

  async function load() {
    const { booking } = await api(base);
    if (!cache.parts) cache.parts = (await api(`/shops/${shopId}/parts`)).parts;
    const needsTeam = booking.availableActions.some((a) => a.name.startsWith('assign_'));
    if (needsTeam && !cache.team) cache.team = (await api(`/shops/${shopId}/team`)).team;
    draw(booking);
  }

  async function run(action, payload, button) {
    await busy(button, async () => {
      await api(`${base}/actions/${action}`, { method: 'POST', body: payload });
      toast('Saved');
      cache.parts = null;
      onChange?.();
      window.dispatchEvent(new Event('data-changed'));
      await load();
    });
  }

  function can(b, name) {
    return b.availableActions.some((a) => a.name === name);
  }

  function assignForm(b, action, role, field, label) {
    if (!can(b, action)) return '';
    const people = (cache.team ?? []).filter((m) => m.role === role && m.active);
    return `<form class="row" data-assign="${action}" data-field="${field}">
      <select name="person" required style="flex:1 1 200px">
        <option value="">${label}...</option>
        ${people.map((p) => `<option value="${p.userId}">${esc(p.name)}</option>`).join('')}
      </select>
      <button class="btn">${label}</button></form>`;
  }

  function estimateEditor(b, mode) {
    const lines = b.estimate?.items?.length ? b.estimate.items : [];
    const partOptions = (selected) =>
      cache.parts
        .map(
          (p) =>
            `<option value="${p.id}" data-cost="${p.unitCost}" ${p.id === selected ? 'selected' : ''}>
               ${esc(p.name)} (${esc(p.sku)}) - ${p.qtyOnHand} in stock</option>`,
        )
        .join('');
    const line = (item = {}) => `
      <div class="estimate-line">
        <select name="partId"><option value="">Choose part...</option>${partOptions(item.partId)}</select>
        <input name="qty" type="number" min="1" value="${item.qty ?? 1}" aria-label="Quantity" />
        <input name="unitCost" type="number" min="0" value="${item.unitCost ?? ''}" placeholder="Unit PKR" aria-label="Unit cost" />
        <button type="button" class="btn small secondary" data-remove title="Remove">&times;</button>
      </div>`;

    return `<form id="estimateForm" class="card">
      <h3>${mode === 'submit' ? 'Build estimate' : 'Edit estimate before sending'}</h3>
      <p class="muted small">Add the parts needed (from this shop's inventory) and the labour cost.</p>
      <div id="lines">${(lines.length ? lines : [{}]).map(line).join('')}</div>
      <button type="button" class="btn small secondary" id="addLine">+ Add part</button>
      <div class="field" style="margin-top:12px;max-width:220px">
        <label>Labour cost (PKR)</label>
        <input name="labourCost" type="number" min="0" required value="${b.estimate?.labourCost ?? ''}" />
      </div>
      <p><b>Total: <span id="estTotal">-</span></b></p>
      <button class="btn">${mode === 'submit' ? 'Submit estimate to SA' : 'Save changes (new revision)'}</button>
    </form>`;
  }

  function wireEstimate(b, mode) {
    const form = drawer.el.querySelector('#estimateForm');
    if (!form) return;
    const linesBox = form.querySelector('#lines');
    const template = linesBox.querySelector('.estimate-line').outerHTML;

    const recalc = () => {
      let total = Number(form.elements.labourCost.value || 0);
      linesBox.querySelectorAll('.estimate-line').forEach((row) => {
        total +=
          Number(row.querySelector('[name=qty]').value || 0) *
          Number(row.querySelector('[name=unitCost]').value || 0);
      });
      form.querySelector('#estTotal').textContent = money(total);
    };

    const wireLine = (row) => {
      const select = row.querySelector('select');
      select.onchange = () => {
        const cost = select.selectedOptions[0]?.dataset.cost;
        if (cost) row.querySelector('[name=unitCost]').value = cost;
        recalc();
      };
      row.querySelector('[data-remove]').onclick = () => {
        row.remove();
        recalc();
      };
    };

    linesBox.querySelectorAll('.estimate-line').forEach(wireLine);
    form.querySelector('#addLine').onclick = () => {
      linesBox.insertAdjacentHTML('beforeend', template);
      const row = linesBox.lastElementChild;
      row.querySelector('select').value = '';
      row.querySelector('[name=qty]').value = 1;
      row.querySelector('[name=unitCost]').value = '';
      wireLine(row);
    };
    form.addEventListener('input', recalc);
    recalc();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const items = [...linesBox.querySelectorAll('.estimate-line')]
        .map((row) => ({
          partId: Number(row.querySelector('select').value),
          qty: Number(row.querySelector('[name=qty]').value),
          unitCost: Number(row.querySelector('[name=unitCost]').value || 0),
        }))
        .filter((i) => i.partId);
      const body = { labourCost: Number(form.elements.labourCost.value || 0), items };
      const button = form.querySelector('button.btn:not(.small)');

      if (mode === 'submit') return run('submit_estimate', body, button);
      await busy(button, async () => {
        await api(`${base}/estimate`, { method: 'PUT', body });
        toast('Estimate updated');
        await load();
      });
    });
  }

  function qcForm(b) {
    if (!can(b, 'pass_qc')) return '';
    return `<form id="qcForm" class="card">
      <h3>Quality check</h3>
      <div class="qc-checklist grid grid-2" style="gap:4px">
        ${[
          'Road test done',
          'No warning lights',
          'No leaks under car',
          'Reported problem fixed',
          'Fluids topped up',
          'Car cleaned',
        ]
          .map(
            (c) => `<label class="checkbox"><input type="checkbox" name="check" value="${c}" /> ${c}</label>`,
          )
          .join('')}
      </div>
      <div class="field" style="margin-top:10px"><label>Notes</label><textarea name="note" rows="2"></textarea></div>
      <div class="action-bar">
        <button class="btn" name="pass">Pass QC</button>
        <button type="button" class="btn danger" id="failBtn">Fail and raise issue</button>
      </div>
    </form>`;
  }

  function partsCard(b) {
    if (!b.parts?.length && !b.purchaseOrders?.length) return '';
    return `<div class="card">
      <h3>Parts</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Part</th><th class="num">Needed</th><th class="num">Allocated</th><th class="num">In stock</th><th class="num">Short</th></tr></thead>
        <tbody>${b.parts
          .map(
            (p) => `<tr><td>${esc(p.name)} <span class="muted small">${esc(p.sku)}</span></td>
              <td class="num">${p.required}</td><td class="num">${p.allocated}</td><td class="num">${p.onHand}</td>
              <td class="num">${p.shortage ? `<span class="badge red">${p.shortage}</span>` : '<span class="badge green">0</span>'}</td></tr>`,
          )
          .join('')}</tbody>
      </table></div>
      ${b.purchaseOrders
        .map(
          (po) => `<p class="small">PO #${po.id} ${poBadge(po.status)}
            ${po.items.map((i) => `${esc(i.name)} ${i.qtyReceived}/${i.qtyOrdered}`).join(', ')}</p>`,
        )
        .join('')}
    </div>`;
  }

  function draw(b) {
    const plain = b.availableActions.filter((a) => !INLINE.has(a.name));
    const showEditor = can(b, 'submit_estimate')
      ? 'submit'
      : b.status === 'ESTIMATE_REVIEW' && can(b, 'send_estimate')
        ? 'edit'
        : null;

    drawer.el.innerHTML = `
      <div class="row spread">
        <h2 style="margin:0">Booking #${b.id}</h2>
        <button class="btn small secondary" data-close>Close</button>
      </div>
      <div class="row" style="margin:6px 0 14px">${statusBadge(b.status)}
        <span class="muted small">${fmtDate(b.slotDate)} at ${b.slotTime}</span></div>

      <div class="card">
        <dl class="summary">
          <dt>Vehicle</dt><dd>${vehicleLine(b.vehicle)}${b.vehicle.mileage ? ` &middot; ${b.vehicle.mileage.toLocaleString()} km` : ''}</dd>
          <dt>Customer</dt><dd>${esc(b.customer.name)} &middot; ${esc(b.customer.phone ?? '')} &middot; ${esc(b.customer.email)}</dd>
          <dt>Services</dt><dd>${b.services.map((s) => esc(s.name)).join(', ')}</dd>
          <dt>Customer notes</dt><dd>${esc(b.notes) || '<span class="muted">None</span>'}</dd>
          <dt>Technician</dt><dd>${b.technician ? esc(b.technician.name) : '-'}</dd>
          <dt>Parts person</dt><dd>${b.partsPerson ? esc(b.partsPerson.name) : '-'}</dd>
          <dt>QC</dt><dd>${b.qcInspector ? esc(b.qcInspector.name) : '-'}</dd>
        </dl>
      </div>

      ${
        b.availableActions.length
          ? `<div class="card stack">
              <h3>Next step</h3>
              ${plain.length ? `<div class="action-bar">${plain.map((a) => `<button class="btn ${a.name === 'cancel' ? 'danger' : ''}" data-act="${a.name}">${esc(a.label)}</button>`).join('')}</div>` : ''}
              ${assignForm(b, 'assign_technician', 'TECHNICIAN', 'technicianId', 'Assign technician')}
              ${assignForm(b, 'assign_parts_person', 'PARTS', 'partsPersonId', 'Assign parts person')}
              ${b.status === 'READY_FOR_PICKUP' && b.customerNotifiedAt ? '<p class="small muted">Customer has been notified.</p>' : ''}
            </div>`
          : '<div class="card muted small">Nothing for you to do on this booking right now.</div>'
      }

      ${
        b.issues.filter((i) => !i.resolvedAt).length
          ? `<div class="alert err" style="margin-top:16px"><b>Open QC issue:</b> ${b.issues
              .filter((i) => !i.resolvedAt)
              .map((i) => `${esc(i.title)}${i.description ? ` - ${esc(i.description)}` : ''}`)
              .join('; ')}</div>`
          : ''
      }

      ${qcForm(b)}
      ${showEditor ? estimateEditor(b, showEditor) : ''}
      ${b.estimate ? `<div class="card"><h3>Estimate</h3>${estimateTable(b.estimate)}</div>` : ''}
      ${partsCard(b)}
      ${b.issues.length ? `<div class="card"><h3>QC issues</h3>${b.issues.map((i) => `<p class="small"><b>${esc(i.title)}</b> ${i.resolvedAt ? '<span class="badge green">resolved</span>' : '<span class="badge red">open</span>'}<br>${esc(i.description ?? '')}<br><span class="muted">${esc(i.raisedBy)}</span></p>`).join('')}</div>` : ''}
      <div class="card"><h3>History</h3>${historyList(b.history)}</div>`;

    drawer.el.querySelectorAll('[data-act]').forEach((btn) => {
      btn.onclick = async () => {
        const action = btn.dataset.act;
        let payload = {};
        if (NOTE_ACTIONS[action]) {
          const values = await promptForm({
            title: btn.textContent,
            fields: [{ name: 'note', label: NOTE_ACTIONS[action], type: 'textarea' }],
            submitLabel: btn.textContent,
          });
          if (!values) return;
          payload = { note: values.note || undefined };
        }
        if (action === 'order_parts') {
          const values = await promptForm({
            title: 'Order missing parts',
            intro: '<p class="small muted">A purchase order is created for every part that is short.</p>',
            fields: [{ name: 'supplier', label: 'Supplier (optional)' }],
            submitLabel: 'Create purchase order',
          });
          if (!values) return;
          payload = { supplier: values.supplier || undefined };
        }
        run(action, payload, btn);
      };
    });

    drawer.el.querySelectorAll('[data-assign]').forEach((form) => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        run(
          form.dataset.assign,
          { [form.dataset.field]: Number(form.elements.person.value) },
          form.querySelector('button'),
        );
      });
    });

    const qc = drawer.el.querySelector('#qcForm');
    if (qc) {
      qc.addEventListener('submit', (e) => {
        e.preventDefault();
        const checks = [...qc.querySelectorAll('[name=check]:checked')].map((c) => c.value);
        const note = [qc.elements.note.value.trim(), checks.length ? `Checked: ${checks.join(', ')}` : '']
          .filter(Boolean)
          .join('. ');
        run('pass_qc', { note: note || undefined }, qc.querySelector('[name=pass]'));
      });
      qc.querySelector('#failBtn').onclick = async (e) => {
        const values = await promptForm({
          title: 'Raise QC issue',
          fields: [
            { name: 'title', label: 'Issue title', required: true },
            {
              name: 'description',
              label: 'Details for the technician',
              type: 'textarea',
              value: qc.elements.note.value,
            },
          ],
          submitLabel: 'Fail QC',
        });
        if (!values) return;
        run('fail_qc', { title: values.title, description: values.description || undefined }, e.target);
      };
    }

    if (showEditor) wireEstimate(b, showEditor);
  }

  load().catch((err) => {
    drawer.el.innerHTML = `<div class="alert err">${esc(err.message)}</div><button class="btn secondary" data-close>Close</button>`;
  });
}

import { esc, fmtDateTime, money, ROLE_LABEL, statusLabel } from './ui.js';

// Customer friendly stages. Each booking status maps to one of them.
const STAGES = [
  ['Booked', ['PENDING']],
  ['Confirmed', ['CONFIRMED', 'ASSIGNED']],
  ['Inspection', ['INSPECTING', 'ESTIMATE_REVIEW']],
  ['Estimate', ['AWAITING_CUSTOMER', 'ESTIMATE_REJECTED', 'ESTIMATE_APPROVED']],
  ['Parts', ['PARTS_PENDING', 'PARTS_ORDERED', 'PARTS_READY']],
  ['Repair', ['IN_REPAIR']],
  ['Quality check', ['QC_PENDING', 'QC_IN_PROGRESS']],
  ['Ready', ['READY_FOR_PICKUP']],
  ['Done', ['COMPLETED']],
];

export function progressBar(status) {
  if (status === 'CANCELLED') return '<div class="alert err small">This booking was cancelled.</div>';
  const current = STAGES.findIndex(([, list]) => list.includes(status));
  return `
    <div class="progress">${STAGES.map(
      (_, i) =>
        `<span class="${i < current || status === 'COMPLETED' ? 'done' : i === current ? 'now' : ''}"></span>`,
    ).join('')}</div>
    <div class="progress-labels"><span>${STAGES[0][0]}</span><span>${current > 0 && current < STAGES.length - 1 ? STAGES[current][0] : ''}</span><span>${STAGES.at(-1)[0]}</span></div>`;
}

export function historyList(history) {
  return `<ul class="history">${history
    .map(
      (
        h,
      ) => `<li><b>${esc(statusLabel(h.toStatus))}</b>${h.fromStatus === h.toStatus ? ` <span class="muted">(${esc(h.action.replaceAll('_', ' '))})</span>` : ''}
        ${h.note ? `<div>${esc(h.note)}</div>` : ''}
        <small>${fmtDateTime(h.at)} &middot; ${esc(h.actorName ?? 'System')}${h.actorRole ? ` (${esc(ROLE_LABEL[h.actorRole] ?? 'Customer')})` : ''}</small></li>`,
    )
    .join('')}</ul>`;
}

export function estimateTable(estimate) {
  if (!estimate) return '<p class="muted">No estimate yet.</p>';
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th></tr></thead>
      <tbody>
        ${estimate.items
          .map(
            (i) =>
              `<tr><td>${esc(i.name)} <span class="muted small">${esc(i.sku)}</span></td><td class="num">${i.qty}</td>
               <td class="num">${money(i.unitCost)}</td><td class="num">${money(i.lineTotal)}</td></tr>`,
          )
          .join('')}
        <tr><td colspan="3">Labour</td><td class="num">${money(estimate.labourCost)}</td></tr>
        <tr><th colspan="3">Total</th><th class="num">${money(estimate.total)}</th></tr>
      </tbody>
    </table></div>
    <p class="muted small">Revision ${estimate.revision} &middot; ${esc(estimate.status.toLowerCase())}
      ${estimate.decisionNote ? ` &middot; Customer note: "${esc(estimate.decisionNote)}"` : ''}</p>`;
}

export function vehicleLine(v) {
  return `${esc(v.make)} ${esc(v.model)} ${esc(v.year)} &middot; <b>${esc(v.regNo)}</b>${v.color ? ` &middot; ${esc(v.color)}` : ''}`;
}

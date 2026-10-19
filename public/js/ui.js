// Shared UI helpers used by all pages.

export function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

export const money = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK')}`;

export function fmtDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Server timestamps are UTC "YYYY-MM-DD HH:MM:SS".
export function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(ts) {
  const d = new Date(`${ts.replace(' ', 'T')}Z`);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return fmtDateTime(ts);
}

const STATUS_LABEL = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  ASSIGNED: 'Assigned',
  INSPECTING: 'Inspecting',
  ESTIMATE_REVIEW: 'Estimate review',
  AWAITING_CUSTOMER: 'Awaiting customer',
  ESTIMATE_APPROVED: 'Estimate approved',
  ESTIMATE_REJECTED: 'Estimate rejected',
  PARTS_PENDING: 'Parts pending',
  PARTS_ORDERED: 'Parts ordered',
  PARTS_READY: 'Parts ready',
  IN_REPAIR: 'In repair',
  QC_PENDING: 'QC pending',
  QC_IN_PROGRESS: 'QC in progress',
  READY_FOR_PICKUP: 'Ready for pick-up',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const ALL_STATUSES = Object.keys(STATUS_LABEL);

const STATUS_COLOR = {
  PENDING: 'amber',
  AWAITING_CUSTOMER: 'orange',
  ESTIMATE_REJECTED: 'red',
  READY_FOR_PICKUP: 'green',
  COMPLETED: 'green',
  CANCELLED: 'red',
  QC_PENDING: 'blue',
  QC_IN_PROGRESS: 'blue',
};

export const statusLabel = (s) => STATUS_LABEL[s] ?? s;

export function statusBadge(status) {
  return `<span class="badge ${STATUS_COLOR[status] ?? ''}">${esc(statusLabel(status))}</span>`;
}

export const ROLE_LABEL = {
  OWNER: 'Owner',
  SA: 'Service Advisor',
  TECHNICIAN: 'Technician',
  QC: 'QC Inspector',
  PARTS: 'Parts Person',
};

export function toast(message, type = 'info') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 5000 : 3000);
}

export function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

/** Disables a button while an async task runs and shows errors as toasts. */
export async function busy(button, task) {
  const original = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.innerHTML = 'Please wait...';
  }
  try {
    return await task();
  } catch (err) {
    toast(err.message, 'error');
    return undefined;
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = original;
    }
  }
}

function overlay(className, html, onClose) {
  const wrap = document.createElement('div');
  wrap.className = `overlay ${className}`;
  wrap.innerHTML = html;
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  return { el: wrap.firstElementChild, close };
}

export function openDrawer(html, onClose) {
  return overlay('', `<div class="drawer">${html}</div>`, onClose);
}

export function openModal(html) {
  return overlay('modal-wrap', `<div class="modal">${html}</div>`);
}

/** Simple promise based form dialog. Resolves with form values or null. */
export function promptForm({ title, fields, submitLabel = 'Save', intro = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const inputs = fields
      .map((f) => {
        const req = f.required ? 'required' : '';
        const control =
          f.type === 'textarea'
            ? `<textarea name="${f.name}" rows="3" ${req}>${esc(f.value ?? '')}</textarea>`
            : f.type === 'select'
              ? `<select name="${f.name}" ${req}>${f.options
                  .map(
                    (o) =>
                      `<option value="${esc(o.value)}" ${String(o.value) === String(f.value) ? 'selected' : ''}>${esc(o.label)}</option>`,
                  )
                  .join('')}</select>`
              : `<input name="${f.name}" type="${f.type ?? 'text'}" value="${esc(f.value ?? '')}" ${req} />`;
        return `<div class="field"><label>${esc(f.label)}</label>${control}</div>`;
      })
      .join('');

    const { el, close } = overlay(
      'modal-wrap',
      `<div class="modal"><h3>${esc(title)}</h3>${intro}
        <form>${inputs}
          <div class="row spread"><button type="button" class="btn secondary" data-close>Cancel</button>
          <button class="btn">${esc(submitLabel)}</button></div>
        </form></div>`,
      () => !done && resolve(null),
    );
    el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      done = true;
      resolve(formValues(e.target));
      close();
    });
    el.querySelector('input, textarea, select')?.focus();
  });
}

export function confirmBox(message, label = 'Yes, continue') {
  return promptForm({ title: 'Please confirm', fields: [], intro: `<p>${esc(message)}</p>`, submitLabel: label }).then(
    (v) => v !== null,
  );
}

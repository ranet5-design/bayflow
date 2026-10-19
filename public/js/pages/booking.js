import { api, session } from '../api.js';
import { busy, esc, fmtDate, formValues, money, toast } from '../ui.js';
import { navigate } from '../app.js';

const STEPS = ['Services', 'Time slot', 'Your details', 'Review'];

function localDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function renderBooking(root, [shopId]) {
  const { shop } = await api(`/public/shops/${shopId}`);

  const state = {
    step: 0,
    serviceIds: [],
    notes: '',
    date: null,
    time: null,
    customer: { name: '', email: '', phone: '', password: '' },
    vehicle: { regNo: '', make: '', model: '', year: '', color: '', mileage: '' },
  };

  const days = Array.from({ length: 14 }, (_, i) => localDate(i));
  state.date = days.find((d) => shop.workingDays.includes(new Date(`${d}T00:00`).getDay()));

  function header() {
    return `
      <a href="#/" class="small">&larr; All shops</a>
      <h1 style="margin-top:8px">Book at ${esc(shop.name)}</h1>
      <p class="muted">${esc(shop.address)}, ${esc(shop.city)} &middot; ${esc(shop.phone)}</p>
      <div class="wizard-steps">
        ${STEPS.map(
          (s, i) =>
            `<span class="${i < state.step ? 'done' : i === state.step ? 'current' : ''}">${i + 1}. ${s}</span>`,
        ).join('')}
      </div>`;
  }

  function nav(nextLabel = 'Continue') {
    return `<div class="wizard-nav">
      ${state.step > 0 ? '<button type="button" class="btn secondary" id="back">Back</button>' : '<span></span>'}
      <button class="btn" id="next">${nextLabel}</button></div>`;
  }

  // ---- step 1: services ----
  function stepServices() {
    return `<form class="card" id="stepForm">
      <h3>What does your car need?</h3>
      <p class="muted small">Pick one or more. Not sure? Choose the closest and describe the problem below.</p>
      <div class="option-list">
        ${shop.services
          .map(
            (s) => `<label class="option ${state.serviceIds.includes(s.id) ? 'selected' : ''}">
              <input type="checkbox" name="svc" value="${s.id}" ${state.serviceIds.includes(s.id) ? 'checked' : ''} />
              <span><b>${esc(s.name)}</b><br><span class="muted small">${esc(s.description ?? '')}</span><br>
              <span class="small">~${s.durationMin} min${s.basePrice ? ` &middot; from ${money(s.basePrice)}` : ''}</span></span>
            </label>`,
          )
          .join('')}
      </div>
      <div class="field" style="margin-top:14px">
        <label for="notes">Describe the problem (optional)</label>
        <textarea id="notes" name="notes" rows="3" placeholder="e.g. Light came on yesterday, car vibrates at idle">${esc(state.notes)}</textarea>
      </div>
      ${nav()}
    </form>`;
  }

  // ---- step 2: slot ----
  function stepSlot() {
    return `<form class="card" id="stepForm">
      <h3>Pick a day and time</h3>
      <div class="date-strip">
        ${days
          .map((d) => {
            const open = shop.workingDays.includes(new Date(`${d}T00:00`).getDay());
            const [wd, num, mon] = fmtDate(d).replace(',', '').split(' ');
            return `<button type="button" class="date-btn ${d === state.date ? 'selected' : ''}" data-date="${d}" ${open ? '' : 'disabled'}>
              ${wd}<b>${num}</b>${mon}</button>`;
          })
          .join('')}
      </div>
      <div id="slots"><p class="muted">Loading slots...</p></div>
      ${nav()}
    </form>`;
  }

  async function loadSlots() {
    const box = root.querySelector('#slots');
    const { slots } = await api(`/public/shops/${shop.id}/slots?date=${state.date}`);
    const free = slots.filter((s) => s.available);
    if (!free.length) {
      box.innerHTML = '<p class="muted">No free slots on this day. Try another date.</p>';
      return;
    }
    box.innerHTML = `<div class="slot-grid">${free
      .map(
        (s) => `<button type="button" class="slot ${s.time === state.time ? 'selected' : ''}" data-time="${s.time}">
          ${s.time}<small>${s.capacity - s.booked} left</small></button>`,
      )
      .join('')}</div>`;
    box.querySelectorAll('.slot').forEach((b) => {
      b.onclick = () => {
        state.time = b.dataset.time;
        box.querySelectorAll('.slot').forEach((x) => x.classList.toggle('selected', x === b));
      };
    });
  }

  // ---- step 3: details ----
  function stepDetails() {
    const c = state.customer;
    const v = state.vehicle;
    const user = session.user;
    return `<form class="card" id="stepForm">
      <h3>Your details</h3>
      ${
        user
          ? `<p class="alert info">Booking as <b>${esc(user.name)}</b> (${esc(user.email)}).</p>`
          : `<p class="muted small">We create your account with this email and password so you can track the booking and approve the estimate.
             Already booked with us before? Use the same email and password. <a href="#/login">Or log in first</a>.</p>
            <div class="form-grid">
              <div class="field"><label>Full name</label><input name="name" required value="${esc(c.name)}" autocomplete="name" /></div>
              <div class="field"><label>Phone</label><input name="phone" value="${esc(c.phone)}" autocomplete="tel" placeholder="03xx-xxxxxxx" /></div>
              <div class="field"><label>Email</label><input name="email" type="email" required value="${esc(c.email)}" autocomplete="email" /></div>
              <div class="field"><label>Password</label><input name="password" type="password" required minlength="6" value="${esc(c.password)}" autocomplete="new-password" /></div>
            </div>`
      }
      <h3 style="margin-top:10px">Vehicle</h3>
      <div class="form-grid">
        <div class="field"><label>Registration number</label><input name="regNo" required value="${esc(v.regNo)}" placeholder="LEA-1234" /></div>
        <div class="field"><label>Make</label><input name="make" required value="${esc(v.make)}" placeholder="Honda" /></div>
        <div class="field"><label>Model</label><input name="model" required value="${esc(v.model)}" placeholder="Civic" /></div>
        <div class="field"><label>Year</label><input name="year" type="number" min="1950" max="${new Date().getFullYear() + 1}" required value="${esc(v.year)}" /></div>
        <div class="field"><label>Colour (optional)</label><input name="color" value="${esc(v.color)}" /></div>
        <div class="field"><label>Mileage km (optional)</label><input name="mileage" type="number" min="0" value="${esc(v.mileage)}" /></div>
      </div>
      ${nav()}
    </form>`;
  }

  // ---- step 4: review ----
  function stepReview() {
    const chosen = shop.services.filter((s) => state.serviceIds.includes(s.id));
    const v = state.vehicle;
    const who = session.user ?? state.customer;
    return `<form class="card" id="stepForm">
      <h3>Review and confirm</h3>
      <dl class="summary">
        <dt>Shop</dt><dd>${esc(shop.name)}, ${esc(shop.city)}</dd>
        <dt>Services</dt><dd>${chosen.map((s) => esc(s.name)).join(', ')}</dd>
        <dt>Notes</dt><dd>${esc(state.notes) || '<span class="muted">None</span>'}</dd>
        <dt>When</dt><dd>${fmtDate(state.date)} at ${state.time}</dd>
        <dt>Vehicle</dt><dd>${esc(v.make)} ${esc(v.model)} ${esc(v.year)} &middot; ${esc(v.regNo.toUpperCase())}</dd>
        <dt>Contact</dt><dd>${esc(who.name)} &middot; ${esc(who.email)}</dd>
      </dl>
      <p class="muted small" style="margin-top:14px">The shop will confirm your booking. You will see the cost estimate in your dashboard before any work starts.</p>
      ${nav('Confirm booking')}
    </form>`;
  }

  function collect(form) {
    const values = formValues(form);
    if (state.step === 0) {
      state.serviceIds = [...form.querySelectorAll('input[name=svc]:checked')].map((i) => Number(i.value));
      state.notes = values.notes.trim();
    } else if (state.step === 2) {
      if (!session.user) {
        state.customer = { name: values.name, email: values.email, phone: values.phone, password: values.password };
      }
      state.vehicle = {
        regNo: values.regNo,
        make: values.make,
        model: values.model,
        year: values.year,
        color: values.color,
        mileage: values.mileage,
      };
    }
  }

  function validate() {
    if (state.step === 0 && !state.serviceIds.length) return 'Pick at least one service';
    if (state.step === 1 && !state.time) return 'Pick a time slot';
    return null;
  }

  async function submit(button) {
    const v = state.vehicle;
    const body = {
      serviceIds: state.serviceIds,
      notes: state.notes || undefined,
      slotDate: state.date,
      slotTime: state.time,
      vehicle: {
        regNo: v.regNo,
        make: v.make,
        model: v.model,
        year: Number(v.year),
        color: v.color || undefined,
        mileage: v.mileage ? Number(v.mileage) : undefined,
      },
    };
    if (!session.user) body.customer = { ...state.customer, phone: state.customer.phone || undefined };

    await busy(button, async () => {
      try {
        const res = await api(`/public/shops/${shop.id}/bookings`, { method: 'POST', body });
        session.save(res);
        window.dispatchEvent(new Event('session-changed'));
        toast('Booking created! The shop will confirm it soon.');
        navigate(`/my/${res.bookingId}`);
      } catch (err) {
        // Slot got taken while the customer was filling the form.
        if (err.status === 409) {
          state.time = null;
          state.step = 1;
          draw();
        }
        throw err;
      }
    });
  }

  function draw() {
    const steps = [stepServices, stepSlot, stepDetails, stepReview];
    root.innerHTML = header() + steps[state.step]();
    const form = root.querySelector('#stepForm');

    form.querySelectorAll('.option input').forEach((i) => {
      i.onchange = () => i.closest('.option').classList.toggle('selected', i.checked);
    });
    form.querySelectorAll('.date-btn').forEach((b) => {
      b.onclick = () => {
        state.date = b.dataset.date;
        state.time = null;
        form.querySelectorAll('.date-btn').forEach((x) => x.classList.toggle('selected', x === b));
        loadSlots();
      };
    });
    if (state.step === 1) loadSlots();

    root.querySelector('#back')?.addEventListener('click', () => {
      collect(form);
      state.step -= 1;
      draw();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      collect(form);
      const problem = validate();
      if (problem) return toast(problem, 'error');
      if (state.step === 3) return submit(root.querySelector('#next'));
      state.step += 1;
      draw();
    });
  }

  draw();
}

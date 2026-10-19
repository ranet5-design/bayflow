import { api, session } from '../api.js';
import { busy, esc, formValues, toast } from '../ui.js';
import { navigate } from '../app.js';

// Shown on the login page only, so judges can try every role quickly.
const DEMO_ACCOUNTS = [
  ['Owner (2 shops)', 'fatima@bayflow.pk'],
  ['Service Advisor', 'bilal@lahoreautocare.pk'],
  ['Technician', 'imran@lahoreautocare.pk'],
  ['QC Inspector', 'sara@lahoreautocare.pk'],
  ['Parts Person', 'usman@lahoreautocare.pk'],
  ['Customer', 'ayesha@mail.com'],
];

function afterLogin(data) {
  session.save(data);
  window.dispatchEvent(new Event('session-changed'));
  navigate(data.memberships.length || data.user.isOwner ? '/pos' : '/my');
}

export function renderLogin(root) {
  root.innerHTML = `
    <div class="auth-box">
      <form class="card" id="loginForm">
        <h2>Log in</h2>
        <p class="muted small">Customers use the email and password from their booking. Shop staff use the account their owner created.</p>
        <div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email" /></div>
        <div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password" /></div>
        <button class="btn" style="width:100%">Log in</button>
        <p class="small muted" style="margin-bottom:0">Own a workshop? <a href="#/register">Create an owner account</a></p>
      </form>
      <div class="card">
        <h3>Demo accounts</h3>
        <p class="muted small">Password for all: <code>Demo@1234</code>. Click one to fill the form.</p>
        <table class="demo-table">
          ${DEMO_ACCOUNTS.map(
            ([role, email]) =>
              `<tr><td>${role}</td><td><a href="#" data-email="${esc(email)}">${esc(email)}</a></td></tr>`,
          ).join('')}
        </table>
      </div>
    </div>`;

  const form = root.querySelector('#loginForm');
  root.querySelectorAll('[data-email]').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      form.elements.email.value = a.dataset.email;
      form.elements.password.value = 'Demo@1234';
    };
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(form.querySelector('button'), async () => {
      const data = await api('/auth/login', { method: 'POST', body: formValues(form) });
      toast(`Welcome back, ${data.user.name.split(' ')[0]}`);
      afterLogin(data);
    });
  });
}

export function renderRegister(root) {
  root.innerHTML = `
    <div class="auth-box">
      <form class="card" id="regForm">
        <h2>Register your workshop</h2>
        <p class="muted small">Create an owner account. After that you can add your shop(s), team, services and inventory.</p>
        <div class="field"><label>Your name</label><input name="name" required minlength="2" /></div>
        <div class="field"><label>Email</label><input name="email" type="email" required /></div>
        <div class="field"><label>Phone</label><input name="phone" /></div>
        <div class="field"><label>Password</label><input name="password" type="password" required minlength="6" /></div>
        <button class="btn" style="width:100%">Create owner account</button>
      </form>
    </div>`;

  const form = root.querySelector('#regForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = formValues(form);
    if (!body.phone) delete body.phone;
    busy(form.querySelector('button'), async () => {
      const data = await api('/auth/register-owner', { method: 'POST', body });
      session.save(data);
      window.dispatchEvent(new Event('session-changed'));
      toast('Account created. Now add your first shop.');
      navigate('/pos/new-shop');
    });
  });
}

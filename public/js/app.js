import { api, session } from './api.js';
import { esc, timeAgo } from './ui.js';
import { renderLanding } from './pages/landing.js';
import { renderBooking } from './pages/booking.js';
import { renderLogin, renderRegister } from './pages/auth.js';
import { renderMyBookings, renderMyBooking } from './pages/customer.js';
import { renderPos, renderNewShop } from './pages/pos.js';

const routes = [
  [/^\/?$/, renderLanding],
  [/^\/shops\/(\d+)$/, renderBooking],
  [/^\/login$/, renderLogin],
  [/^\/register$/, renderRegister],
  [/^\/my$/, renderMyBookings],
  [/^\/my\/(\d+)$/, renderMyBooking],
  [/^\/pos\/new-shop$/, renderNewShop],
  [/^\/pos(?:\/(\d+))?(?:\/(\w+))?$/, renderPos],
];

const app = document.getElementById('app');

export function navigate(path) {
  if (location.hash === `#${path}`) router();
  else location.hash = path;
}

export function currentQuery() {
  const q = location.hash.split('?')[1] ?? '';
  return Object.fromEntries(new URLSearchParams(q));
}

async function router() {
  const path = (location.hash.slice(1) || '/').split('?')[0];
  renderNav(path);
  for (const [pattern, render] of routes) {
    const match = path.match(pattern);
    if (match) {
      app.innerHTML = '<p class="muted">Loading...</p>';
      try {
        await render(app, match.slice(1));
      } catch (err) {
        app.innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
      }
      window.scrollTo(0, 0);
      return;
    }
  }
  app.innerHTML = '<div class="empty"><h2>Page not found</h2><a href="#/">Back to shops</a></div>';
}

// ---------- nav + notifications ----------

function renderNav(path) {
  const nav = document.getElementById('nav');
  const user = session.user;
  const link = (href, text) =>
    `<a href="#${href}" class="${path === href || (href !== '/' && path.startsWith(href)) ? 'active' : ''}">${text}</a>`;

  if (!user) {
    nav.innerHTML = `${link('/', 'Find a shop')}${link('/login', 'Log in')}${link('/register', 'For shop owners')}`;
    return;
  }

  nav.innerHTML = `
    ${link('/', 'Find a shop')}
    ${link('/my', 'My bookings')}
    ${session.isStaff || user.isOwner ? link('/pos', 'Shop POS') : ''}
    <div class="bell">
      <button class="linkish" id="bellBtn" aria-label="Notifications">&#128276; <span class="bell-count" id="bellCount" hidden></span></button>
      <div class="bell-panel" id="bellPanel" hidden></div>
    </div>
    <button class="linkish" id="logoutBtn">Log out</button>`;

  document.getElementById('logoutBtn').onclick = () => {
    session.clear();
    window.dispatchEvent(new Event('session-changed'));
    navigate('/');
  };
  document.getElementById('bellBtn').onclick = toggleBell;
  refreshBell();
}

let bellData = { unread: 0, items: [] };

async function refreshBell() {
  if (!session.user) return;
  try {
    bellData = await api('/notifications');
  } catch {
    return;
  }
  const count = document.getElementById('bellCount');
  if (!count) return;
  count.hidden = bellData.unread === 0;
  count.textContent = bellData.unread > 9 ? '9+' : bellData.unread;
}

function toggleBell() {
  const panel = document.getElementById('bellPanel');
  panel.hidden = !panel.hidden;
  if (panel.hidden) return;

  panel.innerHTML = `
    <header><span>Notifications</span><button class="btn small secondary" id="readAll">Mark all read</button></header>
    ${
      bellData.items.length
        ? bellData.items
            .map(
              (n) => `<button class="bell-item ${n.isRead ? '' : 'unread'}" data-id="${n.id}"
                 data-booking="${n.bookingId ?? ''}" data-shop="${n.shopId ?? ''}">
                 ${esc(n.message)}<small>${esc(n.shopName ?? '')} &middot; ${timeAgo(n.createdAt)}</small></button>`,
            )
            .join('')
        : '<p class="empty">Nothing yet</p>'
    }`;

  panel.querySelector('#readAll').onclick = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    panel.hidden = true;
    refreshBell();
  };

  panel.querySelectorAll('.bell-item').forEach((btn) => {
    btn.onclick = async () => {
      panel.hidden = true;
      await api(`/notifications/${btn.dataset.id}/read`, { method: 'POST' }).catch(() => {});
      refreshBell();
      const { booking, shop } = btn.dataset;
      if (!booking) return;
      const staffHere = session.memberships.some((m) => String(m.shopId) === shop);
      navigate(staffHere ? `/pos/${shop}/bookings?open=${booking}` : `/my/${booking}`);
    };
  });
}

document.addEventListener('click', (e) => {
  const panel = document.getElementById('bellPanel');
  if (panel && !panel.hidden && !e.target.closest('.bell')) panel.hidden = true;
});

window.addEventListener('hashchange', router);
window.addEventListener('session-changed', () => renderNav((location.hash.slice(1) || '/').split('?')[0]));
window.addEventListener('data-changed', refreshBell);
setInterval(refreshBell, 20000);

// Keep memberships fresh (an owner may have been added to a new shop).
session.load();
if (session.data?.token) {
  api('/auth/me')
    .then((me) => {
      session.save(me);
      renderNav((location.hash.slice(1) || '/').split('?')[0]);
    })
    .catch(() => {});
}
router();

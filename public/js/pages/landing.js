import { api } from '../api.js';
import { esc } from '../ui.js';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function daysText(days) {
  if (days.length === 7) return 'Open every day';
  if (days.join() === '1,2,3,4,5,6') return 'Mon - Sat';
  if (days.join() === '1,2,3,4,5') return 'Mon - Fri';
  return days.map((d) => DAY[d]).join(', ');
}

function shopCard(shop) {
  const services = shop.services.slice(0, 5);
  const more = shop.services.length - services.length;
  return `
    <article class="card shop-card">
      <div class="row spread">
        <h3>${esc(shop.name)}</h3>
        <span class="stars" title="Rating (placeholder)">&#9733; ${shop.rating ? shop.rating.toFixed(1) : 'New'}</span>
      </div>
      <div class="muted small">${esc(shop.address)}, ${esc(shop.city)}</div>
      <p class="small">${esc(shop.description ?? '')}</p>
      <div class="tags">
        ${services.map((s) => `<span class="badge">${esc(s.name)}</span>`).join('')}
        ${more > 0 ? `<span class="badge">+${more} more</span>` : ''}
      </div>
      <div class="footer">
        <span class="muted small">${daysText(shop.workingDays)}, ${shop.openTime} - ${shop.closeTime}</span>
        <a class="btn" href="#/shops/${shop.id}">Book now</a>
      </div>
    </article>`;
}

export async function renderLanding(root) {
  root.innerHTML = `
    <section class="hero">
      <h1>Car trouble? Book a trusted garage in minutes.</h1>
      <p>Compare local repair shops, pick a time that suits you and follow your car from inspection to pick-up. No more calling to ask "is my car ready?".</p>
      <form class="search-bar" id="searchForm">
        <input name="q" placeholder="Search by shop or service, e.g. brakes" aria-label="Search" />
        <select name="city" aria-label="City"><option value="">All cities</option></select>
        <button class="btn">Search</button>
      </form>
      <div class="steps-strip">
        <span><b>1</b>Choose a shop</span>
        <span><b>2</b>Tell us the problem</span>
        <span><b>3</b>Pick a slot</span>
        <span><b>4</b>Approve the estimate online</span>
      </div>
    </section>
    <div class="row spread" style="margin-bottom:12px">
      <h2 style="margin:0">Workshops</h2>
      <span class="muted small" id="count"></span>
    </div>
    <div class="grid grid-3" id="shopList"></div>`;

  const form = root.querySelector('#searchForm');
  const list = root.querySelector('#shopList');
  const citySelect = form.elements.city;

  async function load() {
    const params = new URLSearchParams();
    if (form.elements.q.value.trim()) params.set('q', form.elements.q.value.trim());
    if (citySelect.value) params.set('city', citySelect.value);

    const { shops, cities } = await api(`/public/shops?${params}`);
    if (citySelect.options.length === 1) {
      citySelect.insertAdjacentHTML('beforeend', cities.map((c) => `<option>${esc(c)}</option>`).join(''));
    }
    root.querySelector('#count').textContent = `${shops.length} shop${shops.length === 1 ? '' : 's'}`;
    list.innerHTML = shops.length
      ? shops.map(shopCard).join('')
      : '<div class="empty card">No shops match your search.</div>';
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    load();
  });
  citySelect.addEventListener('change', load);
  await load();
}

// Shop times are stored as local wall-clock values (YYYY-MM-DD / HH:MM).
// TZ is set through the environment so "today" matches the shop's city.

const pad = (n) => String(n).padStart(2, '0');

export function todayString(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function nowTimeString(now = new Date()) {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(total) {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return todayString(new Date(y, m - 1, d + days));
}

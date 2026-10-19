import { dayOfWeek, fromMinutes, nowTimeString, todayString, toMinutes } from '../utils/time.js';

export function workingDays(shop) {
  return shop.working_days.split(',').map(Number);
}

/**
 * All slots for a shop on a date with how many are already taken.
 * Past dates and already-passed times today return nothing.
 */
export function getSlots(db, shop, date) {
  const today = todayString();
  if (date < today) return [];
  if (!workingDays(shop).includes(dayOfWeek(date))) return [];

  const taken = new Map(
    db
      .prepare(
        `SELECT slot_time, COUNT(*) AS n FROM bookings
         WHERE shop_id = ? AND slot_date = ? AND status != 'CANCELLED'
         GROUP BY slot_time`,
      )
      .all(shop.id, date)
      .map((r) => [r.slot_time, r.n]),
  );

  const slots = [];
  const close = toMinutes(shop.close_time);
  const cutoff = date === today ? toMinutes(nowTimeString()) : -1;

  for (let t = toMinutes(shop.open_time); t + shop.slot_minutes <= close; t += shop.slot_minutes) {
    if (t <= cutoff) continue;
    const time = fromMinutes(t);
    const booked = taken.get(time) ?? 0;
    slots.push({ time, booked, capacity: shop.slot_capacity, available: booked < shop.slot_capacity });
  }
  return slots;
}

import { openDatabase } from '../server/db/connection.js';
import { seed, DEMO_PASSWORD } from '../server/db/seed.js';
import { createApp } from '../server/app.js';
import { addDays, dayOfWeek, todayString } from '../server/utils/time.js';

/** Fresh in-memory database + server on a random port for each test file. */
export async function startTestServer() {
  const db = openDatabase(':memory:');
  await seed(db);
  const server = createApp(db).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function request(method, path, { token, body } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  async function login(email) {
    const res = await request('POST', '/auth/login', { body: { email, password: DEMO_PASSWORD } });
    if (res.status !== 200) throw new Error(`login failed for ${email}`);
    return res.body;
  }

  return { db, request, login, close: () => server.close() };
}

// Mon-Sat are working days for all seeded shops.
export function nextWorkingDate(offset = 1) {
  let date = addDays(todayString(), offset);
  while (dayOfWeek(date) === 0) date = addDays(date, 1);
  return date;
}

export const vehicle = { regNo: 'LEA-1234', make: 'Honda', model: 'Civic', year: 2016 };

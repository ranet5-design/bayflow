// Small wrapper around fetch + the logged in session.

const KEY = 'bayflow.session';

export const session = {
  data: null,

  load() {
    try {
      this.data = JSON.parse(localStorage.getItem(KEY)) || null;
    } catch {
      this.data = null;
    }
    return this.data;
  },

  save({ token, user, memberships }) {
    this.data = { token: token ?? this.data?.token, user, memberships };
    localStorage.setItem(KEY, JSON.stringify(this.data));
  },

  clear() {
    this.data = null;
    localStorage.removeItem(KEY);
  },

  get user() {
    return this.data?.user ?? null;
  },

  get memberships() {
    return this.data?.memberships ?? [];
  },

  get isStaff() {
    return this.memberships.length > 0;
  },
};

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session.data?.token) headers.Authorization = `Bearer ${session.data.token}`;

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection.', 0);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && session.data?.token && !path.startsWith('/auth/login')) {
      session.clear();
      window.dispatchEvent(new Event('session-changed'));
    }
    throw new ApiError(
      data.error?.message || `Request failed (${res.status})`,
      res.status,
      data.error?.details,
    );
  }
  return data;
}

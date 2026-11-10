/**
 * FuelFlow ERP - API client
 */
const Api = {
  // SECTION: base path of the backend API; same origin so the session cookie is sent automatically
  BASE: '/api',

  // SECTION: core request — JSON in/out, CSRF header, normalized errors; redirects to login on 401
  async request(method, path, body) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'fuelflow', Accept: 'application/json' },
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(this.BASE + path, opts);
    } catch {
      throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and that the backend is running.');
    }

    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const err = data?.error || {};
      // SECTION: session expired — send the user back to sign in (except on the login call itself)
      if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/me')) {
        window.location.href = 'index.html';
      }
      throw new ApiError(res.status, err.code || 'ERROR', err.message || `Request failed (${res.status})`, err.details);
    }
    return data;
  },

  get(path, params) {
    const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
    return this.request('GET', path + (qs === '?' ? '' : qs));
  },
  post(path, body = {}) { return this.request('POST', path, body); },
  put(path, body = {}) { return this.request('PUT', path, body); },
  patch(path, body = {}) { return this.request('PATCH', path, body); },
  del(path) { return this.request('DELETE', path); },
};

// SECTION: error type carrying HTTP status, server error code, and field-level details
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  // Joins field validation messages for display in a toast
  get fullMessage() {
    if (Array.isArray(this.details) && this.details.length) {
      return this.details.map((d) => d.message).join('. ');
    }
    return this.message;
  }
}

window.Api = Api;
window.ApiError = ApiError;

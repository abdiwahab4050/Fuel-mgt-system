/**
 * Date-range helpers. Day boundaries use the process time zone, which
 * env.js sets from APP_TIMEZONE so "today" means the station's local day.
 */
import { badRequest } from './errors.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function parseDay(str, field) {
  if (!DAY_RE.test(str)) throw badRequest(`${field} must be YYYY-MM-DD`);
  const [y, m, d] = str.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getMonth() !== m - 1) throw badRequest(`${field} is not a valid date`);
  return date;
}

export function toDayString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// SECTION: resolves ?from&to into a [start, end) range; defaults to the last 30 days
export function resolveRange(query, { maxDays = 366 } = {}) {
  const today = startOfDay();
  const start = query.from ? parseDay(String(query.from), 'from') : addDays(today, -29);
  const endInclusive = query.to ? parseDay(String(query.to), 'to') : today;
  if (endInclusive < start) throw badRequest('"to" must be on or after "from"');
  const end = addDays(endInclusive, 1);
  const days = Math.round((end - start) / 86400000);
  if (days > maxDays) throw badRequest(`Date range cannot exceed ${maxDays} days`);
  return { start, end, days, from: toDayString(start), to: toDayString(endInclusive) };
}

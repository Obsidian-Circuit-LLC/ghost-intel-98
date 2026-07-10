/**
 * Date Calc engine — pure date arithmetic, no DOM/state.
 *
 * Dates are taken as `YYYY-MM-DD` strings (inputs, never sampled from
 * `Date.now()`) and converted to a UTC epoch-day count so day-difference and
 * day-addition math is immune to DST shifts and local-timezone offsets.
 */

const MS_PER_DAY = 86_400_000;

/** Parse a `YYYY-MM-DD` string to a UTC epoch-day integer. */
function toEpochDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** Format a UTC epoch-day integer back to `YYYY-MM-DD`. */
function fromEpochDay(day: number): string {
  const ms = day * MS_PER_DAY;
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Absolute number of days between two `YYYY-MM-DD` dates (order-independent). */
export function daysBetween(a: string, b: string): number {
  return Math.abs(toEpochDay(a) - toEpochDay(b));
}

/** Add `n` days (may be negative) to a `YYYY-MM-DD` date, returning `YYYY-MM-DD`. */
export function addDays(date: string, n: number): string {
  return fromEpochDay(toEpochDay(date) + n);
}

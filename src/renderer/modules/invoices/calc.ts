/** Pure invoice arithmetic. Deterministic — no Date/random. Hours derive from a line's HH:MM range;
 *  a non-positive or unparseable range yields 0 (a work session never crosses midnight — out of scope). */
import type { InvoiceLine } from '@shared/invoice-types';

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function hoursBetween(start: string, end: string): number {
  const a = toMinutes(start); const b = toMinutes(end);
  if (a === null || b === null) return 0;
  const diff = b - a;
  return diff > 0 ? diff / 60 : 0;
}

export function computeTotals(lines: InvoiceLine[], rate: number, taxPct?: number): { totalHours: number; subtotal: number; tax: number; total: number } {
  const totalHours = lines.reduce((s, l) => s + hoursBetween(l.start, l.end), 0);
  const subtotal = totalHours * (Number.isFinite(rate) ? rate : 0);
  const tax = taxPct ? subtotal * (taxPct / 100) : 0;
  return { totalHours, subtotal, tax, total: subtotal + tax };
}

// Node/V8's Intl.NumberFormat does NOT throw for a well-formed-but-unrecognized 3-letter currency
// code (e.g. 'ZZZ') — it silently prints the raw code as a literal prefix instead of a symbol. So a
// try/catch alone can't detect "unknown currency"; cross-check against the supported-values list.
const KNOWN_CURRENCIES = typeof Intl.supportedValuesOf === 'function'
  ? new Set(Intl.supportedValuesOf('currency'))
  : null;

export function formatMoney(amount: number, currency: string): string {
  if (KNOWN_CURRENCIES && !KNOWN_CURRENCIES.has(currency)) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return amount.toFixed(2); // malformed ISO 4217 code (wrong length etc.)
  }
}

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

/** Round to 2 decimals (cents / hundredths of an hour). +EPSILON avoids 1.005 → 1.00 float wobble. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Canonical hours for a line — rounded to 2dp so what's shown, the per-line amount, and the subtotal
 *  all derive from ONE value (they foot; no unrounded 0.3333333333 leaks into the invoice). */
export const lineHours = (line: { start: string; end: string }): number => round2(hoursBetween(line.start, line.end));

export function computeTotals(lines: InvoiceLine[], rate: number, taxPct?: number): { totalHours: number; subtotal: number; tax: number; total: number } {
  const r = Number.isFinite(rate) ? rate : 0;
  let totalHours = 0;
  let subtotal = 0;
  for (const l of lines) {
    const h = lineHours(l);
    totalHours = round2(totalHours + h);
    subtotal = round2(subtotal + round2(h * r)); // sum of rounded line amounts → foots to displayed lines
  }
  const tax = taxPct ? round2(subtotal * (taxPct / 100)) : 0;
  return { totalHours, subtotal, tax, total: round2(subtotal + tax) };
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

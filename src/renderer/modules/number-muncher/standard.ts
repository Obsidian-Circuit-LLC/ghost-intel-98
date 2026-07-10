/**
 * Standard calculator — a pure, deterministic finite state machine.
 *
 * No DOM, no React, no `Date.now()` / `Math.random()`. Every function takes a
 * state and returns a new state; the shell (NumberMuncherModule) owns the
 * reducer wiring, memory, and history. Chaining is left-to-right (7 - 2 * 3 =
 * 15), matching a physical four-function calculator, not operator precedence.
 */

export type Op = '+' | '-' | '*' | '/';

export interface CalcState {
  display: string;
  acc: number | null;
  op: Op | null;
  fresh: boolean;
  error: boolean;
}

export const INIT: CalcState = { display: '0', acc: null, op: null, fresh: true, error: false };

/** Format a result, snapping tiny float dust away and reporting non-finite as an error string. */
const fmt = (n: number): string => {
  if (!Number.isFinite(n)) return 'Error';
  const r = Math.round(n * 1e12) / 1e12;
  return String(r);
};

export function inputDigit(s: CalcState, d: string): CalcState {
  if (s.error) return s;
  if (s.fresh || s.display === '0') return { ...s, display: d, fresh: false };
  return { ...s, display: s.display + d };
}

export function inputDot(s: CalcState): CalcState {
  if (s.error) return s;
  if (s.fresh) return { ...s, display: '0.', fresh: false };
  return s.display.includes('.') ? s : { ...s, display: s.display + '.' };
}

function apply(a: number, op: Op, b: number): number {
  return op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b;
}

export function setOp(s: CalcState, op: Op): CalcState {
  if (s.error) return s;
  const cur = Number(s.display);
  if (s.acc !== null && s.op && !s.fresh) {
    const r = apply(s.acc, s.op, cur);
    return { ...s, acc: r, op, display: fmt(r), fresh: true };
  }
  return { ...s, acc: cur, op, fresh: true };
}

export function equals(s: CalcState): CalcState {
  if (s.error || s.acc === null || !s.op) return s;
  const r = apply(s.acc, s.op, Number(s.display));
  if (!Number.isFinite(r)) return { ...s, display: 'Error', error: true };
  return { ...s, display: fmt(r), acc: null, op: null, fresh: true };
}

export function unary(s: CalcState, kind: 'sqrt' | 'square' | 'inv' | 'neg' | 'pct'): CalcState {
  if (s.error) return s;
  const x = Number(s.display);
  const r =
    kind === 'sqrt' ? Math.sqrt(x) : kind === 'square' ? x * x : kind === 'inv' ? 1 / x : kind === 'neg' ? -x : x / 100;
  if (!Number.isFinite(r)) return { ...s, display: 'Error', error: true };
  return { ...s, display: fmt(r), fresh: true };
}

export function clearEntry(s: CalcState): CalcState {
  return { ...s, display: '0', fresh: true, error: false };
}

/** Full reset. Accepts (and ignores) a prior state so it can be dispatched uniformly. */
export function clearAll(_s?: CalcState): CalcState {
  return { ...INIT };
}

export function backspace(s: CalcState): CalcState {
  if (s.error || s.fresh) return s;
  const d = s.display.length > 1 ? s.display.slice(0, -1) : '0';
  return { ...s, display: d === '' || d === '-' ? '0' : d };
}

import { describe, it, expect } from 'vitest';
import { hoursBetween, computeTotals, formatMoney } from '../src/renderer/modules/invoices/calc';

describe('hoursBetween', () => {
  it('12:00 to 15:30 is 3.5 hours', () => { expect(hoursBetween('12:00', '15:30')).toBe(3.5); });
  it('minute precision (09:15 to 10:00 = 0.75)', () => { expect(hoursBetween('09:15', '10:00')).toBe(0.75); });
  it('equal or reversed range is 0 (no overnight)', () => {
    expect(hoursBetween('10:00', '10:00')).toBe(0);
    expect(hoursBetween('15:00', '09:00')).toBe(0);
  });
  it('garbage input is 0', () => { expect(hoursBetween('', 'x')).toBe(0); });
});

describe('computeTotals', () => {
  const lines = [
    { id: '1', date: '2026-07-01', start: '12:00', end: '15:30', description: 'a' }, // 3.5h
    { id: '2', date: '2026-07-02', start: '09:00', end: '11:00', description: 'b' }, // 2h
  ];
  it('subtotal = total hours * rate, no tax when taxPct absent', () => {
    const t = computeTotals(lines, 20);
    expect(t.totalHours).toBe(5.5); expect(t.subtotal).toBe(110); expect(t.tax).toBe(0); expect(t.total).toBe(110);
  });
  it('applies tax when taxPct present', () => {
    const t = computeTotals(lines, 20, 10);
    expect(t.tax).toBeCloseTo(11, 6); expect(t.total).toBeCloseTo(121, 6);
  });
  it('empty lines → zeros', () => { expect(computeTotals([], 20, 10)).toEqual({ totalHours: 0, subtotal: 0, tax: 0, total: 0 }); });
});

describe('formatMoney', () => {
  it('formats a known currency', () => { expect(formatMoney(110, 'USD')).toMatch(/110/); });
  it('unknown currency falls back to fixed-2 (never throws)', () => { expect(formatMoney(110, 'ZZZ')).toBe('110.00'); });
});

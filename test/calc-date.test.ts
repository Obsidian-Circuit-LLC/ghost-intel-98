import { describe, it, expect } from 'vitest';
import { daysBetween, addDays } from '../src/renderer/modules/number-muncher/date-calc';
describe('date calc', () => {
  it('daysBetween is inclusive-exclusive + order-independent', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-01-31', '2026-01-01')).toBe(30);
  });
  it('addDays crosses months/years + leap day', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29'); // 2024 leap
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

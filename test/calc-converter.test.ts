import { describe, it, expect } from 'vitest';
import { convert, CATEGORIES } from '../src/renderer/modules/number-muncher/converter';
describe('converter', () => {
  it('length: 1 km = 1000 m; 1 mile ≈ 1609.34 m', () => {
    expect(convert(1, 'km', 'm', 'length')).toBeCloseTo(1000, 6);
    expect(convert(1, 'mi', 'm', 'length')).toBeCloseTo(1609.344, 3);
  });
  it('data: 1 GB = 1024 MB', () => { expect(convert(1, 'GB', 'MB', 'data')).toBeCloseTo(1024, 6); });
  it('lists categories with units', () => { expect(Object.keys(CATEGORIES)).toContain('length'); });
});

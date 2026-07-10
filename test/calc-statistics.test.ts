import { describe, it, expect } from 'vitest';
import { stats } from '../src/renderer/modules/number-muncher/statistics';
describe('statistics', () => {
  it('mean/median/sum/count over a dataset', () => {
    const s = stats([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.mean).toBeCloseTo(5, 6); expect(s.median).toBeCloseTo(4.5, 6); expect(s.sum).toBe(40); expect(s.count).toBe(8);
    expect(s.stdevPop).toBeCloseTo(2, 6); expect(s.stdevSample).toBeCloseTo(2.1381, 3);
  });
  it('empty dataset → zeros/NaN-safe', () => { const s = stats([]); expect(s.count).toBe(0); expect(s.sum).toBe(0); });
});

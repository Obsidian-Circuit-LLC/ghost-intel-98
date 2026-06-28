import { describe, it, expect } from 'vitest';
import { parseCsv, toCsv } from '../src/shared/searchlight/ml/csv';

describe('parseCsv / toCsv', () => {
  it('round-trips header + rows deterministically', () => {
    const csv = 'a,b,label\n1,2,0\n3,4,1\n';
    const p = parseCsv(csv);
    expect(p.header).toEqual(['a', 'b', 'label']);
    expect(p.rows[1]).toEqual({ a: '3', b: '4', label: '1' });
    expect(toCsv(['a', 'b', 'label'], [{ a: 1, b: 2, label: 0 }, { a: 3, b: 4, label: 1 }])).toBe(csv);
  });
  it('throws on a field containing a comma', () => {
    expect(() => toCsv(['x'], [{ x: 'a,b' }])).toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import { getPath } from '../src/main/geoint/feeds';

describe('getPath', () => {
  it('walks nested object keys', () => {
    expect(getPath({ a: { b: { c: 5 } } }, 'a.b.c')).toBe(5);
  });
  it('reads @_-prefixed attribute keys', () => {
    expect(getPath({ pt: { '@_lat': '17' } }, 'pt.@_lat')).toBe('17');
  });
  it('indexes into [0] when a node is an array (fast-xml-parser repeats)', () => {
    expect(getPath({ items: [{ v: 1 }, { v: 2 }] }, 'items.v')).toBe(1);
  });
  it('returns undefined for a missing link', () => {
    expect(getPath({ a: {} }, 'a.b.c')).toBeUndefined();
  });
  it('rejects prototype-polluting segments', () => {
    expect(getPath({}, '__proto__.x')).toBeUndefined();
    expect(getPath({ a: {} }, 'a.constructor')).toBeUndefined();
    expect(getPath({ a: {} }, 'a.prototype')).toBeUndefined();
  });
});

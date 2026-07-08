import { describe, it, expect } from 'vitest';
import { ensureIdArray } from '../src/main/security/validate';

// ensureIdArray guards the media:reorderStations IPC boundary — untrusted renderer input reaching the
// unsandboxed main thread. It must reject anything that isn't a short-string array.
describe('ensureIdArray', () => {
  it('accepts an array of short strings and returns it', () => {
    expect(ensureIdArray(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(ensureIdArray([])).toEqual([]);
  });
  it('rejects a non-array', () => {
    expect(() => ensureIdArray('a')).toThrow();
    expect(() => ensureIdArray({ 0: 'a' })).toThrow();
    expect(() => ensureIdArray(null)).toThrow();
    expect(() => ensureIdArray(undefined)).toThrow();
  });
  it('rejects a non-string element', () => {
    expect(() => ensureIdArray(['ok', 42])).toThrow();
    expect(() => ensureIdArray(['ok', { id: 'x' }])).toThrow();
  });
  it('rejects an over-long id (>128 chars)', () => {
    expect(() => ensureIdArray(['a'.repeat(129)])).toThrow();
    expect(ensureIdArray(['a'.repeat(128)])).toHaveLength(1);
  });
});

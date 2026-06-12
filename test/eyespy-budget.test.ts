// test/eyespy-budget.test.ts
import { describe, it, expect } from 'vitest';
import { admit, MAX_LIVE } from '../src/renderer/modules/eyespy/useLivePlayerBudget';

describe('admit (live-player budget core)', () => {
  it('never exceeds the cap, taking most-recently-visible first', () => {
    const order = Array.from({ length: 20 }, (_, i) => `c${i}`);
    const live = admit(order, MAX_LIVE);
    expect(live.length).toBe(MAX_LIVE);
    expect(live[0]).toBe('c0');
    expect(live).not.toContain('c9');
  });
  it('dedupes and preserves first-seen order', () => {
    expect(admit(['a', 'b', 'a', 'c'], 9)).toEqual(['a', 'b', 'c']);
  });
  it('fewer visible than cap → all live', () => {
    expect(admit(['a', 'b'], 9)).toEqual(['a', 'b']);
  });
});

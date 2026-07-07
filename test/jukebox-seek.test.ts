import { describe, it, expect } from 'vitest';
import { clampSeek } from '../src/renderer/modules/media/seek';

describe('clampSeek', () => {
  it('advances within range', () => expect(clampSeek(30, 10, 100)).toBe(40));
  it('clamps at 0', () => expect(clampSeek(5, -10, 100)).toBe(0));
  it('clamps at duration', () => expect(clampSeek(95, 10, 100)).toBe(100));
  it('handles NaN duration safely', () => expect(clampSeek(10, 10, NaN)).toBe(10));
  it('handles 0 duration', () => expect(clampSeek(0, 10, 0)).toBe(0));
});

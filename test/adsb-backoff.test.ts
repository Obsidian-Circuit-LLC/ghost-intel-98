import { describe, it, expect } from 'vitest';
import { backoffDelaysMs, classifyAdsbError, AdsbError } from '../src/shared/livefeeds/adsbBackoff';

describe('backoffDelaysMs', () => {
  it('returns the fixed [500, 1500, 4000] ascending array', () => {
    const delays = backoffDelaysMs();
    expect(delays).toEqual([500, 1500, 4000]);
  });

  it('returns a new array each call (immutable source)', () => {
    const a = backoffDelaysMs();
    const b = backoffDelaysMs();
    expect(a).not.toBe(b);
    a[0] = 999;
    expect(backoffDelaysMs()[0]).toBe(500);
  });

  it('is strictly ascending', () => {
    const d = backoffDelaysMs();
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
  });
});

describe('classifyAdsbError', () => {
  it('maps 429 → rate-limited', () => {
    expect(classifyAdsbError(429)).toBe('rate-limited');
  });

  it('maps 503 → unavailable', () => {
    expect(classifyAdsbError(503)).toBe('unavailable');
  });

  it('maps any non-429 4xx/5xx → unavailable', () => {
    expect(classifyAdsbError(500)).toBe('unavailable');
    expect(classifyAdsbError(404)).toBe('unavailable');
    expect(classifyAdsbError(403)).toBe('unavailable');
  });
});

describe('AdsbError', () => {
  it('is an Error with kind and status fields', () => {
    const e = new AdsbError('rate-limited', 429);
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('rate-limited');
    expect(e.status).toBe(429);
    expect(e.message).toMatch(/429/);
  });

  it('unavailable variant', () => {
    const e = new AdsbError('unavailable', 503);
    expect(e.kind).toBe('unavailable');
    expect(e.status).toBe(503);
  });
});

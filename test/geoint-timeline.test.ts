import { describe, it, expect } from 'vitest';
import type { GeoItem } from '@shared/post-mvp-types';
import { timeBounds, itemsUpTo } from '../src/renderer/modules/geoint/timeline';

// Factory for GeoItems with an optional published date.
function geo(id: string, published?: string): GeoItem {
  return { id, sourceId: 's', title: `item ${id}`, located: 'gazetteer', lat: 1, lon: 1, published };
}

const T = (iso: string) => Date.parse(iso);

describe('timeBounds', () => {
  it('returns min/max over dated items', () => {
    const items = [geo('a', '2026-01-01T00:00:00Z'), geo('b', '2026-03-01T00:00:00Z'), geo('c', '2026-02-01T00:00:00Z')];
    expect(timeBounds(items)).toEqual({ min: T('2026-01-01T00:00:00Z'), max: T('2026-03-01T00:00:00Z') });
  });

  it('ignores undated items when computing bounds', () => {
    const items = [geo('a', '2026-01-01T00:00:00Z'), geo('b'), geo('c', '2026-02-01T00:00:00Z')];
    expect(timeBounds(items)).toEqual({ min: T('2026-01-01T00:00:00Z'), max: T('2026-02-01T00:00:00Z') });
  });

  it('returns null when all items are undated', () => {
    expect(timeBounds([geo('a'), geo('b')])).toBeNull();
  });

  it('returns null for an empty set', () => {
    expect(timeBounds([])).toBeNull();
  });

  it('treats unparseable published strings as undated', () => {
    expect(timeBounds([geo('a', 'not-a-date')])).toBeNull();
  });

  // CRITICAL regression guard. The old implementation did Math.min(...ts)/Math.max(...ts);
  // spreading an item-sized array (130k+ cached events) as call args overflows the engine call
  // stack (RangeError: Maximum call stack size exceeded) and white-screened the whole GeoINT
  // module on load. timeBounds must compute min/max in a single pass, no call-spread. Deterministic
  // generated array: published steps by 1 minute from a fixed epoch, so {min,max} are exact.
  it('does not throw and returns correct min/max on a 150,000-item array', () => {
    const N = 150_000;
    const BASE = T('2020-01-01T00:00:00Z');
    const STEP = 60_000; // 1 min/item
    const items: GeoItem[] = new Array(N);
    for (let i = 0; i < N; i++) items[i] = geo(`i${i}`, new Date(BASE + i * STEP).toISOString());
    let bounds: { min: number; max: number } | null = null;
    expect(() => { bounds = timeBounds(items); }).not.toThrow();
    expect(bounds).toEqual({ min: BASE, max: BASE + (N - 1) * STEP });
  });
});

describe('itemsUpTo', () => {
  const a = geo('a', '2026-01-01T00:00:00Z');
  const b = geo('b', '2026-02-01T00:00:00Z');
  const c = geo('c', '2026-03-01T00:00:00Z');
  const u = geo('u'); // undated

  it('includes dated items at or before t', () => {
    const out = itemsUpTo([a, b, c], T('2026-02-01T00:00:00Z')).map((i) => i.id);
    expect(out).toEqual(['a', 'b']);
  });

  it('excludes dated items strictly after t', () => {
    const out = itemsUpTo([a, b, c], T('2026-01-15T00:00:00Z')).map((i) => i.id);
    expect(out).toEqual(['a']);
  });

  it('always includes undated items regardless of t', () => {
    const out = itemsUpTo([a, b, c, u], T('2026-01-01T00:00:00Z')).map((i) => i.id);
    expect(out).toEqual(['a', 'u']);
  });

  it('treats unparseable published strings as undated (always included)', () => {
    const bad = geo('x', 'not-a-date');
    const out = itemsUpTo([a, bad], T('2025-01-01T00:00:00Z')).map((i) => i.id);
    expect(out).toEqual(['x']);
  });
});

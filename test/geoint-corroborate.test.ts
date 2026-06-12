import { describe, it, expect } from 'vitest';
import type { GeoItem } from '@shared/post-mvp-types';
import { corroborate } from '../src/renderer/modules/geoint/corroborate';

// Small factory for located GeoItems. `published` is optional so undated items can be tested.
function geo(
  id: string,
  sourceId: string,
  lat: number | undefined,
  lon: number | undefined,
  published?: string
): GeoItem {
  return {
    id,
    sourceId,
    title: `item ${id}`,
    located: 'gazetteer',
    lat,
    lon,
    published
  };
}

const T0 = '2026-06-12T12:00:00Z';

describe('geoint corroborate (cross-source same place+time confidence)', () => {
  it('two items at the SAME place+time from DIFFERENT sources → each maps to count 1', () => {
    const items = [geo('a', 's1', 40, -74, T0), geo('b', 's2', 40, -74, T0)];
    const out = corroborate(items);
    expect(out.get('a')).toBe(1);
    expect(out.get('b')).toBe(1);
  });

  it('two items same place+time from the SAME source → count 0 (distinct sources only)', () => {
    const items = [geo('a', 's1', 40, -74, T0), geo('b', 's1', 40, -74, T0)];
    const out = corroborate(items);
    expect(out.get('a')).toBe(0);
    expect(out.get('b')).toBe(0);
  });

  it('three independent sources around one point → the center item counts 2 others', () => {
    // All effectively co-located (well within 25km) and within the window.
    const items = [
      geo('a', 's1', 40.0, -74.0, T0),
      geo('b', 's2', 40.01, -74.0, T0),
      geo('c', 's3', 40.0, -74.01, T0)
    ];
    const out = corroborate(items);
    expect(out.get('a')).toBe(2);
    expect(out.get('b')).toBe(2);
    expect(out.get('c')).toBe(2);
  });

  it('a corroborator OUTSIDE the radius (≈100km vs default 25km) → 0', () => {
    // ~1° latitude ≈ 111km; 0.9° ≈ 100km, well outside the 25km default.
    const items = [geo('a', 's1', 40.0, -74.0, T0), geo('b', 's2', 40.9, -74.0, T0)];
    const out = corroborate(items);
    expect(out.get('a')).toBe(0);
    expect(out.get('b')).toBe(0);
  });

  it('a corroborator OUTSIDE the time window (5 days vs default 48h) → 0', () => {
    const items = [
      geo('a', 's1', 40, -74, '2026-06-12T12:00:00Z'),
      geo('b', 's2', 40, -74, '2026-06-17T12:00:00Z')
    ];
    const out = corroborate(items);
    expect(out.get('a')).toBe(0);
    expect(out.get('b')).toBe(0);
  });

  it('an UNDATED item with a nearby different-source item → counts (not time-gated)', () => {
    // 'a' is undated; proximity alone qualifies regardless of b's far-future timestamp.
    const items = [
      geo('a', 's1', 40, -74, undefined),
      geo('b', 's2', 40, -74, '2030-01-01T00:00:00Z')
    ];
    const out = corroborate(items);
    expect(out.get('a')).toBe(1);
    // b IS dated, a is undated → ta=null so the pair is not time-gated; b also counts a.
    expect(out.get('b')).toBe(1);
  });

  it('haversine sanity: a corroborator ~111km away is outside 25km but inside 200km', () => {
    const items = [geo('a', 's1', 40.0, -74.0, T0), geo('b', 's2', 41.0, -74.0, T0)];
    expect(corroborate(items, { radiusKm: 25 }).get('a')).toBe(0);
    expect(corroborate(items, { radiusKm: 200 }).get('a')).toBe(1);
  });

  it('unlocated items (no lat/lon) are ignored entirely', () => {
    const items = [
      geo('a', 's1', 40, -74, T0),
      geo('u', 's2', undefined, undefined, T0) // unlocated different-source item
    ];
    const out = corroborate(items);
    // unlocated item is not in the output map
    expect(out.has('u')).toBe(false);
    // and it does not corroborate the located item
    expect(out.get('a')).toBe(0);
  });
});

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

  // --- Brute-force reference: the original O(n^2) semantics, inlined so the bucketed
  //     implementation can be proven result-identical. ---
  function haversineKmRef(aLat: number, aLon: number, bLat: number, bLon: number): number {
    const R = 6371, d = Math.PI / 180;
    const dLat = (bLat - aLat) * d, dLon = (bLon - aLon) * d;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(aLat * d) * Math.cos(bLat * d) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function corroborateBrute(
    items: GeoItem[],
    opts: { radiusKm?: number; windowHours?: number } = {}
  ): Map<string, number> {
    const R = opts.radiusKm ?? 25, W = (opts.windowHours ?? 48) * 3600_000;
    const located = items.filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon));
    const t = (i: GeoItem): number | null => {
      const p = i.published ? Date.parse(i.published) : NaN;
      return Number.isNaN(p) ? null : p;
    };
    const out = new Map<string, number>();
    for (const a of located) {
      const srcs = new Set<string>();
      for (const b of located) {
        if (b.id === a.id || b.sourceId === a.sourceId) continue;
        if (haversineKmRef(a.lat!, a.lon!, b.lat!, b.lon!) > R) continue;
        const ta = t(a), tb = t(b);
        if (ta != null && tb != null && Math.abs(ta - tb) > W) continue;
        srcs.add(b.sourceId);
      }
      out.set(a.id, srcs.size);
    }
    return out;
  }

  it('EQUIVALENCE: bucketed result equals brute-force reference on ~300 seeded random items', () => {
    // Deterministic LCG (Numerical Recipes constants) — NO Math.random.
    let seed = 0x1234_5678;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000; // [0,1)
    };
    const baseT = Date.parse(T0);
    const items: GeoItem[] = [];
    for (let i = 0; i < 300; i++) {
      // Spread across a few clusters so some pairs fall inside the radius and some outside.
      const clusterLat = 40 + Math.floor(rnd() * 5) * 0.4; // up to ~44, cluster spacing ~44km
      const clusterLon = -74 + Math.floor(rnd() * 5) * 0.4;
      const lat = clusterLat + (rnd() - 0.5) * 0.3; // jitter within/around radius
      const lon = clusterLon + (rnd() - 0.5) * 0.3;
      // ~1 in 6 undated; others scattered across +/- a few days.
      const dated = rnd() > 0.16;
      const published = dated
        ? new Date(baseT + Math.floor((rnd() - 0.5) * 6 * 24 * 3600_000)).toISOString()
        : undefined;
      items.push(geo(`i${i}`, `s${i % 12}`, lat, lon, published));
    }
    const fast = corroborate(items);
    const ref = corroborateBrute(items);
    expect(fast.size).toBe(ref.size);
    for (const [id, v] of ref) {
      expect(fast.get(id)).toBe(v);
    }
  });

  it('NaN coordinates are excluded and do NOT inflate neighbors’ counts', () => {
    const items = [
      geo('a', 's1', 40, -74, T0),
      geo('b', 's2', 40, -74, T0),
      geo('nan', 's3', NaN, -74, T0), // NaN lat — must be excluded
      geo('inf', 's4', 40, Infinity, T0) // Infinity lon — must be excluded
    ];
    const out = corroborate(items);
    // Bad-coordinate items are not in the output map at all.
    expect(out.has('nan')).toBe(false);
    expect(out.has('inf')).toBe(false);
    // 'a' and 'b' corroborate each other (1 each) — NOT inflated by the bogus items.
    expect(out.get('a')).toBe(1);
    expect(out.get('b')).toBe(1);
  });

  it('PERF: 4000 CO-LOCATED distinct-source items return well under 200ms (source cap bounds it)', () => {
    const items: GeoItem[] = [];
    for (let i = 0; i < 4000; i++) {
      items.push(geo(`c${i}`, `src${i}`, 40, -74, T0)); // all identical location+time, distinct sources
    }
    const start = performance.now();
    const out = corroborate(items);
    const ms = performance.now() - start;
    expect(out.size).toBe(4000);
    // Every item is capped (the cap is < the number of distinct neighbors), so all equal counts.
    const cap = out.get('c0')!;
    expect(cap).toBeGreaterThan(0);
    for (const v of out.values()) expect(v).toBe(cap);
    expect(ms).toBeLessThan(200);
  });

  it('PERF: 4000 DISPERSED items return well under 200ms (spatial bucketing keeps it near-linear)', () => {
    const items: GeoItem[] = [];
    // Spread across a wide grid so most cells hold a handful of items.
    for (let i = 0; i < 4000; i++) {
      const lat = -60 + (i % 120) * 1.0;
      const lon = -180 + Math.floor(i / 120) * 5.0;
      items.push(geo(`d${i}`, `src${i % 50}`, lat, lon, T0));
    }
    const start = performance.now();
    const out = corroborate(items);
    const ms = performance.now() - start;
    expect(out.size).toBe(4000);
    expect(ms).toBeLessThan(200);
  });
});

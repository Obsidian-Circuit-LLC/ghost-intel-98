/**
 * Weather tool — store unit tests (Phase 1), in-memory via injected seams (NO electron/secure-fs).
 *
 * Covers: locations CRUD (add/list/remove/reorder) with MAIN-side lat/lon validation, determinism
 * (id + addedAt + cachedAt from injected seams — constraint 5), units round-trip, the per-location
 * last-conditions cache, orphan-cache pruning, and reorder healing (a stale/partial order can never
 * drop a location).
 */
import { describe, it, expect } from 'vitest';
import {
  addLocation,
  getCache,
  getUnits,
  listLocations,
  normalizeStore,
  removeLocation,
  reorderLocations,
  setCache,
  setUnits,
  type WeatherStoreData,
  type WeatherStoreDeps,
} from '../src/main/weather/store';
import type { ForecastBundle } from '../src/shared/weather/types';

/** An in-memory store holder + deterministic id/clock seams. */
function memStore(initial?: Partial<WeatherStoreData>) {
  let data: WeatherStoreData | null = initial
    ? { version: 1, units: 'metric', locations: [], cache: {}, ...initial }
    : null;
  let idN = 0;
  let clockN = 0;
  const deps: WeatherStoreDeps = {
    read: async () => (data ? (JSON.parse(JSON.stringify(data)) as Record<string, unknown>) : null),
    write: async (d) => {
      data = JSON.parse(JSON.stringify(d)) as WeatherStoreData;
    },
    newId: () => `loc-${++idN}`,
    now: () => `2026-08-15T00:00:0${clockN++}Z`,
  };
  return { deps, get: () => data };
}

const BUNDLE: ForecastBundle = {
  current: {
    time: '2026-08-15T12:00',
    temperature: 20,
    apparentTemperature: 19,
    weatherCode: 2,
    windSpeed: 5,
    windDirection: 180,
    relativeHumidity: 50,
    precipitation: 0,
    isDay: 1,
  },
  hourlyToday: [],
  daily: [],
  units: 'metric',
  timezone: 'Europe/Berlin',
};

describe('weather store — locations CRUD + determinism', () => {
  it('adds a validated location with an injected id + addedAt', async () => {
    const { deps } = memStore();
    const list = await addLocation(
      { name: 'Berlin', country: 'Germany', admin1: 'Berlin', latitude: 52.52, longitude: 13.41 },
      deps,
    );
    expect(list).toEqual([
      { id: 'loc-1', name: 'Berlin', country: 'Germany', admin1: 'Berlin', latitude: 52.52, longitude: 13.41, addedAt: '2026-08-15T00:00:00Z' },
    ]);
    expect(await listLocations(deps)).toHaveLength(1);
  });

  it('rejects an out-of-range lat/lon (never persists a bad coordinate)', async () => {
    const { deps, get } = memStore();
    await expect(addLocation({ name: 'x', country: 'y', latitude: 999, longitude: 0 }, deps)).rejects.toThrow(/out-of-range/);
    expect(get()).toBeNull(); // nothing written
  });

  it('removes a location and drops its cache entry', async () => {
    const { deps } = memStore();
    await addLocation({ name: 'A', country: 'C', latitude: 1, longitude: 2 }, deps); // loc-1
    await setCache('loc-1', BUNDLE, deps);
    expect(await getCache('loc-1', deps)).not.toBeNull();
    const list = await removeLocation('loc-1', deps);
    expect(list).toEqual([]);
    expect(await getCache('loc-1', deps)).toBeNull();
  });

  it('reorders by id list, healing a partial order (missing ids appended, unknown ids ignored)', async () => {
    const { deps } = memStore();
    await addLocation({ name: 'A', country: 'C', latitude: 1, longitude: 2 }, deps); // loc-1
    await addLocation({ name: 'B', country: 'C', latitude: 3, longitude: 4 }, deps); // loc-2
    await addLocation({ name: 'D', country: 'C', latitude: 5, longitude: 6 }, deps); // loc-3
    // Only name loc-3 and loc-1 (+ an unknown id): loc-2 must be appended, not dropped.
    const list = await reorderLocations(['loc-3', 'nope', 'loc-1'], deps);
    expect(list.map((l) => l.id)).toEqual(['loc-3', 'loc-1', 'loc-2']);
  });
});

describe('weather store — units + cache', () => {
  it('round-trips the units preference', async () => {
    const { deps } = memStore();
    expect(await getUnits(deps)).toBe('metric'); // default
    expect(await setUnits('imperial', deps)).toBe('imperial');
    expect(await getUnits(deps)).toBe('imperial');
  });

  it('setUnits heals a garbage value to metric', async () => {
    const { deps } = memStore();
    expect(await setUnits('nonsense' as never, deps)).toBe('metric');
  });

  it('caches a forecast with an injected cachedAt, only for a live location', async () => {
    const { deps } = memStore();
    await addLocation({ name: 'A', country: 'C', latitude: 1, longitude: 2 }, deps); // loc-1
    const entry = await setCache('loc-1', BUNDLE, deps);
    expect(entry.cachedAt).toMatch(/^2026-08-15T/);
    expect(await getCache('loc-1', deps)).toEqual(entry);
    // Caching against a NON-existent location is a no-op (returns the entry but persists nothing).
    await setCache('ghost', BUNDLE, deps);
    expect(await getCache('ghost', deps)).toBeNull();
  });
});

describe('normalizeStore — heals a raw/partial/legacy object', () => {
  it('drops invalid locations, dedups ids, prunes orphan cache, defaults units', () => {
    const healed = normalizeStore({
      units: 'imperial',
      locations: [
        { id: 'a', name: 'A', country: 'C', latitude: 1, longitude: 2, addedAt: 't' },
        { id: 'a', name: 'dup', country: 'C', latitude: 1, longitude: 2, addedAt: 't' }, // dup id dropped
        { id: 'b', name: 'B', country: 'C', latitude: 999, longitude: 2, addedAt: 't' }, // bad coord dropped
        { name: 'noid', country: 'C', latitude: 1, longitude: 2 }, // no id dropped
      ],
      cache: {
        a: { bundle: BUNDLE, cachedAt: 't' },
        gone: { bundle: BUNDLE, cachedAt: 't' }, // orphan (no live location) pruned
      },
    });
    expect(healed.units).toBe('imperial');
    expect(healed.locations.map((l) => l.id)).toEqual(['a']);
    expect(Object.keys(healed.cache)).toEqual(['a']);
  });

  it('empty/garbage input → the default empty store', () => {
    expect(normalizeStore(null)).toEqual({ version: 1, units: 'metric', locations: [], cache: {} });
    expect(normalizeStore({ units: 'weird' } as never).units).toBe('metric');
  });
});

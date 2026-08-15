/**
 * Weather tool — persistence (saved locations + units pref + per-location last-conditions cache).
 *
 * OURS (design spec `docs/superpowers/specs/2026-08-15-weather-tool-design.md`). Hardening:
 *  - ENCRYPT-AT-REST (constraint 4): the single global store file (`weather.json` under the data
 *    root) is written/read through **secure-fs** (AES-GCM — ENCX on disk), never the plaintext
 *    json-fs bypass. Same choke-point as every other GI98 sensitive store.
 *  - DETERMINISM (constraint 5): a new location's `id` and `addedAt`, and a cache entry's `cachedAt`,
 *    come from INJECTED seams (`newId` / `now`) so tested paths carry no clock/RNG. The normalizer is
 *    pure.
 *  - Quarantine-clean at module load: no static `electron`/`node:path` import — the production paths +
 *    secure-fs resolve LAZILY inside `defaultDeps()`, mirroring `x-listening/collection-settings.ts`,
 *    so a unit test that injects its own fs seam never evaluates electron.
 *
 * The renderer's numbers are never trusted: `addLocation` validates + clamps lat/lon MAIN-side and
 * coerces the display strings before anything touches the encrypted file.
 */

import type {
  CachedConditions,
  ForecastBundle,
  SavedLocation,
  Units,
} from '@shared/weather/types';

/** The persisted shape. `version` lets a later migration heal an older file. */
export interface WeatherStoreData {
  version: 1;
  units: Units;
  locations: SavedLocation[];
  /** Last-good forecast per saved-location id (for the offline "stale, cached <time>" render). */
  cache: Record<string, CachedConditions>;
}

export const DEFAULT_WEATHER_STORE: WeatherStoreData = {
  version: 1,
  units: 'metric',
  locations: [],
  cache: {},
};

/** Bound a display string so a hostile/oversized geocoder field can't bloat the encrypted store. */
const NAME_MAX = 200;

/** Injectable seams so the orchestration is testable without electron/secure-fs. `read` returns the
 *  RAW persisted object (possibly partial/legacy) or `null` when no file exists. */
export interface WeatherStoreDeps {
  read(): Promise<Record<string, unknown> | null>;
  write(data: WeatherStoreData): Promise<void>;
  /** Injected id generator (determinism). */
  newId(): string;
  /** Injected clock — ISO strings for `addedAt` / `cachedAt` (determinism). */
  now(): string;
}

function isEnoent(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** Production defaults — lazy so importing this module never evaluates electron. Persistence hits the
 *  encrypt-at-rest choke-point (`secureReadFile`/`secureWriteFile`), never plaintext json-fs. */
function defaultDeps(): WeatherStoreDeps {
  const resolvePath = async (): Promise<string> => {
    const paths = await import('../storage/paths');
    return paths.weatherStoreFile();
  };
  return {
    read: async () => {
      const { secureReadFile } = await import('../storage/secure-fs');
      const p = await resolvePath();
      try {
        const buf = await secureReadFile(p);
        return JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
      } catch (e) {
        if (isEnoent(e)) return null;
        throw e;
      }
    },
    write: async (data) => {
      const { secureWriteFile } = await import('../storage/secure-fs');
      const p = await resolvePath();
      await secureWriteFile(p, JSON.stringify(data, null, 2));
    },
    // `globalThis.crypto` (WebCrypto, present in the Electron/Node runtime) keeps this sync + import-free.
    newId: () => globalThis.crypto.randomUUID(),
    now: () => new Date().toISOString(),
  };
}

function coerceStr(v: unknown, max = NAME_MAX): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function validLatLon(lat: unknown, lon: unknown): { latitude: number; longitude: number } | null {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/** Heal one raw location record; returns null if it lacks a usable id or lat/lon. */
function normalizeLocation(raw: unknown): SavedLocation | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = coerceStr(o.id, 128);
  const ll = validLatLon(o.latitude, o.longitude);
  if (!id || !ll) return null;
  const admin1 = typeof o.admin1 === 'string' ? o.admin1.slice(0, NAME_MAX) : undefined;
  return {
    id,
    name: coerceStr(o.name),
    country: coerceStr(o.country),
    ...(admin1 ? { admin1 } : {}),
    latitude: ll.latitude,
    longitude: ll.longitude,
    addedAt: coerceStr(o.addedAt, 64),
  };
}

/** Heal a raw persisted object into a full, valid store record. */
export function normalizeStore(raw: Record<string, unknown> | null | undefined): WeatherStoreData {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WEATHER_STORE, locations: [], cache: {} };
  const units: Units = raw.units === 'imperial' ? 'imperial' : 'metric';
  const rawLocs = Array.isArray(raw.locations) ? raw.locations : [];
  const locations: SavedLocation[] = [];
  const seen = new Set<string>();
  for (const r of rawLocs) {
    const loc = normalizeLocation(r);
    if (loc && !seen.has(loc.id)) {
      seen.add(loc.id);
      locations.push(loc);
    }
  }
  // Keep only cache entries whose key still maps to a live location (drop orphans).
  const cache: Record<string, CachedConditions> = {};
  const rawCache = (raw.cache && typeof raw.cache === 'object' ? raw.cache : {}) as Record<string, unknown>;
  for (const id of seen) {
    const c = rawCache[id];
    if (c && typeof c === 'object') {
      const co = c as Record<string, unknown>;
      if (co.bundle && typeof co.bundle === 'object') {
        cache[id] = { bundle: co.bundle as ForecastBundle, cachedAt: coerceStr(co.cachedAt, 64) };
      }
    }
  }
  return { version: 1, units, locations, cache };
}

async function load(deps: WeatherStoreDeps): Promise<WeatherStoreData> {
  return normalizeStore(await deps.read());
}

// ── Locations CRUD ──────────────────────────────────────────────────────────────
export async function listLocations(overrides: Partial<WeatherStoreDeps> = {}): Promise<SavedLocation[]> {
  const deps: WeatherStoreDeps = { ...defaultDeps(), ...overrides };
  return (await load(deps)).locations;
}

/** Input for a new saved location — the chosen geocoder match (or a manual lat/lon entry). */
export interface AddLocationInput {
  name: string;
  country: string;
  admin1?: string;
  latitude: number;
  longitude: number;
}

/**
 * Validate + save a new location (MAIN-side clamp of lat/lon; display strings bounded). Assigns a
 * fresh `id` + `addedAt` from the injected seams. Throws on an out-of-range lat/lon (never persists a
 * bad coordinate that would later flow into a URL). Returns the fresh location list.
 */
export async function addLocation(
  input: AddLocationInput,
  overrides: Partial<WeatherStoreDeps> = {},
): Promise<SavedLocation[]> {
  const deps: WeatherStoreDeps = { ...defaultDeps(), ...overrides };
  const ll = validLatLon(input.latitude, input.longitude);
  if (!ll) throw new Error('weather: cannot save a location with an out-of-range lat/lon');
  const data = await load(deps);
  const loc: SavedLocation = {
    id: deps.newId(),
    name: coerceStr(input.name),
    country: coerceStr(input.country),
    ...(typeof input.admin1 === 'string' && input.admin1 ? { admin1: input.admin1.slice(0, NAME_MAX) } : {}),
    latitude: ll.latitude,
    longitude: ll.longitude,
    addedAt: deps.now(),
  };
  // Dedup by exact coordinates: re-adding a city already saved is a no-op that keeps the existing
  // entry (Open-Meteo geocoding is deterministic per result, so the same pick yields identical
  // lat/lon). Prevents a duplicate row whose identical coords would confuse selection-by-coordinate.
  const dup = data.locations.find((l) => l.latitude === ll.latitude && l.longitude === ll.longitude);
  if (dup) return data.locations;
  data.locations.push(loc);
  await deps.write(data);
  return data.locations;
}

/** Remove a location by id (and drop its cache entry). Returns the fresh list. */
export async function removeLocation(
  id: string,
  overrides: Partial<WeatherStoreDeps> = {},
): Promise<SavedLocation[]> {
  const deps: WeatherStoreDeps = { ...defaultDeps(), ...overrides };
  const data = await load(deps);
  data.locations = data.locations.filter((l) => l.id !== id);
  delete data.cache[id];
  await deps.write(data);
  return data.locations;
}

/**
 * Reorder saved locations to match `orderedIds`. Unknown ids are ignored; any existing location not
 * named in `orderedIds` is appended in its prior relative order (so a stale/partial order from the
 * renderer can never silently drop a location). Returns the fresh list.
 */
export async function reorderLocations(
  orderedIds: string[],
  overrides: Partial<WeatherStoreDeps> = {},
): Promise<SavedLocation[]> {
  const deps: WeatherStoreDeps = { ...defaultDeps(), ...overrides };
  const data = await load(deps);
  const byId = new Map(data.locations.map((l) => [l.id, l]));
  const next: SavedLocation[] = [];
  const placed = new Set<string>();
  for (const id of orderedIds) {
    const loc = byId.get(id);
    if (loc && !placed.has(id)) {
      next.push(loc);
      placed.add(id);
    }
  }
  for (const loc of data.locations) {
    if (!placed.has(loc.id)) next.push(loc);
  }
  data.locations = next;
  await deps.write(data);
  return data.locations;
}

// ── Units ──────────────────────────────────────────────────────────────────────
export async function getUnits(overrides: Partial<WeatherStoreDeps> = {}): Promise<Units> {
  const deps: WeatherStoreDeps = { ...defaultDeps(), ...overrides };
  return (await load(deps)).units;
}

export async function setUnits(units: Units, overrides: Partial<WeatherStoreDeps> = {}): Promise<Units> {
  const deps: WeatherStoreDeps = { ...defaultDeps(), ...overrides };
  const data = await load(deps);
  data.units = units === 'imperial' ? 'imperial' : 'metric';
  await deps.write(data);
  return data.units;
}

// ── Last-conditions cache ─────────────────────────────────────────────────────────
/** Read a location's cached forecast, or null if none. */
export async function getCache(
  id: string,
  overrides: Partial<WeatherStoreDeps> = {},
): Promise<CachedConditions | null> {
  const deps: WeatherStoreDeps = { ...defaultDeps(), ...overrides };
  return (await load(deps)).cache[id] ?? null;
}

/** Cache a fresh forecast for a location, stamping `cachedAt` from the injected clock. Returns it. */
export async function setCache(
  id: string,
  bundle: ForecastBundle,
  overrides: Partial<WeatherStoreDeps> = {},
): Promise<CachedConditions> {
  const deps: WeatherStoreDeps = { ...defaultDeps(), ...overrides };
  const data = await load(deps);
  // Only cache against a live location (an orphan cache would be dropped on the next normalize anyway).
  const entry: CachedConditions = { bundle, cachedAt: deps.now() };
  if (data.locations.some((l) => l.id === id)) {
    data.cache[id] = entry;
    await deps.write(data);
  }
  return entry;
}

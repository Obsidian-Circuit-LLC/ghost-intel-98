/**
 * Weather tool — IPC registration (`registerWeatherIpc`).
 *
 * OURS (design spec `docs/superpowers/specs/2026-08-15-weather-tool-design.md`). Every handler:
 *  - runs `assertTrustedSender(e)` FIRST (constraint 7) — wired via `safeHandleWithEvent`, the
 *    event-preserving handle, so the sender frame is validated by Electron-delivered data, never a
 *    renderer-spoofable value;
 *  - then arg-shape-validates the renderer payload (string city, numeric lat/lon, unit literal) before
 *    anything touches the client or the encrypted store.
 *
 * Egress (constraint 1) is resolved MAIN-side from `AppSettings.weather` + the live background-Tor
 * SOCKS port (client.ts `resolveWeatherEgress`): Tor-default, fail-closed, acked-clearnet opt-in.
 * The host allowlist (constraint 2) is enforced inside the client — a saved location contributes only
 * a validated numeric lat/lon + a display name, never a URL.
 *
 * Import-graph note: the settings read + Tor singleton + store + client are resolved LAZILY in
 * `prodDeps()` so this module is import-light and the wiring is injectable for tests.
 */

import { channels } from '@shared/ipc-contracts';
import { assertTrustedSender } from '../capture/capture-window';
import { getBgTor } from '../bgconn/tor-singleton';
import {
  geocodeCity,
  fetchForecast,
  resolveWeatherEgress,
  WeatherEgressBlockedError,
  type WeatherClientDeps,
  type WeatherEgressSettings,
} from './client';
import {
  addLocation,
  getCache,
  getUnits,
  listLocations,
  removeLocation,
  reorderLocations,
  setCache,
  setUnits,
  type AddLocationInput,
} from './store';
import type {
  GeocodeMatch,
  SavedLocation,
  Units,
  WeatherEgressState,
  WeatherForecastResult,
} from '@shared/weather/types';

/** The event-preserving handle (register.ts supplies `safeHandleWithEvent`). */
export type WeatherHandle = (
  channel: string,
  fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) => void;

/** The longest city query the geocoder handler will accept (bounds a hostile payload). */
export const WEATHER_QUERY_MAX = 200;

/** Injectable seams so the wiring is testable without electron/secure-fs/Tor. */
export interface WeatherIpcDeps {
  /** Read the egress-affecting weather settings (fail-closed to Tor mode on any error). */
  loadEgressSettings(): Promise<WeatherEgressSettings>;
  /** Live background-Tor SOCKS port, or null when Tor is not bootstrapped. */
  torSocksPort(): number | null;
  /** Injected dial seam forwarded to the client (defaults to the real `socksDial`). */
  dial?: WeatherClientDeps['dial'];
}

/** Production deps — lazy so importing this module never eagerly evaluates electron/settings/Tor. */
function prodDeps(): WeatherIpcDeps {
  return {
    loadEgressSettings: async () => {
      try {
        const { settingsStore } = await import('../storage/json-fs');
        const s = await settingsStore.read();
        const w = s.weather;
        // Fail-closed: any missing field defaults to Tor mode (never a silent clearnet widen).
        return {
          torDefault: w?.torDefault !== false,
          clearnet: w?.clearnet === true,
          clearnetAck: w?.clearnetAck === true,
        };
      } catch {
        return { torDefault: true, clearnet: false, clearnetAck: false };
      }
    },
    torSocksPort: () => {
      try {
        // `tor-singleton` is a tiny holder (type-only import of BgconnTor) — no bgconn runtime graph.
        const tor = getBgTor();
        return tor?.isBootstrapped() ? tor.socksPort() : null;
      } catch {
        return null;
      }
    },
  };
}

/** Build the client deps (settings + live Tor port + dial) for a network op. */
async function buildClientDeps(deps: WeatherIpcDeps): Promise<WeatherClientDeps> {
  const settings = await deps.loadEgressSettings();
  return { settings, torSocksPort: deps.torSocksPort, dial: deps.dial };
}

function validateAddInput(raw: unknown): AddLocationInput {
  if (!raw || typeof raw !== 'object') throw new Error('weather: a location requires name + numeric lat/lon');
  const o = raw as Record<string, unknown>;
  const latitude = Number(o.latitude);
  const longitude = Number(o.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('weather: a location requires a numeric latitude and longitude');
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('weather: lat/lon out of range');
  }
  return {
    name: typeof o.name === 'string' ? o.name.slice(0, WEATHER_QUERY_MAX) : '',
    country: typeof o.country === 'string' ? o.country.slice(0, WEATHER_QUERY_MAX) : '',
    admin1: typeof o.admin1 === 'string' ? o.admin1.slice(0, WEATHER_QUERY_MAX) : undefined,
    latitude,
    longitude,
  };
}

function validateUnits(raw: unknown): Units {
  if (raw !== 'metric' && raw !== 'imperial') throw new Error("weather: units must be 'metric' or 'imperial'");
  return raw;
}

function validateId(raw: unknown, what: string): string {
  if (typeof raw !== 'string' || !raw) throw new Error(`weather: ${what} requires a location id`);
  return raw.slice(0, 128);
}

/**
 * Resolve one saved location's forecast: fetch fresh (Tor-gated) + cache it; on ANY failure serve the
 * last cached bundle stamped stale; if there is no cache, rethrow so the renderer shows the clear
 * reach/blocked message + the clearnet offer (constraint 1).
 */
async function runForecast(id: string, deps: WeatherIpcDeps): Promise<WeatherForecastResult> {
  const locations = await listLocations();
  const loc = locations.find((l) => l.id === id);
  if (!loc) throw new Error('weather: no saved location with that id');
  const units = await getUnits();
  try {
    const bundle = await fetchForecast(loc.latitude, loc.longitude, units, await buildClientDeps(deps));
    const cached = await setCache(id, bundle);
    return { bundle, stale: false, cachedAt: cached.cachedAt };
  } catch (err) {
    const message =
      err instanceof WeatherEgressBlockedError
        ? err.message
        : `Couldn't reach Open-Meteo — ${(err as Error).message ?? 'unknown error'}`;
    const cached = await getCache(id);
    if (cached) return { bundle: cached.bundle, stale: true, cachedAt: cached.cachedAt, error: message };
    throw new Error(message);
  }
}

/** Resolve the egress state surfaced to the TOR/CLEARNET marker. */
async function runEgressState(deps: WeatherIpcDeps): Promise<WeatherEgressState> {
  const settings = await deps.loadEgressSettings();
  const port = deps.torSocksPort();
  const res = resolveWeatherEgress(settings, port);
  const base = {
    torBootstrapped: port != null,
    torDefault: settings.torDefault,
    clearnet: settings.clearnet,
    clearnetAck: settings.clearnetAck,
  };
  if ('blocked' in res) return { mode: 'blocked', reason: res.reason, ...base };
  return { mode: res.mode, ...base };
}

/**
 * Register every weather channel. `handle` MUST be the event-preserving `safeHandleWithEvent` so
 * `assertTrustedSender` reads the Electron-delivered sender frame.
 */
export function registerWeatherIpc(opts: { handle: WeatherHandle; deps?: WeatherIpcDeps }): void {
  const deps = opts.deps ?? prodDeps();
  const { handle } = opts;

  handle(channels.weather.geocode, async (e, queryArg): Promise<GeocodeMatch[]> => {
    assertTrustedSender(e);
    if (typeof queryArg !== 'string') throw new Error('weather: geocode requires a city name string');
    return geocodeCity(queryArg.slice(0, WEATHER_QUERY_MAX), await buildClientDeps(deps));
  });

  handle(channels.weather.locationsList, (e): Promise<SavedLocation[]> => {
    assertTrustedSender(e);
    return listLocations();
  });

  handle(channels.weather.locationsAdd, (e, inputArg): Promise<SavedLocation[]> => {
    assertTrustedSender(e);
    return addLocation(validateAddInput(inputArg));
  });

  handle(channels.weather.locationsRemove, (e, idArg): Promise<SavedLocation[]> => {
    assertTrustedSender(e);
    return removeLocation(validateId(idArg, 'remove'));
  });

  handle(channels.weather.locationsReorder, (e, idsArg): Promise<SavedLocation[]> => {
    assertTrustedSender(e);
    if (!Array.isArray(idsArg) || !idsArg.every((x) => typeof x === 'string')) {
      throw new Error('weather: reorder requires an array of location ids');
    }
    return reorderLocations(idsArg as string[]);
  });

  handle(channels.weather.forecast, (e, reqArg): Promise<WeatherForecastResult> => {
    assertTrustedSender(e);
    const req = reqArg as { id?: unknown } | undefined;
    return runForecast(validateId(req?.id, 'forecast'), deps);
  });

  handle(channels.weather.unitsGet, (e): Promise<Units> => {
    assertTrustedSender(e);
    return getUnits();
  });

  handle(channels.weather.unitsSet, (e, unitsArg): Promise<Units> => {
    assertTrustedSender(e);
    return setUnits(validateUnits(unitsArg));
  });

  handle(channels.weather.egressState, (e): Promise<WeatherEgressState> => {
    assertTrustedSender(e);
    return runEgressState(deps);
  });
}

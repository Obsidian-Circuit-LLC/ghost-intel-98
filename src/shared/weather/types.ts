/**
 * Weather tool — shared types + the static WMO weather-code → { label, glyph } table.
 *
 * OURS (not a port): a native Win98-retro GI98 utility (design spec
 * `docs/superpowers/specs/2026-08-15-weather-tool-design.md`). This module is import-graph clean
 * (no electron / no node) so BOTH the main-side client/store/ipc and the renderer module can share
 * one source of truth for the domain shapes, the units enum, and the code→condition mapping.
 *
 * Determinism (constraint 5): the WMO mapping is a STATIC table — never a clock/RNG/locale lookup —
 * so a given code always resolves to the same label + retro glyph, in tests and at runtime alike.
 */

/** The unit system for a forecast. 'metric' = °C / km·h⁻¹ / mm; 'imperial' = °F / mph / inch.
 *  Persisted (encrypt-at-rest) and threaded into every Open-Meteo request's unit params. */
export type Units = 'metric' | 'imperial';

/**
 * A user-saved location. Contributes ONLY a validated numeric `latitude`/`longitude` and a display
 * name to a request — NEVER a raw URL or host (constraint 2: the client host-anchors every URL).
 * `admin1` (state/region) is display-only context from the geocoder; it is not required by the spec
 * shape and heals to `undefined`.
 */
export interface SavedLocation {
  /** Opaque store-assigned id (injected-seam generated, never a clock — constraint 5). */
  id: string;
  /** Display name (city). */
  name: string;
  /** Country name from the geocoder (display context). */
  country: string;
  /** Optional admin1 (state/province/region) display context. */
  admin1?: string;
  /** Validated latitude in [-90, 90]. */
  latitude: number;
  /** Validated longitude in [-180, 180]. */
  longitude: number;
  /** ISO timestamp the location was added (injected clock in tested paths — constraint 5). */
  addedAt: string;
}

/** One geocoder match presented to the user before they pick one to save. Same host-anchoring
 *  discipline: only numeric lat/lon + display strings cross the boundary. */
export interface GeocodeMatch {
  /** Geocoder result id (Open-Meteo numeric id, stringified) — for React keys only, not persisted. */
  geoId: string;
  name: string;
  country: string;
  admin1?: string;
  latitude: number;
  longitude: number;
}

/** Current conditions, normalized from Open-Meteo `current`. Units follow the request's `Units`. */
export interface CurrentConditions {
  /** ISO local time of the observation (timezone=auto), from the response — not a local clock. */
  time: string;
  temperature: number;
  apparentTemperature: number;
  /** WMO weather code 0–99; resolve via `lookupWeatherCode`. */
  weatherCode: number;
  windSpeed: number;
  windDirection: number;
  relativeHumidity: number;
  precipitation: number;
  /** 1 = day, 0 = night (drives the day/night glyph variant). */
  isDay: number;
}

/** One hourly datapoint (today's strip). */
export interface HourlyPoint {
  /** ISO local time (timezone=auto). */
  time: string;
  temperature: number;
  weatherCode: number;
  /** Precipitation probability %, 0–100 (may be absent from the response → 0). */
  precipitationProbability: number;
  precipitation: number;
  isDay: number;
}

/** One daily datapoint (7-day row). */
export interface DailyPoint {
  /** ISO local date (YYYY-MM-DD). */
  date: string;
  weatherCode: number;
  temperatureMax: number;
  temperatureMin: number;
  precipitationSum: number;
  /** Max precipitation probability % across the day, 0–100 (may be absent → 0). */
  precipitationProbabilityMax: number;
  sunrise: string;
  sunset: string;
}

/** A normalized forecast: current + today's hourly strip + a 7-day daily row, plus the units the
 *  numbers are in and the resolved IANA timezone. `fetchedAt` is stamped by the STORE/IPC (injected
 *  clock), never by the pure normalizer — so the normalizer stays deterministic (constraint 5). */
export interface ForecastBundle {
  current: CurrentConditions;
  hourlyToday: HourlyPoint[];
  daily: DailyPoint[];
  units: Units;
  timezone: string;
}

/** A cached forecast for a saved location + when it was cached (for the "stale, cached <time>"
 *  banner on an offline/failed re-fetch). */
export interface CachedConditions {
  bundle: ForecastBundle;
  cachedAt: string;
}

/** The result of a forecast request: a fresh bundle, or the last cached bundle stamped stale. */
export interface WeatherForecastResult {
  bundle: ForecastBundle;
  stale: boolean;
  cachedAt?: string;
  /** Present when the live fetch failed but a cached bundle was served (the reach/blocked message). */
  error?: string;
}

/** The resolved egress posture surfaced to the renderer's TOR/CLEARNET marker. */
export interface WeatherEgressState {
  /** 'tor' = routed over background Tor; 'clearnet' = direct (real IP), acked; 'blocked' = Tor-default
   *  but Tor not bootstrapped (fail-closed — no silent clearnet). */
  mode: 'tor' | 'clearnet' | 'blocked';
  torBootstrapped: boolean;
  torDefault: boolean;
  clearnet: boolean;
  clearnetAck: boolean;
  /** Present only when `mode === 'blocked'`. */
  reason?: string;
}

/** A retro-styled condition descriptor: a plain-language label + a single static glyph. */
export interface WeatherCodeInfo {
  label: string;
  /** A retro text glyph (Unicode weather symbol) — deterministic, no colour, no external asset. */
  glyph: string;
}

/**
 * WMO code 4501 present-weather table (0–99), collapsed to the codes Open-Meteo actually emits.
 * Static + total: every emitted code has an entry; `lookupWeatherCode` heals anything unmapped to a
 * neutral "Unknown" descriptor so a surprise code can never crash a render.
 */
export const WMO_WEATHER_CODES: Readonly<Record<number, WeatherCodeInfo>> = Object.freeze({
  0: { label: 'Clear sky', glyph: '☀' },
  1: { label: 'Mainly clear', glyph: '🌤' },
  2: { label: 'Partly cloudy', glyph: '⛅' },
  3: { label: 'Overcast', glyph: '☁' },
  45: { label: 'Fog', glyph: '🌫' },
  48: { label: 'Rime fog', glyph: '🌫' },
  51: { label: 'Light drizzle', glyph: '🌦' },
  53: { label: 'Drizzle', glyph: '🌦' },
  55: { label: 'Dense drizzle', glyph: '🌧' },
  56: { label: 'Light freezing drizzle', glyph: '🌧' },
  57: { label: 'Freezing drizzle', glyph: '🌧' },
  61: { label: 'Light rain', glyph: '🌦' },
  63: { label: 'Rain', glyph: '🌧' },
  65: { label: 'Heavy rain', glyph: '🌧' },
  66: { label: 'Light freezing rain', glyph: '🌧' },
  67: { label: 'Freezing rain', glyph: '🌧' },
  71: { label: 'Light snow', glyph: '🌨' },
  73: { label: 'Snow', glyph: '🌨' },
  75: { label: 'Heavy snow', glyph: '❄' },
  77: { label: 'Snow grains', glyph: '🌨' },
  80: { label: 'Light rain showers', glyph: '🌦' },
  81: { label: 'Rain showers', glyph: '🌧' },
  82: { label: 'Violent rain showers', glyph: '⛈' },
  85: { label: 'Light snow showers', glyph: '🌨' },
  86: { label: 'Snow showers', glyph: '🌨' },
  95: { label: 'Thunderstorm', glyph: '⛈' },
  96: { label: 'Thunderstorm with light hail', glyph: '⛈' },
  99: { label: 'Thunderstorm with hail', glyph: '⛈' },
});

/** A neutral descriptor for any code not in the table (defence — never thrown). */
export const UNKNOWN_WEATHER: WeatherCodeInfo = Object.freeze({ label: 'Unknown', glyph: '·' });

/**
 * Resolve a WMO code to its label + retro glyph. Total and deterministic: an out-of-range or
 * non-integer code heals to `UNKNOWN_WEATHER` rather than throwing.
 */
export function lookupWeatherCode(code: number): WeatherCodeInfo {
  if (!Number.isInteger(code)) return UNKNOWN_WEATHER;
  return WMO_WEATHER_CODES[code] ?? UNKNOWN_WEATHER;
}

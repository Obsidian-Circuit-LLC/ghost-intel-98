/**
 * Weather tool — Open-Meteo client (Tor-gated, host-anchored) + pure URL builders and normalizers.
 *
 * OURS (design spec `docs/superpowers/specs/2026-08-15-weather-tool-design.md`). Hardening invariants:
 *
 *  - EGRESS (constraint 1): every GET runs Tor-default over the background Tor SOCKS (reusing
 *    searchlight's `socksDial`), mirroring `resolveXTorGate`. Clearnet is taken ONLY when
 *    `clearnet && clearnetAck`; Tor-default with Tor NOT bootstrapped FAILS CLOSED
 *    (`WeatherEgressBlockedError`) — never a silent clearnet fallback.
 *  - HOST ALLOWLIST / SSRF (constraint 2): every request URL is BUILT here, host-anchored to
 *    `geocoding-api.open-meteo.com` / `api.open-meteo.com` only, from a display name + validated
 *    NUMERIC lat/lon — never a caller-supplied URL/host. `assertAllowedHost` rejects anything else
 *    before a single byte is dialled.
 *  - DETERMINISM (constraint 5): the URL builders and the response normalizers are PURE and network-
 *    free — separately testable. "Today" for the hourly strip is derived from the response's own
 *    `current.time` date, not a wall clock.
 *
 * Import-graph note: `socksDial` is the ONLY main-only import; the builders/normalizers/gate are pure
 * and reused by tests without electron.
 */

import { request as httpsRequest } from 'node:https';
import { socksDial } from '../searchlight/tor-socks';
import { safeFetch } from '../net/safe-fetch';
import type {
  CurrentConditions,
  DailyPoint,
  ForecastBundle,
  GeocodeMatch,
  HourlyPoint,
  Units,
} from '@shared/weather/types';

// ── Host allowlist (SSRF guard, constraint 2) ──────────────────────────────────
/** The ONLY two hosts a weather request may target. Neither is ever derived from caller input. */
export const WEATHER_HOSTS = {
  geocode: 'geocoding-api.open-meteo.com',
  forecast: 'api.open-meteo.com',
} as const;

const ALLOWED_HOSTS: ReadonlySet<string> = new Set(Object.values(WEATHER_HOSTS));

/**
 * Assert a URL targets an Open-Meteo host over HTTPS and return the parsed `URL`. Throws (before any
 * dial) on a foreign host, a non-HTTPS scheme, or an unparseable string — the last line of the
 * SSRF defence even though the builders below already host-anchor every URL they produce.
 */
export function assertAllowedHost(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('weather: malformed URL rejected');
  }
  if (u.protocol !== 'https:') throw new Error(`weather: non-HTTPS URL rejected (${u.protocol})`);
  if (!ALLOWED_HOSTS.has(u.hostname)) throw new Error(`weather: host not allowed: ${u.hostname}`);
  return u;
}

// ── Numeric guards (constraint 7 — never trust a raw lat/lon into a URL) ────────
/** Validate a lat/lon pair; throws on non-finite or out-of-range. Returned as finite numbers. */
export function assertLatLon(latitude: number, longitude: number): { latitude: number; longitude: number } {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('weather: lat/lon out of range');
  }
  return { latitude: lat, longitude: lon };
}

// ── Pure URL builders ──────────────────────────────────────────────────────────
/** Build the geocoder search URL, host-anchored to `geocoding-api.open-meteo.com`. */
export function buildGeocodeUrl(name: string, count = 10): string {
  const u = new URL('/v1/search', `https://${WEATHER_HOSTS.geocode}`);
  u.searchParams.set('name', name);
  u.searchParams.set('count', String(count));
  u.searchParams.set('language', 'en');
  u.searchParams.set('format', 'json');
  return u.toString();
}

/** The Open-Meteo unit-parameter triplet for a `Units` selection. */
export function forecastUnitParams(units: Units): {
  temperature_unit: string;
  wind_speed_unit: string;
  precipitation_unit: string;
} {
  return units === 'imperial'
    ? { temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch' }
    : { temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm' };
}

/** The `current` field list requested from Open-Meteo. */
export const FORECAST_CURRENT_FIELDS =
  'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m';
/** The `hourly` field list (today's strip). */
export const FORECAST_HOURLY_FIELDS = 'temperature_2m,weather_code,precipitation_probability,precipitation,is_day';
/** The `daily` field list (7-day row). */
export const FORECAST_DAILY_FIELDS =
  'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset';

/**
 * Build the forecast URL, host-anchored to `api.open-meteo.com`, from a VALIDATED numeric lat/lon and
 * a units selection. `timezone=auto` so the response's times are local to the location (which is what
 * makes the deterministic "today" slice in `normalizeForecast` correct). `forecast_days=7`.
 */
export function buildForecastUrl(latitude: number, longitude: number, units: Units): string {
  const { latitude: lat, longitude: lon } = assertLatLon(latitude, longitude);
  const u = new URL('/v1/forecast', `https://${WEATHER_HOSTS.forecast}`);
  u.searchParams.set('latitude', String(lat));
  u.searchParams.set('longitude', String(lon));
  u.searchParams.set('current', FORECAST_CURRENT_FIELDS);
  u.searchParams.set('hourly', FORECAST_HOURLY_FIELDS);
  u.searchParams.set('daily', FORECAST_DAILY_FIELDS);
  u.searchParams.set('timezone', 'auto');
  u.searchParams.set('forecast_days', '7');
  const units_ = forecastUnitParams(units);
  u.searchParams.set('temperature_unit', units_.temperature_unit);
  u.searchParams.set('wind_speed_unit', units_.wind_speed_unit);
  u.searchParams.set('precipitation_unit', units_.precipitation_unit);
  return u.toString();
}

// ── Egress gate (constraint 1) ──────────────────────────────────────────────────
/** The egress-affecting slice of `AppSettings.weather`. */
export interface WeatherEgressSettings {
  torDefault: boolean;
  clearnet: boolean;
  clearnetAck: boolean;
}

export type WeatherGate = { mode: 'tor'; socksPort: number } | { mode: 'clearnet' };
export type WeatherEgressResolution = WeatherGate | { blocked: true; reason: string };

/** Thrown when Tor-default egress is required but background Tor is not bootstrapped (fail-closed). */
export class WeatherEgressBlockedError extends Error {
  code = 'TOR_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'WeatherEgressBlockedError';
  }
}

export const TOR_NOT_READY_REASON =
  'Tor is not ready — the weather fetch is blocked (no clearnet fallback). Enable clearnet in ' +
  "Settings to fetch over your real IP, or wait for Tor to finish connecting.";

/**
 * Resolve the egress posture, mirroring `resolveXTorGate`:
 *   - `clearnet && clearnetAck` → clearnet (the operator's real IP, already acknowledged upstream);
 *   - otherwise Tor mode: needs a live SOCKS port. `torSocksPort == null` (Tor not bootstrapped) ⇒
 *     `{ blocked }` — FAIL CLOSED, never a silent clearnet fallback.
 * `torDefault` is the persisted default-posture flag surfaced by the marker; the ENFORCED decision to
 * leave Tor is `clearnet && clearnetAck` (constraint 1's exact wording), so an un-acked clearnet flag
 * can never route over the real IP.
 */
export function resolveWeatherEgress(
  settings: WeatherEgressSettings,
  torSocksPort: number | null,
): WeatherEgressResolution {
  if (settings.clearnet === true && settings.clearnetAck === true) return { mode: 'clearnet' };
  if (torSocksPort == null) return { blocked: true, reason: TOR_NOT_READY_REASON };
  return { mode: 'tor', socksPort: torSocksPort };
}

// ── Transport ────────────────────────────────────────────────────────────────
/** A minimal HTTP response the JSON layer consumes. */
export interface WeatherHttpResponse {
  status: number;
  body: string;
}

const BODY_CAP = 1_048_576; // 1 MiB — a forecast JSON is a few KB; this bounds a hostile body.
const TIMEOUT_MS = 20_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GhostIntel98-Weather';

/** GET over a Tor SOCKS tunnel: dial :443, then HTTPS over that socket (Node layers TLS). */
async function torGet(u: URL, socksPort: number, dial: typeof socksDial): Promise<WeatherHttpResponse> {
  const socket = await dial(u.hostname, 443, socksPort);
  return await new Promise<WeatherHttpResponse>((resolve, reject) => {
    const req = httpsRequest(
      {
        method: 'GET',
        hostname: u.hostname,
        servername: u.hostname,
        path: u.pathname + u.search,
        createConnection: () => socket as never,
        timeout: TIMEOUT_MS,
        headers: { 'User-Agent': UA, Accept: 'application/json', Connection: 'close' },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size <= BODY_CAP) chunks.push(c);
          else res.destroy();
        });
        res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8', 0, BODY_CAP) }));
        res.on('error', (e) => reject(e));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      socket.destroy();
      reject(new Error('weather: Tor request timed out'));
    });
    req.on('error', (e) => {
      socket.destroy();
      reject(e);
    });
    req.end();
  });
}

/** GET over clearnet via the shared SSRF-guarded fetch (redirects re-validated each hop). */
async function clearnetGet(u: URL): Promise<WeatherHttpResponse> {
  const res = await safeFetch(u.href, 2, { 'User-Agent': UA, Accept: 'application/json' });
  const body = (await res.text()).slice(0, BODY_CAP);
  return { status: res.status, body };
}

function defaultTransport(dial: typeof socksDial): (url: string, gate: WeatherGate) => Promise<WeatherHttpResponse> {
  return (url, gate) => {
    const u = assertAllowedHost(url); // belt-and-braces: re-anchor at the transport boundary too
    return gate.mode === 'tor' ? torGet(u, gate.socksPort, dial) : clearnetGet(u);
  };
}

// ── Client deps + JSON fetch ───────────────────────────────────────────────────
export interface WeatherClientDeps {
  settings: WeatherEgressSettings;
  /** Live SOCKS port, or null when background Tor is not bootstrapped. */
  torSocksPort: () => number | null;
  dial?: typeof socksDial;
  /** Low-level transport seam — injected in tests to avoid the network and assert the chosen gate.
   *  Receives an ALREADY host-allowlisted URL + the resolved gate. */
  transport?: (url: string, gate: WeatherGate) => Promise<WeatherHttpResponse>;
}

async function getJson(url: string, deps: WeatherClientDeps): Promise<unknown> {
  assertAllowedHost(url);
  const res = resolveWeatherEgress(deps.settings, deps.torSocksPort());
  if ('blocked' in res) throw new WeatherEgressBlockedError(res.reason);
  const transport = deps.transport ?? defaultTransport(deps.dial ?? socksDial);
  const r = await transport(url, res);
  if (r.status < 200 || r.status >= 300) throw new Error(`weather: Open-Meteo HTTP ${r.status}`);
  try {
    return JSON.parse(r.body) as unknown;
  } catch {
    throw new Error('weather: Open-Meteo returned a non-JSON body');
  }
}

// ── Pure normalizers ────────────────────────────────────────────────────────────
function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function numAt(arr: unknown, i: number, fallback = 0): number {
  return Array.isArray(arr) ? num(arr[i], fallback) : fallback;
}
function strAt(arr: unknown, i: number, fallback = ''): string {
  return Array.isArray(arr) ? str(arr[i], fallback) : fallback;
}

/** Normalize the geocoder response to display-safe matches (numeric lat/lon + strings only). */
export function normalizeGeocode(json: unknown): GeocodeMatch[] {
  const results = (json as { results?: unknown } | null | undefined)?.results;
  if (!Array.isArray(results)) return [];
  const out: GeocodeMatch[] = [];
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const latitude = Number(o.latitude);
    const longitude = Number(o.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue;
    out.push({
      geoId: String(o.id ?? `${latitude},${longitude}`),
      name: str(o.name),
      country: str(o.country),
      admin1: typeof o.admin1 === 'string' ? o.admin1 : undefined,
      latitude,
      longitude,
    });
  }
  return out;
}

/**
 * Normalize the forecast response → current + today's hourly strip + a 7-day daily row.
 * DETERMINISTIC: "today" is the date part of `current.time` (the response's own local clock under
 * `timezone=auto`), never `Date.now()`. Missing arrays/fields heal to zeros rather than throwing.
 */
export function normalizeForecast(json: unknown, units: Units): ForecastBundle {
  const j = (json ?? {}) as Record<string, unknown>;
  const cur = (j.current ?? {}) as Record<string, unknown>;
  const hourly = (j.hourly ?? {}) as Record<string, unknown>;
  const daily = (j.daily ?? {}) as Record<string, unknown>;

  const current: CurrentConditions = {
    time: str(cur.time),
    temperature: num(cur.temperature_2m),
    apparentTemperature: num(cur.apparent_temperature),
    weatherCode: num(cur.weather_code),
    windSpeed: num(cur.wind_speed_10m),
    windDirection: num(cur.wind_direction_10m),
    relativeHumidity: num(cur.relative_humidity_2m),
    precipitation: num(cur.precipitation),
    isDay: num(cur.is_day, 1),
  };

  const today = current.time.slice(0, 10);
  const hTimes = Array.isArray(hourly.time) ? (hourly.time as unknown[]) : [];
  const hourlyToday: HourlyPoint[] = [];
  for (let i = 0; i < hTimes.length; i++) {
    const t = strAt(hourly.time, i);
    // When current.time is absent (today === ''), fall back to including all hours rather than none.
    if (today && t.slice(0, 10) !== today) continue;
    hourlyToday.push({
      time: t,
      temperature: numAt(hourly.temperature_2m, i),
      weatherCode: numAt(hourly.weather_code, i),
      precipitationProbability: numAt(hourly.precipitation_probability, i),
      precipitation: numAt(hourly.precipitation, i),
      isDay: numAt(hourly.is_day, i, 1),
    });
  }

  const dDates = Array.isArray(daily.time) ? (daily.time as unknown[]) : [];
  const daily7: DailyPoint[] = [];
  for (let i = 0; i < dDates.length && daily7.length < 7; i++) {
    daily7.push({
      date: strAt(daily.time, i),
      weatherCode: numAt(daily.weather_code, i),
      temperatureMax: numAt(daily.temperature_2m_max, i),
      temperatureMin: numAt(daily.temperature_2m_min, i),
      precipitationSum: numAt(daily.precipitation_sum, i),
      precipitationProbabilityMax: numAt(daily.precipitation_probability_max, i),
      sunrise: strAt(daily.sunrise, i),
      sunset: strAt(daily.sunset, i),
    });
  }

  return { current, hourlyToday, daily: daily7, units, timezone: str(j.timezone) };
}

// ── Public client operations ─────────────────────────────────────────────────────
/** Geocode a city name → display-safe matches (Tor-gated). Empty string → no request, `[]`. */
export async function geocodeCity(name: string, deps: WeatherClientDeps): Promise<GeocodeMatch[]> {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const json = await getJson(buildGeocodeUrl(trimmed), deps);
  return normalizeGeocode(json);
}

/** Fetch + normalize a forecast for a validated lat/lon (Tor-gated). */
export async function fetchForecast(
  latitude: number,
  longitude: number,
  units: Units,
  deps: WeatherClientDeps,
): Promise<ForecastBundle> {
  const { latitude: lat, longitude: lon } = assertLatLon(latitude, longitude);
  const json = await getJson(buildForecastUrl(lat, lon, units), deps);
  return normalizeForecast(json, units);
}

/**
 * Weather tool — client unit tests (Phase 1). NO network: every egress path is exercised through the
 * injectable `transport` seam, and the pure URL builders / normalizers / gate are tested directly.
 *
 * Covers the hardening invariants that must hold before any renderer wiring:
 *  - HOST ALLOWLIST (constraint 2): the builders produce EXACT host-anchored Open-Meteo URLs incl. the
 *    unit params; `assertAllowedHost` rejects a foreign/injected host and a non-HTTPS scheme.
 *  - EGRESS GATE (constraint 1): `resolveWeatherEgress` picks Tor vs clearnet per settings and FAILS
 *    CLOSED (never silent clearnet) when Tor-default and Tor is not bootstrapped.
 *  - NORMALIZERS (constraint 5): map a sample Open-Meteo JSON → current / today-hourly / 7-day, with
 *    "today" derived from the response's own `current.time` (deterministic, no wall clock).
 *  - WMO table: code → { label, glyph }, total + healing.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  assertAllowedHost,
  assertLatLon,
  buildForecastUrl,
  buildGeocodeUrl,
  fetchForecast,
  forecastUnitParams,
  geocodeCity,
  normalizeForecast,
  normalizeGeocode,
  resolveWeatherEgress,
  WeatherEgressBlockedError,
  WEATHER_HOSTS,
  type WeatherClientDeps,
  type WeatherHttpResponse,
} from '../src/main/weather/client';
import { lookupWeatherCode, UNKNOWN_WEATHER, WMO_WEATHER_CODES } from '../src/shared/weather/types';

// ── URL builders — EXACT, host-anchored ──────────────────────────────────────────
describe('buildGeocodeUrl — host-anchored to geocoding-api.open-meteo.com', () => {
  it('produces the exact search URL for a simple name', () => {
    expect(buildGeocodeUrl('Berlin')).toBe(
      'https://geocoding-api.open-meteo.com/v1/search?name=Berlin&count=10&language=en&format=json',
    );
  });

  it('percent-encodes a name with spaces/ampersands (no raw injection into the query)', () => {
    const url = buildGeocodeUrl('New York & Co');
    const u = new URL(url);
    expect(u.hostname).toBe(WEATHER_HOSTS.geocode);
    expect(u.searchParams.get('name')).toBe('New York & Co'); // decoded round-trips
    expect(url).not.toMatch(/ &| York &/); // no raw space/ampersand breaking the query string
    expect(url).toContain('name=New+York+%26+Co');
  });
});

describe('buildForecastUrl — host-anchored to api.open-meteo.com incl. unit params', () => {
  it('metric: exact URL with celsius/kmh/mm + timezone=auto + 7 days', () => {
    expect(buildForecastUrl(52.52, 13.41, 'metric')).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41' +
        '&current=temperature_2m%2Capparent_temperature%2Crelative_humidity_2m%2Cis_day%2Cprecipitation%2Cweather_code%2Cwind_speed_10m%2Cwind_direction_10m' +
        '&hourly=temperature_2m%2Cweather_code%2Cprecipitation_probability%2Cprecipitation%2Cis_day' +
        '&daily=weather_code%2Ctemperature_2m_max%2Ctemperature_2m_min%2Cprecipitation_sum%2Cprecipitation_probability_max%2Csunrise%2Csunset' +
        '&timezone=auto&forecast_days=7&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm',
    );
  });

  it('imperial: flips only the unit params to fahrenheit/mph/inch', () => {
    const u = new URL(buildForecastUrl(40, -74, 'imperial'));
    expect(u.hostname).toBe(WEATHER_HOSTS.forecast);
    expect(u.searchParams.get('temperature_unit')).toBe('fahrenheit');
    expect(u.searchParams.get('wind_speed_unit')).toBe('mph');
    expect(u.searchParams.get('precipitation_unit')).toBe('inch');
    expect(u.searchParams.get('timezone')).toBe('auto');
  });

  it('rejects an out-of-range lat/lon before building a URL', () => {
    expect(() => buildForecastUrl(999, 0, 'metric')).toThrow(/out of range/);
    expect(() => buildForecastUrl(0, 999, 'metric')).toThrow(/out of range/);
    expect(() => buildForecastUrl(Number.NaN, 0, 'metric')).toThrow(/out of range/);
  });

  it('forecastUnitParams maps both unit systems', () => {
    expect(forecastUnitParams('metric')).toEqual({ temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm' });
    expect(forecastUnitParams('imperial')).toEqual({ temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch' });
  });
});

// ── SSRF guard — foreign host rejected ──────────────────────────────────────────
describe('assertAllowedHost — SSRF guard (constraint 2)', () => {
  it('accepts the two Open-Meteo hosts over https', () => {
    expect(assertAllowedHost('https://api.open-meteo.com/v1/forecast?x=1').hostname).toBe(WEATHER_HOSTS.forecast);
    expect(assertAllowedHost('https://geocoding-api.open-meteo.com/v1/search?name=x').hostname).toBe(WEATHER_HOSTS.geocode);
  });

  it('rejects a foreign host, a look-alike host, a non-https scheme, and garbage', () => {
    expect(() => assertAllowedHost('https://evil.example.com/v1/forecast')).toThrow(/host not allowed/);
    expect(() => assertAllowedHost('https://api.open-meteo.com.evil.com/x')).toThrow(/host not allowed/);
    expect(() => assertAllowedHost('http://api.open-meteo.com/v1/forecast')).toThrow(/non-HTTPS/);
    expect(() => assertAllowedHost('not a url')).toThrow(/malformed URL/);
  });

  it('assertLatLon rejects out-of-range and non-finite pairs', () => {
    expect(assertLatLon(52.52, 13.41)).toEqual({ latitude: 52.52, longitude: 13.41 });
    expect(() => assertLatLon(91, 0)).toThrow(/out of range/);
    expect(() => assertLatLon(0, 181)).toThrow(/out of range/);
  });
});

// ── Egress gate — Tor-default, fail-closed ──────────────────────────────────────
describe('resolveWeatherEgress — Tor-default, fail-closed, acked-clearnet opt-in (constraint 1)', () => {
  it('Tor mode when clearnet is off and Tor IS bootstrapped', () => {
    const g = resolveWeatherEgress({ torDefault: true, clearnet: false, clearnetAck: false }, 9150);
    expect(g).toEqual({ mode: 'tor', socksPort: 9150 });
  });

  it('FAILS CLOSED (blocked) when clearnet is off and Tor is NOT bootstrapped — never silent clearnet', () => {
    const g = resolveWeatherEgress({ torDefault: true, clearnet: false, clearnetAck: false }, null);
    expect('blocked' in g && g.blocked).toBe(true);
  });

  it('clearnet mode ONLY when clearnet && clearnetAck', () => {
    expect(resolveWeatherEgress({ torDefault: true, clearnet: true, clearnetAck: true }, null)).toEqual({ mode: 'clearnet' });
    // clearnet enabled but NOT acknowledged → still Tor (and fail-closed when Tor is down)
    const notAcked = resolveWeatherEgress({ torDefault: true, clearnet: true, clearnetAck: false }, null);
    expect('blocked' in notAcked && notAcked.blocked).toBe(true);
  });
});

// ── getJson egress selection through fetchForecast/geocodeCity ───────────────────
function transportSpy(canned: WeatherHttpResponse) {
  const calls: Array<{ url: string; gate: unknown }> = [];
  const transport: NonNullable<WeatherClientDeps['transport']> = async (url, gate) => {
    calls.push({ url, gate });
    return canned;
  };
  return { transport, calls };
}

const SAMPLE_FORECAST = JSON.stringify({
  timezone: 'Europe/Berlin',
  current: {
    time: '2026-08-15T12:00',
    temperature_2m: 21.3,
    apparent_temperature: 20.1,
    relative_humidity_2m: 55,
    is_day: 1,
    precipitation: 0,
    weather_code: 2,
    wind_speed_10m: 9.4,
    wind_direction_10m: 210,
  },
  hourly: {
    time: ['2026-08-15T11:00', '2026-08-15T12:00', '2026-08-16T00:00'],
    temperature_2m: [20, 21, 15],
    weather_code: [1, 2, 3],
    precipitation_probability: [10, 20, 40],
    precipitation: [0, 0, 0.2],
    is_day: [1, 1, 0],
  },
  daily: {
    time: ['2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22'],
    weather_code: [2, 3, 61, 0, 1, 2, 95, 45],
    temperature_2m_max: [24, 22, 19, 26, 27, 25, 20, 18],
    temperature_2m_min: [14, 13, 12, 15, 16, 15, 11, 10],
    precipitation_sum: [0, 1.2, 8.4, 0, 0, 0.1, 12, 0],
    precipitation_probability_max: [20, 40, 80, 0, 5, 10, 90, 30],
    sunrise: ['2026-08-15T06:00', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    sunset: ['2026-08-15T20:30', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
  },
});

describe('fetchForecast — egress selection + fail-closed via the transport seam (no network)', () => {
  it('routes over Tor and hits api.open-meteo.com when Tor is bootstrapped', async () => {
    const { transport, calls } = transportSpy({ status: 200, body: SAMPLE_FORECAST });
    const deps: WeatherClientDeps = {
      settings: { torDefault: true, clearnet: false, clearnetAck: false },
      torSocksPort: () => 9150,
      transport,
    };
    const bundle = await fetchForecast(52.52, 13.41, 'metric', deps);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).hostname).toBe(WEATHER_HOSTS.forecast);
    expect(calls[0].gate).toEqual({ mode: 'tor', socksPort: 9150 });
    expect(bundle.current.temperature).toBe(21.3);
  });

  it('FAILS CLOSED (no transport call) when Tor-default and Tor is down', async () => {
    const { transport, calls } = transportSpy({ status: 200, body: SAMPLE_FORECAST });
    const deps: WeatherClientDeps = {
      settings: { torDefault: true, clearnet: false, clearnetAck: false },
      torSocksPort: () => null,
      transport,
    };
    await expect(fetchForecast(52.52, 13.41, 'metric', deps)).rejects.toBeInstanceOf(WeatherEgressBlockedError);
    expect(calls).toHaveLength(0); // never dialled
  });

  it('routes clearnet when clearnet && clearnetAck', async () => {
    const { transport, calls } = transportSpy({ status: 200, body: SAMPLE_FORECAST });
    const deps: WeatherClientDeps = {
      settings: { torDefault: true, clearnet: true, clearnetAck: true },
      torSocksPort: () => null, // irrelevant on clearnet
      transport,
    };
    await fetchForecast(52.52, 13.41, 'metric', deps);
    expect(calls[0].gate).toEqual({ mode: 'clearnet' });
  });

  it('throws on a non-2xx HTTP status', async () => {
    const { transport } = transportSpy({ status: 500, body: '{}' });
    const deps: WeatherClientDeps = {
      settings: { torDefault: true, clearnet: false, clearnetAck: false },
      torSocksPort: () => 9150,
      transport,
    };
    await expect(fetchForecast(52.52, 13.41, 'metric', deps)).rejects.toThrow(/HTTP 500/);
  });
});

describe('geocodeCity — empty query never dials; otherwise normalizes matches', () => {
  it('returns [] for a blank query with NO transport call', async () => {
    const t = vi.fn();
    const deps: WeatherClientDeps = {
      settings: { torDefault: true, clearnet: false, clearnetAck: false },
      torSocksPort: () => 9150,
      transport: t as never,
    };
    expect(await geocodeCity('   ', deps)).toEqual([]);
    expect(t).not.toHaveBeenCalled();
  });

  it('normalizes geocoder matches over Tor', async () => {
    const body = JSON.stringify({
      results: [
        { id: 1, name: 'Berlin', country: 'Germany', admin1: 'Berlin', latitude: 52.52, longitude: 13.41 },
        { id: 2, name: 'Bad', country: 'Nowhere', latitude: 999, longitude: 0 }, // dropped (out of range)
      ],
    });
    const { transport, calls } = transportSpy({ status: 200, body });
    const deps: WeatherClientDeps = {
      settings: { torDefault: true, clearnet: false, clearnetAck: false },
      torSocksPort: () => 9150,
      transport,
    };
    const matches = await geocodeCity('Berlin', deps);
    expect(new URL(calls[0].url).hostname).toBe(WEATHER_HOSTS.geocode);
    expect(matches).toEqual([
      { geoId: '1', name: 'Berlin', country: 'Germany', admin1: 'Berlin', latitude: 52.52, longitude: 13.41 },
    ]);
  });
});

// ── Normalizers ──────────────────────────────────────────────────────────────
describe('normalizeForecast — current / today-hourly / 7-day (deterministic)', () => {
  const bundle = normalizeForecast(JSON.parse(SAMPLE_FORECAST), 'metric');

  it('maps current conditions', () => {
    expect(bundle.current).toEqual({
      time: '2026-08-15T12:00',
      temperature: 21.3,
      apparentTemperature: 20.1,
      weatherCode: 2,
      windSpeed: 9.4,
      windDirection: 210,
      relativeHumidity: 55,
      precipitation: 0,
      isDay: 1,
    });
    expect(bundle.timezone).toBe('Europe/Berlin');
    expect(bundle.units).toBe('metric');
  });

  it('keeps only TODAY\'s hourly points (date == current.time date), not tomorrow', () => {
    expect(bundle.hourlyToday.map((h) => h.time)).toEqual(['2026-08-15T11:00', '2026-08-15T12:00']);
    expect(bundle.hourlyToday[0]).toEqual({
      time: '2026-08-15T11:00',
      temperature: 20,
      weatherCode: 1,
      precipitationProbability: 10,
      precipitation: 0,
      isDay: 1,
    });
  });

  it('caps the daily row at 7 days even when 8 are returned', () => {
    expect(bundle.daily).toHaveLength(7);
    expect(bundle.daily[0]).toEqual({
      date: '2026-08-15',
      weatherCode: 2,
      temperatureMax: 24,
      temperatureMin: 14,
      precipitationSum: 0,
      precipitationProbabilityMax: 20,
      sunrise: '2026-08-15T06:00',
      sunset: '2026-08-15T20:30',
    });
  });

  it('heals missing arrays/fields to zeros rather than throwing', () => {
    const empty = normalizeForecast({}, 'imperial');
    expect(empty.current.temperature).toBe(0);
    expect(empty.hourlyToday).toEqual([]);
    expect(empty.daily).toEqual([]);
    expect(empty.units).toBe('imperial');
  });
});

describe('normalizeGeocode — display-safe, drops invalid coordinates', () => {
  it('returns [] on a missing results array', () => {
    expect(normalizeGeocode({})).toEqual([]);
    expect(normalizeGeocode(null)).toEqual([]);
  });
});

// ── WMO table ──────────────────────────────────────────────────────────────
describe('lookupWeatherCode — static WMO table (constraint 5)', () => {
  it('resolves representative codes to a label + glyph', () => {
    expect(lookupWeatherCode(0).label).toBe('Clear sky');
    expect(lookupWeatherCode(95).label).toBe('Thunderstorm');
    expect(lookupWeatherCode(3).label).toBe('Overcast');
    for (const info of Object.values(WMO_WEATHER_CODES)) {
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.glyph.length).toBeGreaterThan(0);
    }
  });

  it('heals an unknown / non-integer code to UNKNOWN_WEATHER (never throws)', () => {
    expect(lookupWeatherCode(1234)).toBe(UNKNOWN_WEATHER);
    expect(lookupWeatherCode(2.5)).toBe(UNKNOWN_WEATHER);
    expect(lookupWeatherCode(-1)).toBe(UNKNOWN_WEATHER);
  });
});

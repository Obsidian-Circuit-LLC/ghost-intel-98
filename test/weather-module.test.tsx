// @vitest-environment jsdom
/**
 * Weather tool — renderer (Phase 2). Drives the REAL preload channels (mocked window.api.weather)
 * through React 18's createRoot inside act(), against a jsdom container (mirrors
 * hostinfo-states.test.tsx — no @testing-library, not a dependency).
 *
 * Covers the spec's renderer testing checklist:
 *  - add / switch / remove / reorder saved locations via the real channels;
 *  - units toggle re-labels + re-fetches;
 *  - current + hourly + 7-day render;
 *  - TOR/CLEARNET egress marker + the one-time clearnet acknowledgement;
 *  - stale banner on a cache-only (stale:true) render, and the fail-closed blocked message.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WeatherModule } from '../src/renderer/modules/weather/WeatherModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';
import type {
  ForecastBundle,
  GeocodeMatch,
  SavedLocation,
  Units,
  WeatherEgressState,
  WeatherForecastResult,
} from '../src/shared/weather/types';

// The one-time clearnet acknowledgement runs through the themed confirm dialog. Mock it so the
// test can assert it was consulted and control its answer without mounting the dialog host.
const confirmDialog = vi.fn(async () => true);
vi.mock('../src/renderer/state/dialogs', () => ({ confirmDialog: (...a: unknown[]) => confirmDialog(...a) }));

function loc(id: string, name: string, latitude: number, longitude: number): SavedLocation {
  return { id, name, country: 'Testland', admin1: 'Region', latitude, longitude, addedAt: '2026-08-15T00:00:00.000Z' };
}

function bundle(units: Units): ForecastBundle {
  const tMul = units === 'imperial' ? 2 : 1; // just a distinguishable number per unit system
  return {
    units,
    timezone: 'Europe/Test',
    current: {
      time: '2026-08-15T12:00',
      temperature: 21 * tMul,
      apparentTemperature: 19 * tMul,
      weatherCode: 2, // Partly cloudy
      windSpeed: 15,
      windDirection: 180,
      relativeHumidity: 60,
      precipitation: 0,
      isDay: 1,
    },
    hourlyToday: [
      { time: '2026-08-15T12:00', temperature: 20 * tMul, weatherCode: 2, precipitationProbability: 10, precipitation: 0, isDay: 1 },
      { time: '2026-08-15T13:00', temperature: 22 * tMul, weatherCode: 3, precipitationProbability: 30, precipitation: 0, isDay: 1 },
    ],
    daily: [
      { date: '2026-08-15', weatherCode: 2, temperatureMax: 24 * tMul, temperatureMin: 15 * tMul, precipitationSum: 0, precipitationProbabilityMax: 20, sunrise: '2026-08-15T06:00', sunset: '2026-08-15T20:00' },
      { date: '2026-08-16', weatherCode: 61, temperatureMax: 23 * tMul, temperatureMin: 14 * tMul, precipitationSum: 3, precipitationProbabilityMax: 70, sunrise: '2026-08-16T06:01', sunset: '2026-08-16T19:59' },
    ],
  };
}

const TOR_EGRESS: WeatherEgressState = {
  mode: 'tor', torBootstrapped: true, torDefault: true, clearnet: false, clearnetAck: false,
};

interface WeatherApi {
  geocode: ReturnType<typeof vi.fn>;
  locationsList: ReturnType<typeof vi.fn>;
  locationsAdd: ReturnType<typeof vi.fn>;
  locationsRemove: ReturnType<typeof vi.fn>;
  locationsReorder: ReturnType<typeof vi.fn>;
  forecast: ReturnType<typeof vi.fn>;
  unitsGet: ReturnType<typeof vi.fn>;
  unitsSet: ReturnType<typeof vi.fn>;
  egressState: ReturnType<typeof vi.fn>;
}

let container: HTMLDivElement;
let root: Root;
let api: WeatherApi;

function installApi(over: Partial<WeatherApi> = {}): void {
  api = {
    geocode: vi.fn(async () => [] as GeocodeMatch[]),
    locationsList: vi.fn(async () => [] as SavedLocation[]),
    locationsAdd: vi.fn(async () => [] as SavedLocation[]),
    locationsRemove: vi.fn(async () => [] as SavedLocation[]),
    locationsReorder: vi.fn(async () => [] as SavedLocation[]),
    forecast: vi.fn(async (): Promise<WeatherForecastResult> => ({ bundle: bundle('metric'), stale: false, cachedAt: '2026-08-15T12:00:00.000Z' })),
    unitsGet: vi.fn(async (): Promise<Units> => 'metric'),
    unitsSet: vi.fn(async (u: Units): Promise<Units> => u),
    egressState: vi.fn(async (): Promise<WeatherEgressState> => TOR_EGRESS),
    ...over,
  };
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    weather: api,
    settings: { update: vi.fn(async (p: unknown) => ({ ...defaultSettings, ...(p as object) })) },
  };
}

async function mount(): Promise<void> {
  await act(async () => { root.render(<WeatherModule />); });
  // let the mount effects (list/units/egress/forecast) settle
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

function text(): string { return container.textContent ?? ''; }
function byAria(label: string): HTMLElement | null { return container.querySelector(`[aria-label="${label}"]`); }
async function click(el: Element | null): Promise<void> {
  await act(async () => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  confirmDialog.mockClear();
  useSettings.setState({ settings: { ...defaultSettings } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettings.setState({ settings: null });
  vi.restoreAllMocks();
});

describe('WeatherModule — forecast render', () => {
  it('renders current + hourly + 7-day for the selected location', async () => {
    installApi({ locationsList: vi.fn(async () => [loc('a', 'Testburg', 10, 20)]) });
    await mount();
    // fetched the first location's forecast
    expect(api.forecast).toHaveBeenCalledWith('a');
    // current: condition label + metric temp
    expect(text()).toMatch(/Partly cloudy/);
    expect(text()).toMatch(/21°C/);
    expect(text()).toMatch(/Feels like/i);
    expect(text()).toMatch(/60%/); // humidity
    expect(text()).toMatch(/15 km\/h/); // wind, metric label
    // hourly + daily rows rendered
    expect(container.querySelectorAll('.ga98-weather-hour').length).toBe(2);
    expect(container.querySelectorAll('.ga98-weather-day').length).toBe(2);
  });
});

describe('WeatherModule — units reconcile on mount', () => {
  it('heals the settings-backed toggle to the STORE units (the fetch source of truth) on mount', async () => {
    // settings say metric (beforeEach default) but the store (authoritative for the fetch) says imperial.
    installApi({ unitsGet: vi.fn(async (): Promise<Units> => 'imperial') });
    await mount();
    expect(useSettings.getState().settings?.weather?.units).toBe('imperial');
    expect(byAria('Imperial units')?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('WeatherModule — saved locations', () => {
  it('adds a geocoded location via the real channels and selects it', async () => {
    const match: GeocodeMatch = { geoId: '1', name: 'Paris', country: 'France', admin1: 'Île-de-France', latitude: 48.85, longitude: 2.35 };
    installApi({
      geocode: vi.fn(async () => [match]),
      locationsAdd: vi.fn(async () => [loc('p', 'Paris', 48.85, 2.35)]),
    });
    await mount();
    const input = byAria('Add a city') as HTMLInputElement;
    await act(async () => {
      // React tracks a controlled input's value via a prototype descriptor — set through the native
      // setter so the synthetic onChange sees the new value (a bare `.value =` is ignored).
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Paris');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(byAria('Search for a city'));
    expect(api.geocode).toHaveBeenCalledWith('Paris');
    expect(text()).toMatch(/Paris/);
    await click(byAria('Add Paris, France'));
    expect(api.locationsAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Paris', latitude: 48.85, longitude: 2.35 }));
    // newly-added location becomes selected → its forecast fetched
    expect(api.forecast).toHaveBeenCalledWith('p');
  });

  it('switches the selected location on click', async () => {
    installApi({ locationsList: vi.fn(async () => [loc('a', 'Aville', 1, 1), loc('b', 'Bton', 2, 2)]) });
    await mount();
    api.forecast.mockClear();
    await click(byAria('Show weather for Bton'));
    expect(api.forecast).toHaveBeenCalledWith('b');
  });

  it('removes a location via the real channel', async () => {
    installApi({
      locationsList: vi.fn(async () => [loc('a', 'Aville', 1, 1), loc('b', 'Bton', 2, 2)]),
      locationsRemove: vi.fn(async () => [loc('b', 'Bton', 2, 2)]),
    });
    await mount();
    await click(byAria('Remove Aville'));
    expect(api.locationsRemove).toHaveBeenCalledWith('a');
  });

  it('reorders a location via the real channel', async () => {
    installApi({
      locationsList: vi.fn(async () => [loc('a', 'Aville', 1, 1), loc('b', 'Bton', 2, 2)]),
      locationsReorder: vi.fn(async () => [loc('b', 'Bton', 2, 2), loc('a', 'Aville', 1, 1)]),
    });
    await mount();
    await click(byAria('Move Aville down'));
    expect(api.locationsReorder).toHaveBeenCalledWith(['b', 'a']);
  });
});

describe('WeatherModule — units toggle', () => {
  it('re-fetches and re-labels when switching to imperial', async () => {
    const forecast = vi.fn(async (): Promise<WeatherForecastResult> => ({ bundle: bundle('metric'), stale: false }));
    forecast.mockResolvedValueOnce({ bundle: bundle('metric'), stale: false });
    forecast.mockResolvedValueOnce({ bundle: bundle('imperial'), stale: false });
    installApi({ locationsList: vi.fn(async () => [loc('a', 'Testburg', 10, 20)]), forecast });
    await mount();
    expect(text()).toMatch(/15 km\/h/);
    await click(byAria('Imperial units'));
    expect(api.unitsSet).toHaveBeenCalledWith('imperial');
    // re-fetched, and the wind label flips to mph (driven by the fetched bundle.units)
    expect(api.forecast).toHaveBeenCalledTimes(2);
    expect(text()).toMatch(/15 mph/);
    expect(text()).toMatch(/42°F/); // 21 * 2 in the imperial fixture
  });
});

describe('WeatherModule — egress marker + clearnet ack', () => {
  it('shows the TOR marker and gates the first clearnet flip behind the ack', async () => {
    const egressState = vi.fn(async () => TOR_EGRESS);
    installApi({ locationsList: vi.fn(async () => [loc('a', 'Testburg', 10, 20)]), egressState });
    const update = vi.fn(async (p: unknown) => ({ ...defaultSettings, ...(p as object) }));
    (globalThis as unknown as { window: { api: { settings: { update: unknown } } } }).window.api.settings.update = update;
    // after the ack, egress reports clearnet
    egressState.mockResolvedValueOnce(TOR_EGRESS); // initial mount
    egressState.mockResolvedValue({ mode: 'clearnet', torBootstrapped: true, torDefault: true, clearnet: true, clearnetAck: true });
    await mount();
    expect(text()).toMatch(/TOR MODE/i);
    await click(byAria('Route over clearnet (real IP)'));
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    // patched settings with BOTH clearnet + clearnetAck in one nested patch
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      weather: expect.objectContaining({ clearnet: true, clearnetAck: true }),
    }));
    expect(text()).toMatch(/CLEARNET/i);
  });
});

describe('WeatherModule — offline / fail-closed', () => {
  it('renders the stale banner on a cache-only (stale) result', async () => {
    installApi({
      locationsList: vi.fn(async () => [loc('a', 'Testburg', 10, 20)]),
      forecast: vi.fn(async (): Promise<WeatherForecastResult> => ({ bundle: bundle('metric'), stale: true, cachedAt: '2026-08-15T09:00:00.000Z', error: "Couldn't reach Open-Meteo" })),
    });
    await mount();
    expect(container.querySelector('.ga98-weather-stale')).not.toBeNull();
    expect(text()).toMatch(/cached/i);
    // the cached conditions still render
    expect(text()).toMatch(/Partly cloudy/);
  });

  it('shows the fail-closed blocked message when Tor is down and there is no cache', async () => {
    installApi({
      locationsList: vi.fn(async () => [loc('a', 'Testburg', 10, 20)]),
      egressState: vi.fn(async (): Promise<WeatherEgressState> => ({ mode: 'blocked', reason: 'Background Tor is not bootstrapped', torBootstrapped: false, torDefault: true, clearnet: false, clearnetAck: false })),
      forecast: vi.fn(async () => { throw new Error('weather: Tor is not ready — enable clearnet to fetch over your real IP'); }),
    });
    await mount();
    expect(container.querySelector('.ga98-weather-blocked')).not.toBeNull();
    expect(text()).toMatch(/Tor is not ready|not bootstrapped/i);
    // the clearnet toggle is offered
    expect(byAria('Route over clearnet (real IP)')).not.toBeNull();
  });
});

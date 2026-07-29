// @vitest-environment jsdom
/**
 * Event Details Phase 1 — Task 6: 4-column layout + reflow.
 *
 * The GeoINT grid is 3-column (`.ga98-geo-3col`) with no event selected. When an incident is
 * selected the Event Details panel opens as a 4th column and the grid root switches to
 * `.ga98-geo-4col`; closing the panel reflows back to `.ga98-geo-3col`. This test drives the class
 * toggle through the real selection path (Situation-Feed right-click → "View details" → ✕).
 *
 * The CSS track widths themselves (380px / 1fr / 300px / 360px) are verified by the controller's
 * headless-Chrome harness WITH the `.ga98-window-shell` wrapper (the `.window` stretch trap does not
 * apply here — the panel is a rail-style `.ga98-geo-details` div, not a `.window`). jsdom has no
 * layout engine, so this asserts the class-presence contract only.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act(), mirroring
 * geoint-event-details-wiring.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GeoIntModule } from '../src/renderer/modules/geoint/GeoIntModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';
import type { GeoItem } from '../src/shared/post-mvp-types';

// `maplibre-gl`'s package entry calls window.URL.createObjectURL at module-load — throws under jsdom.
vi.mock('maplibre-gl', () => ({ default: {} }));
vi.mock('../src/renderer/modules/geoint/MapGL', () => ({
  MapGL: () => null,
  validCoord: (lat: number | null | undefined, lon: number | null | undefined): boolean =>
    lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}));

let container: HTMLDivElement;
let root: Root;

const strike: GeoItem = {
  id: 'wartracker:1',
  sourceId: 'threat:wartracker',
  title: 'Coordinated strike near Mosul',
  link: 'https://example.org/events/1',
  located: 'geo',
  lat: 36.3456,
  lon: 43.1189,
  category: 'chatter',
  severity: 'high',
  eventType: 'Military Strike',
  detail: 'A coordinated airstrike was reported across three districts.',
  confidence: 'HIGH',
  country: 'IQ'
};

function findByText(rootEl: ParentNode, text: string): HTMLElement | undefined {
  return Array.from(rootEl.querySelectorAll<HTMLElement>('*')).find((el) => el.children.length === 0 && el.textContent === text);
}

function installApi(items: GeoItem[]): void {
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    settings: { update: vi.fn().mockResolvedValue(useSettings.getState().settings) },
    geoint: {
      snapshot: vi.fn().mockResolvedValue({ sources: [], items }),
      getMonitors: vi.fn().mockResolvedValue([]),
      addMonitor: vi.fn().mockResolvedValue([]),
      removeMonitor: vi.fn().mockResolvedValue([]),
      hasLayerKey: vi.fn().mockResolvedValue(false),
      fetchKev: vi.fn().mockResolvedValue([]),
      fetchThreatLayer: vi.fn().mockResolvedValue([]),
      geocode: vi.fn().mockResolvedValue(null),
      importOpml: vi.fn().mockResolvedValue(0),
      purgeCache: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue({ fetched: 0, failed: 0 }),
      addSource: vi.fn().mockResolvedValue(undefined),
      removeSource: vi.fn().mockResolvedValue(undefined),
      setItemLocation: vi.fn().mockResolvedValue(undefined),
      setLayerKey: vi.fn().mockResolvedValue(undefined),
      updateSource: vi.fn().mockResolvedValue(undefined)
    },
    livefeeds: {
      aisSetBbox: vi.fn().mockResolvedValue(undefined),
      aisStart: vi.fn().mockResolvedValue('gate-off'),
      aisStop: vi.fn().mockResolvedValue(undefined),
      fetchAdsb: vi.fn().mockResolvedValue([]),
      onAisPositions: vi.fn(() => () => {})
    },
    satellites: {
      fetchGroup: vi.fn().mockResolvedValue(''),
      list: vi.fn().mockResolvedValue([]),
      snapshot: vi.fn().mockResolvedValue('')
    },
    streams: { list: vi.fn().mockResolvedValue([]) },
    system: { openExternal: vi.fn() },
    browser: { launchFirefox: vi.fn().mockResolvedValue(undefined) }
  };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  useSettings.setState({ settings: { ...defaultSettings, geoint: { ...defaultSettings.geoint, networkEnabled: false, newsStreams: [] } } });
  installApi([strike]);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettings.setState({ settings: null });
  vi.restoreAllMocks();
});

describe('GeoIntModule — 4-column layout toggles with the Event Details panel', () => {
  it('is ga98-geo-3col with no selection, ga98-geo-4col when selected, and reflows back on close', async () => {
    await act(async () => { root.render(<GeoIntModule />); });
    await flush();

    const grid = container.querySelector('.ga98-geo') as HTMLElement | null;
    expect(grid, 'geoint grid root present').toBeTruthy();

    // No selection ⇒ 3-column, not 4-column.
    expect(grid!.classList.contains('ga98-geo-3col')).toBe(true);
    expect(grid!.classList.contains('ga98-geo-4col')).toBe(false);

    // Select an event via the Situation-Feed right-click → "View details".
    const rail = container.querySelector('.ga98-geo-rail')!;
    const rowEl = Array.from(rail.querySelectorAll('li')).find((li) => (li.textContent ?? '').includes('Coordinated strike near Mosul'));
    expect(rowEl, 'situation-feed row present').toBeTruthy();
    await act(async () => { rowEl!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); });
    const viewDetails = findByText(container, 'View details');
    expect(viewDetails, '"View details" entry present').toBeTruthy();
    await act(async () => { viewDetails!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();

    // Selection ⇒ 4-column, not 3-column; the panel is present.
    expect(grid!.classList.contains('ga98-geo-4col')).toBe(true);
    expect(grid!.classList.contains('ga98-geo-3col')).toBe(false);
    expect(container.querySelector('.ga98-geo-details'), 'details panel present').toBeTruthy();

    // Close ⇒ reflow back to 3-column, panel gone.
    const panel = container.querySelector('.ga98-geo-details')!;
    const closeBtn = Array.from(panel.querySelectorAll('button')).find((b) => /^[×✕x]$/.test((b.textContent ?? '').trim()));
    expect(closeBtn, 'close button present').toBeTruthy();
    await act(async () => { closeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();

    expect(grid!.classList.contains('ga98-geo-3col')).toBe(true);
    expect(grid!.classList.contains('ga98-geo-4col')).toBe(false);
    expect(container.querySelector('.ga98-geo-details')).toBeNull();
  });
});

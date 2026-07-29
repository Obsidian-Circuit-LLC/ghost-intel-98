// @vitest-environment jsdom
/**
 * Event Details Phase 1 — Task 5: wire selected-event state + triggers into GeoIntModule.
 *
 * Two seams under test:
 *  (a) CommandRail gains an `onViewDetails(id)` prop → a "View details" entry in the Situation-Feed
 *      row context menu (alongside Add/Remove Monitor) that fires the callback with the row id.
 *  (b) GeoIntModuleInner renders <EventDetailsPanel> ONLY when an event is selected; right-clicking a
 *      Situation-Feed row → "View details" selects it and opens the panel. Closing it (✕) hides it.
 *
 * HONESTY (charter): no fabricated data — the panel renders the selected item's OWN real fields via
 * the pure helpers. No new egress: onOpenLink routes through the existing window.api.system.openExternal
 * safe-open path. XSS-safe (the panel renders React text only).
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act(), mirroring
 * geoint-patch-partial.test.tsx / geoint-event-details-panel.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommandRail, type CommandRailProps } from '../src/renderer/modules/geoint/CommandRail';
import { GeoIntModule } from '../src/renderer/modules/geoint/GeoIntModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';
import type { GeoItem } from '../src/shared/post-mvp-types';

// `maplibre-gl`'s package entry calls window.URL.createObjectURL at module-load — throws under jsdom
// regardless of importer (MapGL + satellites/satelliteLayer both pull it in). Mock at package level.
vi.mock('maplibre-gl', () => ({ default: {} }));
// MapGL is a WebGL globe — cannot mount in jsdom — so it's fully replaced. `validCoord` is
// reimplemented (mirroring the real pure impl) since refreshCameras filters on it at mount.
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

function railProps(over: Partial<CommandRailProps> = {}): CommandRailProps {
  return {
    visibleItems: [strike],
    corroboration: new Map(),
    onFocus: vi.fn(),
    categoryFilter: new Set(['chatter']),
    onToggleCategory: vi.fn(),
    basemap: 'street',
    onBasemap: vi.fn(),
    labels: false,
    onLabels: vi.fn(),
    net: false,
    pinned: new Set<string>(),
    onAddMonitor: vi.fn(),
    onRemoveMonitor: vi.fn(),
    onViewDetails: vi.fn(),
    ...over
  };
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
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettings.setState({ settings: null });
  vi.restoreAllMocks();
});

describe('CommandRail — View details context-menu entry', () => {
  beforeEach(() => {
    // A settings object so LiveNewsPanel/NewsFeedControls render their placeholder without crashing;
    // no streams + network off ⇒ the news panel loads nothing.
    useSettings.setState({ settings: { ...defaultSettings, geoint: { ...defaultSettings.geoint, networkEnabled: false, newsStreams: [] } } });
    installApi([strike]);
  });

  it('renders "View details" in the row context menu and calls onViewDetails(id) on click', () => {
    const onViewDetails = vi.fn();
    act(() => root.render(<CommandRail {...railProps({ onViewDetails })} />));

    // The Situation Feed row for the item.
    const row = Array.from(container.querySelectorAll('li')).find((li) => (li.textContent ?? '').includes('Coordinated strike near Mosul'));
    expect(row, 'situation-feed row present').toBeTruthy();

    // Right-click opens the context menu.
    act(() => { row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); });
    const viewDetails = findByText(container, 'View details');
    expect(viewDetails, '"View details" menu entry present').toBeTruthy();

    act(() => { viewDetails!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onViewDetails).toHaveBeenCalledWith('wartracker:1');
  });

  it('still offers Add to Monitor in the same menu (existing behavior preserved)', () => {
    act(() => root.render(<CommandRail {...railProps()} />));
    const row = Array.from(container.querySelectorAll('li')).find((li) => (li.textContent ?? '').includes('Coordinated strike near Mosul'));
    act(() => { row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); });
    expect(findByText(container, 'Add to Monitor')).toBeTruthy();
  });
});

describe('GeoIntModule — EventDetailsPanel opens on selection', () => {
  beforeEach(() => {
    useSettings.setState({ settings: { ...defaultSettings, geoint: { ...defaultSettings.geoint, networkEnabled: false, newsStreams: [] } } });
    installApi([strike]);
  });

  it('renders no EventDetailsPanel until an event is selected, then opens it via "View details"', async () => {
    await act(async () => { root.render(<GeoIntModule />); });
    await flush();

    // No panel before selection.
    expect(container.querySelector('.ga98-geo-details')).toBeNull();

    // Right-click the Situation Feed row → View details. Scope to the command rail: the left pane
    // also has an "Events" list rendering the same title, but only the rail row carries the menu.
    const rail = container.querySelector('.ga98-geo-rail')!;
    expect(rail, 'command rail present').toBeTruthy();
    const row = Array.from(rail.querySelectorAll('li')).find((li) => (li.textContent ?? '').includes('Coordinated strike near Mosul'));
    expect(row, 'situation-feed row present').toBeTruthy();
    await act(async () => { row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); });
    const viewDetails = findByText(container, 'View details');
    expect(viewDetails, '"View details" entry present').toBeTruthy();
    await act(async () => { viewDetails!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();

    // The panel is now open and shows the selected item's real data.
    const panel = container.querySelector('.ga98-geo-details');
    expect(panel, 'EventDetailsPanel open after selection').toBeTruthy();
    expect(panel!.textContent).toContain('Coordinated strike near Mosul');

    // Closing it (✕) hides it again.
    const closeBtn = Array.from(panel!.querySelectorAll('button')).find((b) => /^[×✕x]$/.test((b.textContent ?? '').trim()));
    expect(closeBtn, 'close button present').toBeTruthy();
    await act(async () => { closeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    expect(container.querySelector('.ga98-geo-details')).toBeNull();
  });
});

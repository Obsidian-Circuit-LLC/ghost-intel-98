// @vitest-environment jsdom
/**
 * Task 3: Stop the whole-block clobber in patchGeo / patchNews.
 *
 * `settingsStore.update` deep-merges (`mergeSettings(cur, patch)`; the `geoint` sub-object is
 * itself spread-merged at json-fs.ts:935), so sending ONLY the changed sub-field is safe and
 * cannot overwrite siblings. `GeoIntModule`'s `patchGeo` and `NewsFeedControls`' `patchNews`
 * used to re-send the WHOLE reconstructed geoint block on every write, sourced from the
 * renderer's own (possibly stale) cache — a stale cache write could clobber a sibling field a
 * different window/tab had just changed. Fixed: send only the field(s) that actually changed.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act(), mirroring
 * news-feed-shared.test.tsx / hostinfo-view.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GeoIntModule } from '../src/renderer/modules/geoint/GeoIntModule';
import { NewsFeedControls } from '../src/renderer/modules/geoint/NewsFeedControls';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';

// `maplibre-gl`'s package entry calls `window.URL.createObjectURL(...)` at module-load time
// (worker bootstrap) — throws under jsdom regardless of which file imports it. MapGL.tsx AND
// satellites/satelliteLayer.ts (pulled in by SpaceSatellitesPanel, always rendered) both import
// it, so it must be mocked at the package level (mirroring geoint-mapgl.test.ts), not per-file.
vi.mock('maplibre-gl', () => ({ default: {} }));

// MapGL itself is a MapLibre GL (WebGL) globe — cannot render/mount in jsdom even with the
// package stubbed above — so it's fully replaced. `validCoord` is reimplemented (mirroring the
// real, pure implementation) since `refreshCameras` filters on it at mount.
vi.mock('../src/renderer/modules/geoint/MapGL', () => ({
  MapGL: () => null,
  validCoord: (lat: number | null | undefined, lon: number | null | undefined): boolean =>
    lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}));

let container: HTMLDivElement;
let root: Root;
let settingsUpdate: ReturnType<typeof vi.fn>;

function installApi(): void {
  // settings.update backs the store's patch(): return the merged settings the way main's
  // mergeSettings would (deep-merging the geoint sub-object), so a stale full-block re-send
  // would be indistinguishable from a partial one at the STORE level — the property under test
  // is the shape of the PATCH PAYLOAD itself, asserted via settingsUpdate.mock.calls.
  settingsUpdate = vi.fn().mockImplementation(async (patch: Record<string, unknown>) => {
    const cur = useSettings.getState().settings!;
    return { ...cur, ...patch, geoint: { ...cur.geoint, ...(patch.geoint as object) } };
  });
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    settings: { update: settingsUpdate },
    geoint: {
      snapshot: vi.fn().mockResolvedValue({ sources: [], items: [] }),
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
  installApi();
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

describe('GeoIntModule — patchGeo sends only the changed field(s)', () => {
  it('clicking Satellite patches ONLY basemap, not the other geoint fields', async () => {
    useSettings.setState({
      settings: {
        ...defaultSettings,
        geoint: {
          ...defaultSettings.geoint,
          networkEnabled: true,
          basemap: 'street',
          newsStreams: [{ label: 'Bloomberg TV', url: 'https://www.bloomberg.com/media-manifest/streams/us.m3u8', kind: 'hls' }],
          newsStreamIndex: 0,
          cctvOverTor: true,
          cctvResolveHosts: true
        }
      }
    });
    await act(async () => { root.render(<GeoIntModule />); });
    await flush();

    const satelliteButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Satellite') as HTMLButtonElement;
    expect(satelliteButton).toBeTruthy();
    await act(async () => { satelliteButton.click(); });
    await flush();

    const patchCalls = settingsUpdate.mock.calls as Array<[{ geoint?: Record<string, unknown> }]>;
    const basemapPatch = patchCalls.find(([p]) => p.geoint && 'basemap' in p.geoint);
    expect(basemapPatch).toBeTruthy();
    const geoint = basemapPatch![0].geoint!;
    expect(geoint).toEqual({ basemap: 'satellite' });
    // The stale-cache siblings must NOT be re-sent.
    expect(geoint).not.toHaveProperty('newsStreams');
    expect(geoint).not.toHaveProperty('newsStreamIndex');
    expect(geoint).not.toHaveProperty('cctvOverTor');
    expect(geoint).not.toHaveProperty('cctvResolveHosts');
  });
});

describe('NewsFeedControls — patchNews sends only the changed field(s)', () => {
  it('addStream patches ONLY newsStreams/newsStreamIndex, not the rest of the geoint block', async () => {
    useSettings.setState({
      settings: {
        ...defaultSettings,
        geoint: {
          ...defaultSettings.geoint,
          networkEnabled: true,
          tileServerUrl: 'https://stale.example.com/{z}/{x}/{y}',
          basemap: 'satellite',
          cctvOverTor: true,
          cctvResolveHosts: false,
          newsStreams: [{ label: 'Bloomberg TV', url: 'https://www.bloomberg.com/media-manifest/streams/us.m3u8', kind: 'hls' }],
          newsStreamIndex: 0
        }
      }
    });
    await act(async () => { root.render(<NewsFeedControls />); });
    await flush();

    const labelInput = container.querySelector('input.ga98-text[placeholder="Label"]') as HTMLInputElement;
    const urlInput = container.querySelector('input.ga98-text:not([placeholder="Label"])') as HTMLInputElement;
    const addButton = Array.from(container.querySelectorAll('button')).find((b) => /Add stream/i.test(b.textContent ?? '')) as HTMLButtonElement;

    function typeInto(el: HTMLInputElement, value: string): void {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    await act(async () => {
      typeInto(labelInput, 'Al Jazeera English');
      typeInto(urlInput, 'https://example.com/live/aje.m3u8');
    });
    await flush();
    await act(async () => { addButton.click(); });
    await flush();

    expect(settingsUpdate).toHaveBeenCalledTimes(1);
    const payload = settingsUpdate.mock.calls[0][0] as { geoint: Record<string, unknown> };
    expect(payload.geoint).toHaveProperty('newsStreams');
    expect(payload.geoint).toHaveProperty('newsStreamIndex');
    // The stale-cache siblings must NOT be re-sent.
    expect(payload.geoint).not.toHaveProperty('networkEnabled');
    expect(payload.geoint).not.toHaveProperty('tileServerUrl');
    expect(payload.geoint).not.toHaveProperty('basemap');
    expect(payload.geoint).not.toHaveProperty('cctvOverTor');
    expect(payload.geoint).not.toHaveProperty('cctvResolveHosts');
    expect(Object.keys(payload.geoint).sort()).toEqual(['newsStreamIndex', 'newsStreams']);
  });

  it('removeStream patches ONLY newsStreams/newsStreamIndex', async () => {
    useSettings.setState({
      settings: {
        ...defaultSettings,
        geoint: {
          ...defaultSettings.geoint,
          basemap: 'satellite',
          cctvOverTor: true,
          newsStreams: [
            { label: 'Bloomberg TV', url: 'https://a.example.com/a.m3u8', kind: 'hls' },
            { label: 'Sky News', url: 'https://b.example.com/b.m3u8', kind: 'hls' }
          ],
          newsStreamIndex: 1
        }
      }
    });
    await act(async () => { root.render(<NewsFeedControls />); });
    await flush();

    const removeButton = Array.from(container.querySelectorAll('button')).find((b) => b.title === 'Remove this stream') as HTMLButtonElement;
    await act(async () => { removeButton.click(); });
    await flush();

    expect(settingsUpdate).toHaveBeenCalledTimes(1);
    const payload = settingsUpdate.mock.calls[0][0] as { geoint: Record<string, unknown> };
    expect(Object.keys(payload.geoint).sort()).toEqual(['newsStreamIndex', 'newsStreams']);
  });
});

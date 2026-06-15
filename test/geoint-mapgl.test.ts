// @vitest-environment jsdom
/**
 * GeoINT MapLibre globe (Tasks R1 + R2). MapLibre is WebGL — it cannot render in jsdom — so
 * `maplibre-gl` is mocked with a fake Map that records its constructor opts and `setStyle` calls.
 * The repo has no React renderer test infra (no @testing-library/react; the vitest include glob is
 * *.test.ts only), so rather than mount the component we drive the extracted helpers
 * (`createGlobeMap`, `buildStyle`) directly.
 *
 * R1 locked in: a GLOBE projection is requested and the map exposes `remove()`.
 * R2 adds: the egress gate (no raster/network sources when tilesEnabled is false; the active
 * basemap raster source present when true), label overlays, and the globe⇄flat projection switch
 * (carried in the style's projection field, which setStyle re-applies).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Record every Map construction + setStyle call so the test can inspect what the helpers passed.
const constructed: Array<Record<string, unknown>> = [];
const setStyles: Array<Record<string, unknown>> = [];

vi.mock('maplibre-gl', () => {
  class FakeMap {
    opts: Record<string, unknown>;
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      constructed.push(opts);
    }
    addControl(): void {}
    on(): void {}
    setStyle(style: Record<string, unknown>): void { setStyles.push(style); }
    setProjection(): void {}
    remove(): void {}
  }
  // The component also imports the CSS and the default export; provide a default with Map on it.
  return { default: { Map: FakeMap }, Map: FakeMap };
});

// CSS import in MapGL.tsx — stub so the bare `import 'maplibre-gl/dist/maplibre-gl.css'` resolves.
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

import { createGlobeMap, buildStyle, MapGL } from '../src/renderer/modules/geoint/MapGL';

type TestStyle = {
  version: number;
  projection?: { type?: string };
  sources: Record<string, { type?: string; tiles?: string[] }>;
  layers: Array<{ id: string; type: string; source?: string }>;
};

const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

describe('GeoINT MapGL globe (R1)', () => {
  beforeEach(() => {
    constructed.length = 0;
    setStyles.length = 0;
  });

  it('requests a 3D globe projection on init', () => {
    const container = document.createElement('div');
    createGlobeMap(container);
    expect(constructed).toHaveLength(1);
    // In MapLibre v5 the globe projection is carried in the style, not MapOptions.
    const style = constructed[0].style as TestStyle;
    expect(style.projection?.type).toBe('globe');
  });

  it('mounts into the given container with attribution and a world view', () => {
    const container = document.createElement('div');
    createGlobeMap(container);
    const opts = constructed[0];
    expect(opts.container).toBe(container);
    // Attribution control left on (MapLibre takes options/`false`, not a boolean) — anything
    // other than an explicit `false` means the credit is shown.
    expect(opts.attributionControl).not.toBe(false);
    expect(opts.center).toEqual([0, 20]);
    expect(typeof opts.zoom).toBe('number');
  });

  it('returns a map whose remove() the unmount cleanup can call', () => {
    const map = createGlobeMap(document.createElement('div'));
    expect(typeof (map as unknown as { remove: unknown }).remove).toBe('function');
    expect(() => (map as unknown as { remove: () => void }).remove()).not.toThrow();
  });

  it('exports the MapGL component as a function', () => {
    expect(typeof MapGL).toBe('function');
  });
});

describe('GeoINT MapGL gated raster basemap (R2)', () => {
  it('carries a dark background and no network sources when the gate is off', () => {
    const style = buildStyle({ projection: 'globe', tilesEnabled: false, tileUrl: SAT_URL }) as unknown as TestStyle;
    // No sources at all → no tile fetch, blank globe, exactly like MapPane with the gate off.
    expect(Object.keys(style.sources)).toHaveLength(0);
    expect(style.layers).toHaveLength(1);
    expect(style.layers[0].type).toBe('background');
  });

  it('omits network sources when enabled but no basemap URL is set', () => {
    const style = buildStyle({ projection: 'globe', tilesEnabled: true, tileUrl: '' }) as unknown as TestStyle;
    expect(Object.keys(style.sources)).toHaveLength(0);
  });

  it('adds the active basemap raster source+layer when the gate is open', () => {
    const style = buildStyle({ projection: 'globe', tilesEnabled: true, tileUrl: SAT_URL, tileAttribution: '© Esri' }) as unknown as TestStyle;
    const src = style.sources['geoint-basemap'];
    expect(src).toBeDefined();
    expect(src.type).toBe('raster');
    expect(src.tiles).toEqual([SAT_URL]);
    // A raster layer drawn over the background references that source.
    const rasterLayers = style.layers.filter((l) => l.type === 'raster');
    expect(rasterLayers.some((l) => l.source === 'geoint-basemap')).toBe(true);
  });

  it('adds label overlay sources/layers on top only when the gate is open', () => {
    const overlays = ['https://o0/{z}/{y}/{x}', 'https://o1/{z}/{y}/{x}'];
    const on = buildStyle({ projection: 'globe', tilesEnabled: true, tileUrl: SAT_URL, overlayUrls: overlays }) as unknown as TestStyle;
    expect(on.sources['geoint-overlay-0']?.tiles).toEqual([overlays[0]]);
    expect(on.sources['geoint-overlay-1']?.tiles).toEqual([overlays[1]]);
    // basemap layer first, overlays stacked above it.
    const ids = on.layers.map((l) => l.id);
    expect(ids.indexOf('geoint-basemap-layer')).toBeLessThan(ids.indexOf('geoint-overlay-layer-0'));

    const off = buildStyle({ projection: 'globe', tilesEnabled: false, tileUrl: SAT_URL, overlayUrls: overlays }) as unknown as TestStyle;
    expect(Object.keys(off.sources)).toHaveLength(0);
  });

  it('flips the requested projection between globe and mercator', () => {
    const globe = buildStyle({ projection: 'globe' }) as unknown as TestStyle;
    const flat = buildStyle({ projection: 'mercator' }) as unknown as TestStyle;
    expect(globe.projection?.type).toBe('globe');
    expect(flat.projection?.type).toBe('mercator');
  });

  it('honours the gate on first paint via createGlobeMap initial style', () => {
    createGlobeMap(document.createElement('div'), { projection: 'globe', tilesEnabled: false, tileUrl: SAT_URL });
    const style = constructed[constructed.length - 1].style as TestStyle;
    expect(Object.keys(style.sources)).toHaveLength(0);
  });
});

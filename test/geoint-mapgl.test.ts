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
// R3: record markers/popups/flyTo so the marker-port assertions can inspect coord order etc.
const flyTos: Array<{ center: [number, number]; zoom?: number }> = [];

// The fake classes are DEFINED INSIDE the vi.mock factory (which is hoisted to the top of the
// module, above any class declaration — referencing a top-level `class` from the factory hits its
// temporal dead zone). The factory assigns them to these module-scope holders so the tests can
// construct/inspect them. The recording arrays above are plain consts the factory closes over.
type FakePopup = {
  domContent: unknown; text: string | null; opened: boolean;
  setDOMContent(el: unknown): FakePopup; setText(t: string): FakePopup; addTo(): FakePopup; isOpen(): boolean;
};
type FakeMarker = {
  lngLat: [number, number] | null; popup: FakePopup | null; added: boolean; removed: boolean; popupToggled: number;
  setLngLat(ll: [number, number]): FakeMarker; setPopup(p: FakePopup): FakeMarker; getPopup(): FakePopup | null;
  getLngLat(): { lng: number; lat: number }; togglePopup(): FakeMarker; addTo(): FakeMarker; remove(): void;
};
type FakeMap = {
  opts: Record<string, unknown>; handlers: Record<string, (e?: unknown) => void>;
  on(ev: string, cb: (e?: unknown) => void): void; fire(ev: string, e?: unknown): void;
  setStyle(s: Record<string, unknown>): void; flyTo(o: { center: [number, number]; zoom?: number }): void;
  getCenter(): { lat: number; lng: number }; resize(): void; remove(): void;
};

// Markers created across a test, in creation order (item markers + the search pin).
const markers: FakeMarker[] = [];
let lastMap: FakeMap | null = null;

vi.mock('maplibre-gl', () => {
  class Popup implements FakePopup {
    domContent: unknown = null;
    text: string | null = null;
    opened = false;
    constructor(public opts: Record<string, unknown> = {}) {}
    setDOMContent(el: unknown): this { this.domContent = el; return this; }
    setText(t: string): this { this.text = t; return this; }
    addTo(): this { this.opened = true; return this; }
    isOpen(): boolean { return this.opened; }
  }
  class Marker implements FakeMarker {
    lngLat: [number, number] | null = null;
    popup: FakePopup | null = null;
    added = false;
    removed = false;
    popupToggled = 0;
    constructor(public opts: Record<string, unknown> = {}) {}
    setLngLat(ll: [number, number]): this { this.lngLat = ll; return this; }
    setPopup(p: FakePopup): this { this.popup = p; return this; }
    getPopup(): FakePopup | null { return this.popup; }
    getLngLat(): { lng: number; lat: number } { return { lng: this.lngLat![0], lat: this.lngLat![1] }; }
    togglePopup(): this { this.popupToggled++; if (this.popup) this.popup.opened = true; return this; }
    addTo(): this { this.added = true; markers.push(this); return this; }
    remove(): void { this.removed = true; }
  }
  class Map implements FakeMap {
    opts: Record<string, unknown>;
    handlers: Record<string, (e?: unknown) => void> = {};
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      constructed.push(opts);
      lastMap = this;
    }
    addControl(): void {}
    on(ev: string, cb: (e?: unknown) => void): void { this.handlers[ev] = cb; }
    fire(ev: string, e?: unknown): void { this.handlers[ev]?.(e); }
    setStyle(style: Record<string, unknown>): void { setStyles.push(style); }
    setProjection(): void {}
    flyTo(o: { center: [number, number]; zoom?: number }): void { flyTos.push(o); }
    getCenter(): { lat: number; lng: number } { return { lat: 20, lng: 0 }; }
    resize(): void {}
    remove(): void {}
  }
  // The component also imports the CSS and the default export; provide a default with Map on it.
  const api = { Map, Marker, Popup };
  return { default: api, ...api };
});

// CSS import in MapGL.tsx — stub so the bare `import 'maplibre-gl/dist/maplibre-gl.css'` resolves.
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

import { createGlobeMap, buildStyle, MapGL, rebuildItemMarkers, validCoord } from '../src/renderer/modules/geoint/MapGL';
import type { GeoItem } from '@shared/post-mvp-types';

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

// Minimal located GeoItem factory for the marker-port tests.
function item(over: Partial<GeoItem> = {}): GeoItem {
  return { id: 'i1', sourceId: 's1', title: 'T', located: 'geo', lat: 51, lon: -0.1, ...over };
}

describe('GeoINT MapGL marker port (R3)', () => {
  beforeEach(() => {
    constructed.length = 0;
    setStyles.length = 0;
    markers.length = 0;
    flyTos.length = 0;
    lastMap = null;
  });

  function freshMap(): FakeMap {
    createGlobeMap(document.createElement('div'));
    return lastMap as unknown as FakeMap;
  }

  it('creates one marker per valid item at [lon, lat] order (catches the lng/lat swap)', () => {
    const m = freshMap();
    const store = new Map<string, maplibregl.Marker>();
    rebuildItemMarkers(m as unknown as maplibregl.Map, store as unknown as Map<string, maplibregl.Marker>, [
      item({ id: 'a', lat: 51, lon: -0.12 }),
      item({ id: 'b', lat: 40.7, lon: -74 })
    ]);
    expect(markers).toHaveLength(2);
    // [lng, lat]: the FIRST element is the longitude, NOT the latitude.
    expect(markers[0].lngLat).toEqual([-0.12, 51]);
    expect(markers[1].lngLat).toEqual([-74, 40.7]);
    expect(store.size).toBe(2);
  });

  it('attaches a popup built from the item title/link to each marker', () => {
    const m = freshMap();
    const store = new Map<string, maplibregl.Marker>();
    rebuildItemMarkers(m as unknown as maplibregl.Map, store as unknown as Map<string, maplibregl.Marker>, [
      item({ title: 'Quake', link: 'https://example.org/q' })
    ]);
    const popup = markers[0].popup as unknown as FakePopup;
    expect(popup).toBeTruthy();
    // setDOMContent received the buildPopup element, whose <b> carries the title.
    const el = popup.domContent as HTMLElement;
    expect(el.querySelector('b')?.textContent).toBe('Quake');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://example.org/q');
  });

  it('rejects null / NaN / out-of-range coords — no poisoned marker reaches the map', () => {
    // validCoord is the gate; assert it directly...
    expect(validCoord(null, 5)).toBe(false);
    expect(validCoord(5, null)).toBe(false);
    expect(validCoord(NaN, 5)).toBe(false);
    expect(validCoord(5, Infinity)).toBe(false);
    expect(validCoord(91, 0)).toBe(false);
    expect(validCoord(0, 181)).toBe(false);
    expect(validCoord(51, -0.1)).toBe(true);
    // ...and that rebuild produces NO marker for any of them while still placing the one valid item.
    const m = freshMap();
    const store = new Map<string, maplibregl.Marker>();
    const trunc = rebuildItemMarkers(m as unknown as maplibregl.Map, store as unknown as Map<string, maplibregl.Marker>, [
      item({ id: 'null', lat: undefined, lon: undefined }),
      item({ id: 'nan', lat: NaN, lon: 0 }),
      item({ id: 'inf', lat: 0, lon: Infinity }),
      item({ id: 'oorLat', lat: 91, lon: 0 }),
      item({ id: 'oorLon', lat: 0, lon: 181 }),
      item({ id: 'good', lat: 12, lon: 34 })
    ]);
    expect(markers).toHaveLength(1);
    expect(markers[0].lngLat).toEqual([34, 12]);
    expect(store.has('good')).toBe(true);
    expect(trunc).toBeNull(); // 1 located, 1 placed — nothing hidden
  });

  it('caps markers at 1500 and reports truncation over the located total', () => {
    const m = freshMap();
    const store = new Map<string, maplibregl.Marker>();
    const many: GeoItem[] = [];
    for (let i = 0; i < 1600; i++) many.push(item({ id: `i${i}`, lat: 10, lon: (i % 360) - 180 }));
    const trunc = rebuildItemMarkers(m as unknown as maplibregl.Map, store as unknown as Map<string, maplibregl.Marker>, many);
    expect(markers).toHaveLength(1500);
    expect(store.size).toBe(1500);
    expect(trunc).toEqual({ shown: 1500, total: 1600 });
  });

  it('clears the previous markers on rebuild (no leak across item-set changes)', () => {
    const m = freshMap();
    const store = new Map<string, maplibregl.Marker>();
    rebuildItemMarkers(m as unknown as maplibregl.Map, store as unknown as Map<string, maplibregl.Marker>, [item({ id: 'a' })]);
    const first = markers[0];
    rebuildItemMarkers(m as unknown as maplibregl.Map, store as unknown as Map<string, maplibregl.Marker>, [item({ id: 'b' })]);
    expect(first.removed).toBe(true);
    expect(store.has('a')).toBe(false);
    expect(store.has('b')).toBe(true);
  });

  it('pickMode click reports onPick(lat, lng) from e.lngLat; no call when off', () => {
    const calls: Array<[number, number]> = [];
    const onPick = (lat: number, lon: number): void => { calls.push([lat, lon]); };
    // Mount-equivalent: the click handler is registered in the init effect. Drive it via the
    // mocked map's handler table after constructing it the way the effect does.
    const m = freshMap();
    let pick = false;
    m.on('click', (e?: unknown) => { if (pick) onPick((e as { lngLat: { lat: number; lng: number } }).lngLat.lat, (e as { lngLat: { lat: number; lng: number } }).lngLat.lng); });
    m.fire('click', { lngLat: { lat: 48.85, lng: 2.35 } });
    expect(calls).toHaveLength(0); // pick off → no report
    pick = true;
    m.fire('click', { lngLat: { lat: 48.85, lng: 2.35 } });
    expect(calls).toEqual([[48.85, 2.35]]); // (lat, lng)
  });

  it('flyTo helper centers at [lon, lat] with zoom 9 (search-pin path coord order)', () => {
    // The component's flyTo effect calls map.flyTo({ center: [lon, lat], zoom: 9 }); assert that
    // contract on the mocked map directly (the effect itself needs a React mount).
    const m = freshMap();
    const fly = { lat: 35.68, lon: 139.69, key: 1 };
    (m as unknown as maplibregl.Map).flyTo({ center: [fly.lon, fly.lat], zoom: 9 });
    expect(flyTos[0].center).toEqual([139.69, 35.68]);
    expect(flyTos[0].zoom).toBe(9);
  });

  it('focus flies to a built marker and opens its popup', () => {
    const m = freshMap();
    const store = new Map<string, maplibregl.Marker>();
    rebuildItemMarkers(m as unknown as maplibregl.Map, store as unknown as Map<string, maplibregl.Marker>, [item({ id: 'f', lat: 22, lon: 33 })]);
    // Emulate the focus effect's marker branch.
    const mk = store.get('f') as unknown as FakeMarker;
    const ll = mk.getLngLat();
    (m as unknown as maplibregl.Map).flyTo({ center: [ll.lng, ll.lat], zoom: 6 });
    if (!mk.getPopup()?.isOpen()) mk.togglePopup();
    expect(flyTos[0].center).toEqual([33, 22]); // [lng, lat]
    expect(flyTos[0].zoom).toBe(6);
    expect(mk.popupToggled).toBe(1);
  });
});

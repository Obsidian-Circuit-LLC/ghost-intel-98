// @vitest-environment jsdom
/**
 * GeoINT events render on the GPU, not as one DOM node per event.
 *
 * WHY: `rebuildItemMarkers` created one `maplibregl.Marker` + one DOM element + one `Popup` object
 * per located event. DOM element count is the map's dominant cost and it scales linearly with the
 * event cache — the CPU load reported from the field, which normalised when the timeline was
 * narrowed (i.e. when there were fewer markers). A marker here is not a rich widget: it is a
 * coloured circle sized by severity, tinted by category, with a white ring and a bloom when the
 * event is corroborated. That is exactly what a MapLibre `circle` layer draws on the GPU from a
 * single GeoJSON source — no sprite, no icon atlas, no per-item DOM.
 *
 * The invariants that used to live on the marker path must survive the move:
 *   - the STRICT coord gate (no NaN/Infinity/out-of-range/null ever placed; no silent (0,0) pins)
 *   - an honest truncation readout when a cap hides located events
 *   - click → `onSelect(id)` for the Event Details dossier
 *   - popup CONTENT built on open, never eagerly for events that are never clicked
 *
 * MapLibre is WebGL and cannot render in jsdom, so `maplibre-gl` is mocked with a fake Map that
 * records addSource/addLayer/setData and layer-scoped click handlers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeSource {
  id: string;
  data: { type: string; features: Array<Record<string, unknown>> };
  setData(d: FakeSource['data']): void;
}

const addedSources: Array<{ id: string; spec: Record<string, unknown> }> = [];
const addedLayers: Array<Record<string, unknown>> = [];
const markerConstructions: number[] = [];
const popupConstructions: number[] = [];
let lastPopup: { domContent: unknown } | null = null;

vi.mock('maplibre-gl', () => {
  class Popup {
    domContent: unknown = null;
    lngLat: [number, number] | null = null;
    handlers: Record<string, Array<() => void>> = {};
    constructor(public opts: Record<string, unknown> = {}) {
      popupConstructions.push(1);
      lastPopup = this;
    }
    setDOMContent(el: unknown): this { this.domContent = el; return this; }
    setLngLat(ll: [number, number]): this { this.lngLat = ll; return this; }
    addTo(): this { return this; }
    remove(): this { return this; }
    on(event: string, cb: () => void): this { (this.handlers[event] ||= []).push(cb); return this; }
  }
  class Marker {
    constructor(public opts: Record<string, unknown> = {}) { markerConstructions.push(1); }
    setLngLat(): this { return this; }
    setPopup(): this { return this; }
    addTo(): this { return this; }
    remove(): void {}
  }
  class Map {
    // A plain record, NOT a `new Map()` — inside this factory the identifier `Map` resolves to the
    // fake class being declared, so `new Map()` would recurse until the stack blows.
    sources: Record<string, FakeSource> = {};
    /** `on(event, cb)` and `on(event, layerId, cb)` are both used by MapLibre. */
    handlers: Record<string, (e?: unknown) => void> = {};
    layerHandlers: Record<string, (e?: unknown) => void> = {};
    styleLoaded = true;
    constructor(public opts: Record<string, unknown> = {}) {}
    isStyleLoaded(): boolean { return this.styleLoaded; }
    addControl(): void {}
    on(ev: string, a?: unknown, b?: unknown): void {
      if (typeof a === 'string' && typeof b === 'function') this.layerHandlers[`${ev}:${a}`] = b as () => void;
      else if (typeof a === 'function') this.handlers[ev] = a as () => void;
    }
    fireLayer(ev: string, layer: string, e?: unknown): void { this.layerHandlers[`${ev}:${layer}`]?.(e); }
    getSource(id: string): FakeSource | undefined { return this.sources[id]; }
    addSource(id: string, spec: Record<string, unknown>): void {
      addedSources.push({ id, spec });
      const src: FakeSource = {
        id,
        data: spec.data as FakeSource['data'],
        setData(d) { this.data = d; },
      };
      this.sources[id] = src;
    }
    getLayer(id: string): Record<string, unknown> | undefined {
      return addedLayers.find((l) => l.id === id);
    }
    addLayer(spec: Record<string, unknown>): void { addedLayers.push(spec); }
    removeLayer(): void {}
    removeSource(): void {}
    setStyle(): void {}
    setProjection(): void {}
    flyTo(): void {}
    getCenter(): { lat: number; lng: number } { return { lat: 0, lng: 0 }; }
    getCanvas(): { style: Record<string, string> } { return { style: {} }; }
    resize(): void {}
    remove(): void {}
  }
  const api = { Map, Marker, Popup };
  return { default: api, ...api };
});

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

import maplibregl from 'maplibre-gl';
import { syncItemLayer, EVENTS_SOURCE, EVENTS_LAYER } from '../src/renderer/modules/geoint/MapGL';
import type { GeoItem } from '../src/renderer/modules/geoint/types';

function item(over: Partial<GeoItem> = {}): GeoItem {
  return {
    id: 'i1', title: 'Event', link: 'https://example.org/a', source: 'src',
    publishedAt: '2026-08-01T00:00:00.000Z', lat: 10, lon: 20,
    category: 'conflict', severity: 'high',
    ...over,
  } as GeoItem;
}

function newMap() {
  return new (maplibregl as unknown as { Map: new (o?: Record<string, unknown>) => any }).Map({});
}

/** The DOM content set on the most recently constructed popup. */
function lastPopupContent(): HTMLElement | null {
  return (lastPopup?.domContent as HTMLElement) ?? null;
}

function featuresOf(map: any) {
  return map.getSource(EVENTS_SOURCE)?.data.features ?? [];
}

describe('GeoINT events are drawn by the GPU, not by DOM markers', () => {
  beforeEach(() => {
    addedSources.length = 0;
    addedLayers.length = 0;
    markerConstructions.length = 0;
    popupConstructions.length = 0;
  });

  it('creates ONE source for many events and constructs NO per-event markers', () => {
    const map = newMap();
    const items = Array.from({ length: 250 }, (_, i) => item({ id: `e${i}`, lat: 1 + i * 0.01, lon: 2 }));
    syncItemLayer(map, items);
    expect(addedSources.filter((s) => s.id === EVENTS_SOURCE)).toHaveLength(1);
    expect(featuresOf(map)).toHaveLength(250);
    // The whole point: no DOM node per event.
    expect(markerConstructions).toHaveLength(0);
    // …and no popup object per event either (one shared popup is created on demand).
    expect(popupConstructions.length).toBeLessThanOrEqual(1);
  });

  it('updates the existing source on a resync instead of adding a second one', () => {
    const map = newMap();
    syncItemLayer(map, [item({ id: 'a' })]);
    syncItemLayer(map, [item({ id: 'b' }), item({ id: 'c' })]);
    expect(addedSources.filter((s) => s.id === EVENTS_SOURCE)).toHaveLength(1);
    const ids = featuresOf(map).map((f: any) => f.properties.id);
    expect(ids).toEqual(['b', 'c']);
  });

  it('never places a poisoned or unlocated event (no silent (0,0) pins)', () => {
    const map = newMap();
    syncItemLayer(map, [
      item({ id: 'ok' }),
      item({ id: 'nan', lat: Number.NaN }),
      item({ id: 'inf', lon: Number.POSITIVE_INFINITY }),
      item({ id: 'null', lat: null as unknown as number }),
      item({ id: 'range', lat: 91 }),
    ]);
    expect(featuresOf(map).map((f: any) => f.properties.id)).toEqual(['ok']);
  });

  it('carries the styling inputs as feature properties so paint stays data-driven', () => {
    const map = newMap();
    syncItemLayer(map, [item({ id: 'a', severity: 'high', category: 'cyber' })], new Map([['a', 3]]));
    const f = featuresOf(map)[0] as any;
    expect(f.geometry.coordinates).toEqual([20, 10]); // [lng, lat] — GeoJSON order, not Leaflet's
    expect(f.properties.color).toBe('#8e44ad'); // CATEGORY_COLOR.cyber
    expect(f.properties.r).toBe(9); // severityDiameter('high') / 2
    expect(f.properties.count).toBe(3);
  });

  it('reports truncation honestly when a cap hides located events', () => {
    const map = newMap();
    const many = Array.from({ length: 20100 }, (_, i) => item({ id: `e${i}`, lat: 1, lon: 2 }));
    const trunc = syncItemLayer(map, many);
    expect(trunc).not.toBeNull();
    expect(trunc!.total).toBe(20100);
    expect(trunc!.shown).toBeLessThan(trunc!.total);
    expect(featuresOf(map)).toHaveLength(trunc!.shown);
  });

  it('returns null when nothing was hidden', () => {
    const map = newMap();
    expect(syncItemLayer(map, [item({ id: 'a' })])).toBeNull();
  });

  it('opens the Event Details dossier for the clicked feature', () => {
    const map = newMap();
    const picked: string[] = [];
    syncItemLayer(map, [item({ id: 'a' }), item({ id: 'b' })], undefined, undefined, (id) => picked.push(id));
    map.fireLayer('click', EVENTS_LAYER, {
      features: [{ properties: { id: 'b', title: 'Event', link: 'https://example.org/a' }, geometry: { coordinates: [20, 10] } }],
      lngLat: { lng: 20, lat: 10 },
    });
    expect(picked).toEqual(['b']);
  });

  it('builds the popup from the clicked feature\'s title and link (XSS choke point preserved)', () => {
    const map = newMap();
    syncItemLayer(map, [item({ id: 'a', title: 'Quake', link: 'https://example.org/q' })]);
    map.fireLayer('click', EVENTS_LAYER, {
      features: [{ properties: { id: 'a', title: 'Quake', link: 'https://example.org/q' }, geometry: { coordinates: [20, 10] } }],
      lngLat: { lng: 20, lat: 10 },
    });
    // Content still goes through buildPopup — DOM nodes, never interpolated HTML.
    const el = (map as any).sources[EVENTS_SOURCE] && lastPopupContent();
    expect(el?.querySelector('b')?.textContent).toBe('Quake');
    expect(el?.querySelector('a')?.getAttribute('href')).toBe('https://example.org/q');
  });

  it('hands the popup to onPopup so single-open tracking still works', () => {
    const map = newMap();
    const seen: unknown[] = [];
    syncItemLayer(map, [item({ id: 'a' })], undefined, (p) => seen.push(p));
    map.fireLayer('click', EVENTS_LAYER, {
      features: [{ properties: { id: 'a', title: 'T', link: '' }, geometry: { coordinates: [20, 10] } }],
      lngLat: { lng: 20, lat: 10 },
    });
    expect(seen).toHaveLength(1);
    // One shared popup: clicking a second event hands back the SAME object, not a new one.
    map.fireLayer('click', EVENTS_LAYER, {
      features: [{ properties: { id: 'b', title: 'U', link: '' }, geometry: { coordinates: [21, 11] } }],
      lngLat: { lng: 21, lat: 11 },
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
  });

  it('builds popup content only when a feature is actually clicked', () => {
    const map = newMap();
    syncItemLayer(map, Array.from({ length: 50 }, (_, i) => item({ id: `e${i}` })));
    // Nothing clicked yet: no popup content has been constructed for 50 events.
    expect(popupConstructions.length).toBeLessThanOrEqual(1);
    map.fireLayer('click', EVENTS_LAYER, {
      features: [{ properties: { id: 'e0', title: 'Event', link: 'https://example.org/a' }, geometry: { coordinates: [20, 10] } }],
      lngLat: { lng: 20, lat: 10 },
    });
    expect(popupConstructions.length).toBe(1);
  });

  it('does NOT touch the map while the style is still loading', () => {
    // THE v3.73.0 CRASH. `new Marker().addTo(map)` works at any time, but addSource/addLayer throw
    // "Style is not done loading" — the same failure the satellite layer was hotfixed for in
    // v3.17.1, which is why that layer self-guards on isStyleLoaded(). Replacing the markers with a
    // GPU layer reintroduced it: the first open threw before the style settled, and because the
    // event cache is already on disk it threw again on every reopen, so the module could not be
    // recovered by closing and reopening it.
    const map = newMap();
    map.styleLoaded = false;
    expect(() => syncItemLayer(map, [item({ id: 'a' })])).not.toThrow();
    expect(addedSources.filter((s) => s.id === EVENTS_SOURCE)).toHaveLength(0);
    expect(addedLayers).toHaveLength(0);
  });

  it('applies the pending items as soon as the style becomes ready', () => {
    const map = newMap();
    map.styleLoaded = false;
    syncItemLayer(map, [item({ id: 'a' }), item({ id: 'b' })]);
    expect(featuresOf(map)).toHaveLength(0);

    // The map finishes loading and the layer lands, without the caller having to re-supply items.
    map.styleLoaded = true;
    map.handlers['load']?.();
    expect(addedSources.filter((s) => s.id === EVENTS_SOURCE)).toHaveLength(1);
    expect(featuresOf(map).map((f: any) => f.properties.id)).toEqual(['a', 'b']);
  });

  it('re-adds the layer after a style change wipes it', () => {
    // setStyle() destroys every source and layer. Without re-adding on styledata the events simply
    // vanish when the basemap or the tile gate is toggled.
    const map = newMap();
    syncItemLayer(map, [item({ id: 'a' })]);
    expect(featuresOf(map)).toHaveLength(1);

    delete map.sources[EVENTS_SOURCE];
    addedSources.length = 0;
    map.handlers['styledata']?.();
    expect(addedSources.filter((s) => s.id === EVENTS_SOURCE)).toHaveLength(1);
    expect(featuresOf(map).map((f: any) => f.properties.id)).toEqual(['a']);
  });

  it('survives a map that throws from addSource rather than taking the module down', () => {
    const map = newMap();
    map.addSource = () => { throw new Error('Style is not done loading'); };
    expect(() => syncItemLayer(map, [item({ id: 'a' })])).not.toThrow();
  });
});

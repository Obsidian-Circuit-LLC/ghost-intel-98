// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

const markers: FakeMarker[] = [];
type FakeMarker = {
  lngLat: [number, number] | null; element: HTMLElement | null; added: boolean; removed: boolean;
  setLngLat(ll: [number, number]): FakeMarker; addTo(): FakeMarker; remove(): void;
};

vi.mock('maplibre-gl', () => {
  class Marker implements FakeMarker {
    lngLat: [number, number] | null = null;
    element: HTMLElement | null = null;
    added = false;
    removed = false;
    constructor(public opts: { element?: HTMLElement } = {}) { this.element = opts.element ?? null; }
    setLngLat(ll: [number, number]): this { this.lngLat = ll; return this; }
    addTo(): this { this.added = true; markers.push(this); return this; }
    remove(): void { this.removed = true; }
  }
  const api = { Marker };
  return { default: api, ...api };
});

import { buildCameraIcon, buildClusterIcon, renderCctvLayer, syncCctvLayer, type CctvHandlers } from '../src/renderer/modules/geoint/cctvLayer';
import type { Cell } from '../src/renderer/modules/geoint/cctvCluster';
import type { CameraStream } from '../src/shared/post-mvp-types';

function cam(over: Partial<CameraStream> = {}): CameraStream {
  return { id: 'c1', label: 'Cam', url: 'http://x/a.mjpg', kind: 'mjpeg', caseId: null, addedAt: '', notes: '', ...over };
}

// Minimal fake map exposing what syncCctvLayer reads.
function fakeMap() {
  return {
    getZoom: () => 3,
    getBounds: () => ({ getWest: () => -180, getSouth: () => -85, getEast: () => 180, getNorth: () => 85 }),
    flyTo: vi.fn()
  };
}

const NOOP: CctvHandlers = { onOpen: () => {}, onCluster: () => {} };

describe('CCTV icon builders', () => {
  it('camera icon is a camera-tagged chip', () => {
    const el = buildCameraIcon();
    expect(el.getAttribute('data-cctv')).toBe('cam');
    expect(el.textContent).toBe('📷');
  });
  it('cluster icon shows the count with a raised Win98 border', () => {
    const el = buildClusterIcon(42);
    expect(el.getAttribute('data-cctv')).toBe('cluster');
    expect(el.textContent).toBe('42');
    expect(el.style.cssText).toContain('outset');
  });
});

describe('renderCctvLayer', () => {
  beforeEach(() => { markers.length = 0; });

  it('adds one marker per cell and clears the previous set on re-render', () => {
    const store = new Map();
    const cellsA: Cell[] = [
      { key: '0,0', lat: 1, lon: 2, count: 1, streamIds: ['a'], singleton: cam({ id: 'a', lat: 1, lon: 2 }) },
      { key: '1,1', lat: 3, lon: 4, count: 5, streamIds: ['b', 'c', 'd', 'e', 'f'] }
    ];
    renderCctvLayer({} as never, store, cellsA, NOOP);
    expect(markers).toHaveLength(2);
    // singleton at [lon, lat]
    expect(markers[0].lngLat).toEqual([2, 1]);
    const first = markers[0];
    renderCctvLayer({} as never, store, [], NOOP);
    expect(first.removed).toBe(true);
    expect(store.size).toBe(0);
  });

  it('routes a singleton click to onOpen(streamId) and a cluster click to onCluster(cell)', () => {
    const store = new Map();
    let opened = '';
    let clustered = '';
    const cells: Cell[] = [
      { key: '0,0', lat: 1, lon: 2, count: 1, streamIds: ['a'], singleton: cam({ id: 'a' }) },
      { key: '1,1', lat: 3, lon: 4, count: 9, streamIds: ['x'] }
    ];
    renderCctvLayer({} as never, store, cells, { onOpen: (id) => { opened = id; }, onCluster: (c) => { clustered = c.key; } });
    markers[0].element!.dispatchEvent(new MouseEvent('click'));
    markers[1].element!.dispatchEvent(new MouseEvent('click'));
    expect(opened).toBe('a');
    expect(clustered).toBe('1,1');
  });
});

describe('syncCctvLayer', () => {
  beforeEach(() => { markers.length = 0; });

  it('clears markers and returns 0 when hidden', () => {
    const store = new Map();
    const n = syncCctvLayer(fakeMap() as never, store, [cam({ id: 'a', lat: 1, lon: 2 })], false, NOOP);
    expect(n).toBe(0);
    expect(markers).toHaveLength(0);
  });

  it('clusters visible streams and renders them when shown', () => {
    const store = new Map();
    const n = syncCctvLayer(fakeMap() as never, store, [
      cam({ id: 'a', lat: 51.5, lon: -0.1 }),
      cam({ id: 'b', lat: -33.8, lon: 151.2 })
    ], true, NOOP);
    expect(n).toBe(2);
    expect(markers).toHaveLength(2);
  });
});

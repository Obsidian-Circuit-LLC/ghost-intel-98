// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const markers: Array<{ removed: boolean; lngLat: [number, number] | null }> = [];
vi.mock('maplibre-gl', () => {
  class Marker {
    lngLat: [number, number] | null = null;
    removed = false;
    constructor(public opts: { element?: HTMLElement } = {}) {}
    setLngLat(ll: [number, number]): this { this.lngLat = ll; return this; }
    addTo(): this { markers.push(this); return this; }
    remove(): void { this.removed = true; }
  }
  const api = { Marker };
  return { default: api, ...api };
});

import { syncCctvLayer } from '../src/renderer/modules/geoint/cctvLayer';
import type { CameraStream } from '../src/shared/post-mvp-types';

function cam(over: Partial<CameraStream> = {}): CameraStream {
  return { id: 'c1', label: 'Cam', url: 'http://x/a.mjpg', kind: 'mjpeg', caseId: null, addedAt: '', notes: '', ...over };
}

function mapAt(zoom: number, b = { w: -180, s: -85, e: 180, n: 85 }) {
  return {
    getZoom: () => zoom,
    getBounds: () => ({ getWest: () => b.w, getSouth: () => b.s, getEast: () => b.e, getNorth: () => b.n }),
    flyTo: vi.fn()
  };
}

describe('MapGL camera-layer sync (the moveend/zoomend delegate)', () => {
  beforeEach(() => { markers.length = 0; });

  it('renders camera markers within the current viewport and re-syncs on a viewport change', () => {
    const store = new Map();
    const handlers = { onOpen: () => {}, onCluster: () => {} };
    const streams = [cam({ id: 'lon', lat: 51.5, lon: -0.1 }), cam({ id: 'syd', lat: -33.8, lon: 151.2 })];
    // World view: both visible.
    expect(syncCctvLayer(mapAt(2) as never, store, streams, true, handlers)).toBe(2);
    // Zoom into London bounds: only the London camera survives the viewport filter.
    const n = syncCctvLayer(mapAt(10, { w: -0.5, s: 51.2, e: 0.2, n: 51.7 }) as never, store, streams, true, handlers);
    expect(n).toBe(1);
  });

  it('clears the layer when toggled off', () => {
    const store = new Map();
    syncCctvLayer(mapAt(2) as never, store, [cam({ id: 'a', lat: 1, lon: 2 })], true, { onOpen: () => {}, onCluster: () => {} });
    expect(store.size).toBe(1);
    expect(syncCctvLayer(mapAt(2) as never, store, [cam({ id: 'a', lat: 1, lon: 2 })], false, { onOpen: () => {}, onCluster: () => {} })).toBe(0);
    expect(store.size).toBe(0);
  });
});

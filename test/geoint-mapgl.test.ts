// @vitest-environment jsdom
/**
 * GeoINT MapLibre globe skeleton (Task R1). MapLibre is WebGL — it cannot render in jsdom — so
 * `maplibre-gl` is mocked with a fake Map that records its constructor opts. The repo has no
 * React renderer test infra (no @testing-library/react; the vitest include glob is *.test.ts
 * only), so rather than mount the component we drive its extracted init helper `createGlobeMap`
 * directly. That locks in the two R1 guarantees: a GLOBE projection is requested, and the map
 * exposes the `remove()` the component's unmount cleanup calls. The component's own effect is a
 * thin double-init-guarded wrapper around this helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Record every Map construction so the test can inspect the options the helper passed.
const constructed: Array<Record<string, unknown>> = [];

vi.mock('maplibre-gl', () => {
  class FakeMap {
    opts: Record<string, unknown>;
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      constructed.push(opts);
    }
    addControl(): void {}
    on(): void {}
    remove(): void {}
  }
  // The component also imports the CSS and the default export; provide a default with Map on it.
  return { default: { Map: FakeMap }, Map: FakeMap };
});

// CSS import in MapGL.tsx — stub so the bare `import 'maplibre-gl/dist/maplibre-gl.css'` resolves.
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

import { createGlobeMap, MapGL } from '../src/renderer/modules/geoint/MapGL';

describe('GeoINT MapGL globe skeleton (R1)', () => {
  beforeEach(() => {
    constructed.length = 0;
  });

  it('requests a 3D globe projection on init', () => {
    const container = document.createElement('div');
    createGlobeMap(container);
    expect(constructed).toHaveLength(1);
    // In MapLibre v5 the globe projection is carried in the style, not MapOptions.
    const style = constructed[0].style as { projection?: { type?: string } };
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

  it('uses a minimal empty dark style (no sources, a single background layer)', () => {
    createGlobeMap(document.createElement('div'));
    const style = constructed[0].style as { version: number; sources: object; layers: Array<{ type: string }> };
    expect(style.version).toBe(8);
    expect(Object.keys(style.sources)).toHaveLength(0);
    expect(style.layers).toHaveLength(1);
    expect(style.layers[0].type).toBe('background');
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

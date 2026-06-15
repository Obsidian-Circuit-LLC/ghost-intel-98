/**
 * MapLibre GL map for GeoINT — 3D globe with gated raster basemap (Task R2 of the GeoINT reimagine).
 *
 * R1 stood up an empty dark globe; R2 wires the real basemap + a globe/flat projection toggle, at
 * parity with how the live Leaflet MapPane gates tiles. Tiles load ONLY when `tilesEnabled` (the
 * `settings.geoint.networkEnabled` egress gate) is true and a basemap URL is set — otherwise the
 * style carries NO network sources (a blank dark globe), exactly like MapPane loads no tiles when
 * the gate is off. Markers/flyTo/pick come in later tasks. This is still NOT the live map:
 * GeoIntModule mounts Leaflet's MapPane by default; MapGL renders only behind the `useMapGL` flag.
 *
 * CSP note: unlike Leaflet (which loads tiles via <img> → `img-src`), MapLibre fetches raster tiles
 * in its worker via fetch()/XHR with responseType=arraybuffer → governed by `connect-src`. The
 * renderer CSP's connect-src was extended (R2) to permit the tile hosts; worker-src already allows
 * `blob:` for MapLibre's Web Workers and no frame-src change was needed.
 *
 * `createGlobeMap()` / `buildStyle()` are factored out so the style/projection logic is unit-testable
 * against a mocked `maplibre-gl` (WebGL can't render headlessly).
 */

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoItem } from '@shared/post-mvp-types';

// Stable source/layer ids so style rebuilds and toggles address the same nodes.
const BASEMAP_SOURCE = 'geoint-basemap';
const BASEMAP_LAYER = 'geoint-basemap-layer';
const OVERLAY_SOURCE_PREFIX = 'geoint-overlay-';
const OVERLAY_LAYER_PREFIX = 'geoint-overlay-layer-';

// World view: zoomed out so the whole globe is visible on first paint.
const INITIAL_CENTER: [number, number] = [0, 20];
const INITIAL_ZOOM = 1.5;

export type Projection = 'globe' | 'mercator';

/**
 * Build a MapLibre style for the given gate/basemap/overlays. The egress gate is enforced HERE:
 * when `tilesEnabled` is false (or no basemap URL is set), the returned style has ZERO network
 * sources — just the dark background, like MapPane loads no tiles with the gate off. When enabled,
 * a raster source+layer for the active basemap plus optional transparent label overlays on top.
 *
 * MapLibre raster sources take `tiles: [url]` + `tileSize: 256` + `attribution`. The Leaflet
 * `{x}/{y}/{z}` (and Esri `{z}/{y}/{x}`) URL templates are accepted by MapLibre verbatim.
 */
export function buildStyle(opts: {
  projection: Projection;
  tilesEnabled?: boolean;
  tileUrl?: string;
  tileAttribution?: string;
  overlayUrls?: string[];
  overlayAttribution?: string;
}): maplibregl.StyleSpecification {
  const sources: maplibregl.StyleSpecification['sources'] = {};
  // Dark background is always painted (the blank globe when the gate is off).
  const layers: maplibregl.LayerSpecification[] = [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0a0f1a' } }
  ];

  const gateOpen = !!opts.tilesEnabled;
  if (gateOpen && opts.tileUrl) {
    sources[BASEMAP_SOURCE] = {
      type: 'raster',
      tiles: [opts.tileUrl],
      tileSize: 256,
      attribution: opts.tileAttribution ?? ''
    };
    layers.push({ id: BASEMAP_LAYER, type: 'raster', source: BASEMAP_SOURCE });

    // Transparent label overlays drawn ON TOP of the basemap (street/place names). Only when the
    // gate is open; each gets its own source+layer so a changed set is rebuilt cleanly.
    if (gateOpen) {
      (opts.overlayUrls ?? []).forEach((url, i) => {
        const sid = `${OVERLAY_SOURCE_PREFIX}${i}`;
        sources[sid] = {
          type: 'raster',
          tiles: [url],
          tileSize: 256,
          attribution: opts.overlayAttribution ?? ''
        };
        layers.push({ id: `${OVERLAY_LAYER_PREFIX}${i}`, type: 'raster', source: sid });
      });
    }
  }

  return {
    version: 8,
    // MapLibre v5 carries the projection in the StyleSpecification, not MapOptions.
    projection: { type: opts.projection },
    sources,
    layers
  };
}

/**
 * Construct a MapLibre globe map into `container`. Factored out of the component so the init path
 * (projection + style + world view) is unit-testable with a mocked maplibre-gl. Callers own the
 * returned map's lifecycle (call `.remove()` on unmount). The initial style reflects the passed
 * gate so the very first paint already honours the egress gate (no flash of un-gated tiles).
 */
export function createGlobeMap(
  container: HTMLElement,
  styleOpts: Parameters<typeof buildStyle>[0] = { projection: 'globe' }
): maplibregl.Map {
  return new maplibregl.Map({
    container,
    style: buildStyle(styleOpts),
    // MapLibre takes attribution options (or `false` to disable), not a bare boolean. `{}` keeps
    // the attribution control on with defaults — the OSINT-honest "where did these tiles come
    // from" credit the Leaflet path also shows.
    attributionControl: {},
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM
  });
}

// Prop surface mirrors a SUBSET of MapPane's. R2 renders tiles (basemap + label overlays) and the
// projection toggle; markers/focus/flyTo/pick land in later tasks (still optional so `<MapGL />`
// works bare).
export interface MapGLProps {
  items?: GeoItem[];
  tilesEnabled?: boolean;
  tileUrl?: string;
  tileAttribution?: string;
  overlayUrls?: string[];
  overlayAttribution?: string;
  focusId?: string | null;
}

export function MapGL(props: MapGLProps = {}): JSX.Element {
  const { tilesEnabled, tileUrl, tileAttribution, overlayUrls = [], overlayAttribution } = props;
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  // Default globe (the GeoINT reimagine headline is the 3D globe). The toggle flips to flat mercator.
  const [projection, setProjection] = useState<Projection>('globe');

  // Latest style inputs, so the init effect (which must run once, deps []) can read them without
  // re-creating the map, and so the style-sync effect rebuilds from current values.
  const styleOptsRef = useRef({ projection, tilesEnabled, tileUrl, tileAttribution, overlayUrls, overlayAttribution });
  styleOptsRef.current = { projection, tilesEnabled, tileUrl, tileAttribution, overlayUrls, overlayAttribution };

  useEffect(() => {
    // Guard against double-init: a ref'd map already exists (StrictMode re-run), or the
    // container isn't mounted yet. Same pattern MapPane uses for its Leaflet map.
    if (!ref.current || map.current) return;
    map.current = createGlobeMap(ref.current, styleOptsRef.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Re-apply the whole style whenever the gate, basemap, or overlays change. setStyle wholesale
  // is the clean MapLibre pattern here: it drops the old sources/layers (no leak of the previous
  // tile source) and re-derives them from buildStyle, which is the single place the egress gate is
  // enforced. `diff: true` lets MapLibre apply only what changed (no full reload flicker).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    m.setStyle(buildStyle({ projection, tilesEnabled, tileUrl, tileAttribution, overlayUrls, overlayAttribution }), { diff: true });
    // overlayUrls is an array literal from the parent; join it so a same-content array doesn't refire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection, tilesEnabled, tileUrl, tileAttribution, overlayUrls.join('|'), overlayAttribution]);

  return (
    <div className="ga98-geo-map-wrap" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={ref} className="ga98-geo-map" style={{ width: '100%', height: '100%' }} />
      {/* Globe/Flat projection toggle. Win98-flat button in the top-right corner; above the
          MapLibre canvas. Default globe; one click flips to flat mercator and back. */}
      <button
        type="button"
        className="ga98-panel"
        onClick={() => setProjection((p) => (p === 'globe' ? 'mercator' : 'globe'))}
        aria-pressed={projection === 'globe'}
        title={projection === 'globe' ? 'Switch to flat (mercator) projection' : 'Switch to 3D globe projection'}
        style={{ position: 'absolute', top: 8, right: 8, zIndex: 600, fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}
      >
        {projection === 'globe' ? '🌐 Globe' : '🗺 Flat'}
      </button>
    </div>
  );
}

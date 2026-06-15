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
import { buildPopup } from './popup';

// Marker fill by feed-item category. Falls back to a neutral grey for unknown/undefined.
// Ported verbatim from MapPane's CATEGORY_COLOR so the two maps colour identically.
const CATEGORY_COLOR: Record<string, string> = {
  conflict: '#c0392b', cyber: '#8e44ad', protest: '#e67e22',
  disaster: '#16a085', crime: '#7f8c8d', politics: '#2980b9'
};

// Hard cap on rendered markers so a huge cache (e.g. thousands of FIRMS points, 2000/source)
// can't freeze the map. Only the first MAX_MARKERS *located* items get a marker — but `located`
// keeps counting past the cap so the truncation readout is honest. Ported from MapPane.
const MAX_MARKERS = 1500;

// Diameter (px) by severity. Undefined/low → 11, medium → 14, high → 18. Ported from MapPane.
function severityDiameter(sev: GeoItem['severity']): number {
  return sev === 'high' ? 18 : sev === 'medium' ? 14 : 11;
}

/**
 * Strict coordinate gate (ported from MapPane). A poisoned item (null/NaN/Infinity/garbage or
 * out-of-range lat-lon) must NEVER reach a marker — no silent (0,0) pins. Exported so the test
 * can assert the rejection set directly. Returns true only for finite, in-range lat/lon.
 */
export function validCoord(lat: number | null | undefined, lon: number | null | undefined): lat is number {
  return lat != null && lon != null
    && Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/**
 * Build a per-item round-dot HTMLElement for a MapLibre Marker: fill by category, size by severity,
 * and a white halo + colored glow ring when corroborated (count >= 1). Glow radius grows with the
 * count but is capped so a heavily corroborated cluster doesn't bloom across the map. Mirrors
 * MapPane's `buildIcon`, but returns a bare element (MapLibre's `new Marker({ element })`) rather
 * than an L.divIcon. Factored out + exported so the dot styling is unit-testable without a GL context.
 */
export function buildIconElement(it: GeoItem, count: number): HTMLElement {
  const d = severityDiameter(it.severity);
  const color = CATEGORY_COLOR[it.category ?? ''] ?? '#555';
  const glow = count >= 1 ? Math.min(4 + count * 3, 16) : 0; // cap the bloom
  const ring = count >= 1
    ? `box-shadow:0 0 0 3px rgba(255,255,255,.7), 0 0 ${glow}px ${glow}px ${color};`
    : '';
  const el = document.createElement('span');
  el.className = 'ga98-geo-mk';
  el.style.cssText = `display:block;width:${d}px;height:${d}px;border-radius:50%;`
    + `background:${color};border:1px solid rgba(0,0,0,.5);box-sizing:border-box;${ring}`;
  return el;
}

/** Build the distinct 📌 search-pin element (mirrors MapPane's searchPin divIcon). */
function buildSearchPinElement(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'ga98-geo-search-pin';
  el.textContent = '📌';
  return el;
}

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

/**
 * Rebuild the item markers on `map`: clear the previous markers (MapLibre markers live directly
 * on the map, not in a layer-group, so each is removed explicitly + the id map cleared), then for
 * each VALID item create a category-coloured dot marker with its clean popup at [lng, lat] and add
 * it to the map, capped at MAX_MARKERS. Returns the truncation readout ({shown,total}) when the cap
 * hid located events, else null.
 *
 * Factored out of the component (like createGlobeMap/buildStyle) so the marker port — coord order,
 * the strict coord gate, and the cap/truncation count — is unit-testable against a mocked
 * maplibre-gl without a real GL context or a React renderer.
 */
export function rebuildItemMarkers(
  map: maplibregl.Map,
  store: Map<string, maplibregl.Marker>,
  items: GeoItem[],
  corroboration?: Map<string, number>
): { shown: number; total: number } | null {
  for (const mk of store.values()) mk.remove();
  store.clear();
  let placed = 0;
  let located = 0; // items with valid, placeable coords (whether or not capped)
  for (const it of items) {
    // Strict coord gate BEFORE constructing — no poisoned (NaN/Infinity/out-of-range) or
    // unlocated (null) item ever reaches a marker. No silent (0,0) pins (charter invariant).
    if (!validCoord(it.lat, it.lon)) continue;
    located++;
    if (placed >= MAX_MARKERS) continue; // cap so a huge cache can't bog the map (keep counting located)
    try {
      const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true })
        .setDOMContent(buildPopup(it.title, it.link));
      // CRITICAL: MapLibre uses [lng, lat] (GeoJSON order), the OPPOSITE of Leaflet's [lat, lng].
      const mk = new maplibregl.Marker({ element: buildIconElement(it, corroboration?.get(it.id) ?? 0) })
        .setLngLat([it.lon as number, it.lat as number])
        .setPopup(popup)
        .addTo(map);
      store.set(it.id, mk);
      placed++;
    } catch { /* skip a marker that fails to build; never let one bad item crash the layer */ }
  }
  return placed < located ? { shown: placed, total: located } : null;
}

// Prop surface mirrors MapPane's so GeoIntModule can pass the same props to either map. All are
// optional so `<MapGL />` still mounts bare (R1/R2 tests construct it without props), but the
// full set (markers, corroboration, pick, focus, flyTo, center-reporting) is now wired (R3).
export interface MapGLProps {
  items?: GeoItem[];
  /** Per-item count of distinct other sources reporting nearby in time (from corroborate()). */
  corroboration?: Map<string, number>;
  tilesEnabled?: boolean;
  tileUrl?: string;
  tileAttribution?: string;
  /** When true, a map click reports the clicked coords via onPick instead of normal panning. */
  pickMode?: boolean;
  onPick?: (lat: number, lon: number) => void;
  focusId?: string | null;
  /** Search target: when its `key` changes, fly there and drop a single search pin. */
  flyTo?: { lat: number; lon: number; key: number } | null;
  /** Reports the map center after each pan/zoom, so Street View can open the current spot. */
  onCenterChange?: (lat: number, lon: number) => void;
  /** Transparent overlay tile URLs (street/place labels) drawn ON TOP of the basemap. */
  overlayUrls?: string[];
  overlayAttribution?: string;
}

export function MapGL(props: MapGLProps = {}): JSX.Element {
  const {
    items = [], corroboration, tilesEnabled, tileUrl, tileAttribution,
    pickMode = false, onPick, focusId, flyTo, onCenterChange,
    overlayUrls = [], overlayAttribution
  } = props;
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  // Per-item markers keyed by id, so focus can address a marker without rebuilding the set.
  // MapLibre markers aren't in a layer-group, so we track + remove them explicitly on rebuild.
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  // Single search pin, kept OUTSIDE the item set so item rebuilds don't clear it; replaced on
  // each new search.
  const searchMarker = useRef<maplibregl.Marker | null>(null);
  // pickMode/onCenterChange read through refs so the (once) init effect sees the latest values
  // without re-creating the map — mirrors MapPane's pickRef/centerCb pattern.
  const pickRef = useRef(pickMode);
  pickRef.current = pickMode;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const centerCb = useRef(onCenterChange);
  centerCb.current = onCenterChange;
  // Latest items, readable by the focus effect without adding `items` to its deps. Lets focus on
  // a capped item fall back to flying to its coords by id (the MapPane itemsRef fallback).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Default globe (the GeoINT reimagine headline is the 3D globe). The toggle flips to flat mercator.
  const [projection, setProjection] = useState<Projection>('globe');
  // When the MAX_MARKERS cap truncates the located set, surface how many of how many are shown
  // (silently hiding events 1501..N is unacceptable in an OSINT tool). null = nothing hidden.
  const [truncated, setTruncated] = useState<{ shown: number; total: number } | null>(null);

  // Latest style inputs, so the init effect (which must run once, deps []) can read them without
  // re-creating the map, and so the style-sync effect rebuilds from current values.
  const styleOptsRef = useRef({ projection, tilesEnabled, tileUrl, tileAttribution, overlayUrls, overlayAttribution });
  styleOptsRef.current = { projection, tilesEnabled, tileUrl, tileAttribution, overlayUrls, overlayAttribution };

  useEffect(() => {
    // Guard against double-init: a ref'd map already exists (StrictMode re-run), or the
    // container isn't mounted yet. Same pattern MapPane uses for its Leaflet map.
    if (!ref.current || map.current) return;
    const m = createGlobeMap(ref.current, styleOptsRef.current);
    // Pick mode: a click reports its coords (lat, lng) when pick mode is on. MapLibre's
    // e.lngLat carries .lat/.lng, so the call order matches MapPane's onPick(lat, lon).
    m.on('click', (e: maplibregl.MapMouseEvent) => {
      if (pickRef.current) onPickRef.current?.(e.lngLat.lat, e.lngLat.lng);
    });
    // Report the center after each pan/zoom so Street View can open the current spot.
    m.on('moveend', () => { const c = m.getCenter(); centerCb.current?.(c.lat, c.lng); });
    map.current = m;
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Keep MapGL sized to its container. MapLibre, like Leaflet, can render gaps when the pane
  // grows/shrinks (split-pane drag, window restore from display:none). A ResizeObserver calling
  // map.resize() is MapLibre's equivalent of Leaflet's invalidateSize. Its own effect so the map
  // lifecycle isn't torn down on a prop change.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => map.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
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

  // Rebuild the item markers only when the item SET or corroboration changes (mirrors MapPane's
  // effect deps; items is memoized upstream so a pan that merely re-renders no longer thrashes).
  // MapLibre markers live directly on the map (no layer-group), so each old marker is removed
  // explicitly and the id map cleared before rebuilding.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    setTruncated(rebuildItemMarkers(m, markers.current, items, corroboration));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, corroboration]);

  // Recenter on a geocoded search hit. The `key` nonce makes repeated searches for the same
  // coordinates still fire. Drops a single distinct 📌 pin (replaced each search), kept off the
  // item set so item rebuilds don't clear it.
  useEffect(() => {
    const m = map.current;
    if (!m || !flyTo || !validCoord(flyTo.lat, flyTo.lon)) return;
    // CRITICAL: [lng, lat] order for the fly center.
    m.flyTo({ center: [flyTo.lon, flyTo.lat], zoom: 9 });
    if (searchMarker.current) { searchMarker.current.remove(); searchMarker.current = null; }
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true })
      .setText(`${flyTo.lat.toFixed(5)}, ${flyTo.lon.toFixed(5)}`);
    const sm = new maplibregl.Marker({ element: buildSearchPinElement() })
      .setLngLat([flyTo.lon, flyTo.lat])
      .setPopup(popup)
      .addTo(m);
    searchMarker.current = sm;
    sm.togglePopup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo?.key]);

  // Recenter + open the focused marker's popup ONLY when the focus actually changes. Keeping the
  // fly out of the build effect avoids a fly→moveend→onCenterChange→re-render→rebuild loop.
  useEffect(() => {
    const m = map.current;
    if (!m || !focusId) return;
    const mk = markers.current.get(focusId);
    if (mk) {
      const ll = mk.getLngLat();
      m.flyTo({ center: [ll.lng, ll.lat], zoom: 6 });
      if (!mk.getPopup()?.isOpen()) mk.togglePopup();
      return;
    }
    // No marker for this id — past the MAX_MARKERS cap (or not yet built). Fall back to flying to
    // the item's coords by id so "Play story" / focus still works on capped events.
    const it = itemsRef.current.find((x) => x.id === focusId);
    if (it && validCoord(it.lat, it.lon)) m.flyTo({ center: [it.lon as number, it.lat], zoom: 6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  return (
    <div className="ga98-geo-map-wrap" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={ref} className="ga98-geo-map" style={{ width: '100%', height: '100%' }} />
      {truncated && (
        <div
          className="ga98-panel"
          style={{ position: 'absolute', left: 6, bottom: 6, zIndex: 500, fontSize: 11, padding: '2px 6px', background: 'var(--ga98-face,#c0c0c0)', border: '2px outset #fff', pointerEvents: 'none' }}
        >
          Showing {truncated.shown} of {truncated.total} located events
        </div>
      )}
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

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

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoItem, CameraStream } from '@shared/post-mvp-types';
import { buildPopup } from './popup';
import { syncCctvLayer } from './cctvLayer';
import { makePropagator } from './satellites/propagate';
import { ensureSatelliteLayer, updateSatelliteLayer } from './satellites/satelliteLayer';
import type { PropagatedSat } from './satellites/types';
import { ensureAircraftLayer, updateAircraftLayer } from './livefeeds/aircraftLayer';
import { ensureShipLayer, updateShipLayer } from './livefeeds/shipLayer';
import type { AircraftPos, ShipPos, Bounds } from '@shared/livefeeds/types';

// Marker fill by feed-item category. Falls back to a neutral grey for unknown/undefined.
// Ported verbatim from MapPane's CATEGORY_COLOR so the two maps colour identically.
const CATEGORY_COLOR: Record<string, string> = {
  conflict: '#c0392b', cyber: '#8e44ad', protest: '#e67e22',
  disaster: '#16a085', crime: '#7f8c8d', politics: '#2980b9'
};


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

// GPU event layer. Stable ids so a style rebuild or a resync addresses the same nodes.
export const EVENTS_SOURCE = 'geoint-events';
export const EVENTS_GLOW_LAYER = 'geoint-events-glow';
export const EVENTS_LAYER = 'geoint-events-dots';

/**
 * Cap on FEATURES in the GPU layer. Two orders of magnitude above the old DOM-marker cap because
 * the cost profile is different in kind: a circle layer draws its points on the GPU in one pass,
 * where the marker path paid a DOM element + a Marker + a Popup object EACH. The cap is kept only
 * so a pathological cache cannot build an unbounded FeatureCollection in memory, and the
 * truncation readout stays honest when it bites.
 */
const MAX_FEATURES = 20000;

/** One point feature per located event, carrying everything the paint expressions read. */
function buildEventFeatures(
  items: GeoItem[],
  corroboration?: Map<string, number>
): { features: Array<Record<string, unknown>>; located: number } {
  const features: Array<Record<string, unknown>> = [];
  let located = 0;
  for (const it of items) {
    // Strict coord gate BEFORE building — a poisoned (NaN/Infinity/out-of-range) or unlocated
    // (null) item must never be placed. No silent (0,0) pins (charter invariant), unchanged from
    // the marker path.
    if (!validCoord(it.lat, it.lon)) continue;
    located++;
    if (features.length >= MAX_FEATURES) continue; // keep counting located so the readout is honest
    const count = corroboration?.get(it.id) ?? 0;
    features.push({
      type: 'Feature',
      // CRITICAL: [lng, lat] — GeoJSON order, the OPPOSITE of Leaflet's [lat, lng].
      geometry: { type: 'Point', coordinates: [it.lon as number, it.lat as number] },
      properties: {
        id: it.id,
        title: String(it.title ?? ''),
        link: String(it.link ?? ''),
        color: CATEGORY_COLOR[it.category ?? ''] ?? '#555',
        r: severityDiameter(it.severity) / 2,
        count,
      },
    });
  }
  return { features, located };
}

/**
 * Draw every located event as a GPU circle from ONE GeoJSON source, replacing one DOM element +
 * one Marker + one Popup per event.
 *
 * The old marker was a coloured dot: diameter by severity, fill by category, a white ring and a
 * coloured bloom once corroborated. All four are data-driven paint properties over the feature
 * properties built above, so the appearance is preserved without a sprite or an icon atlas. The
 * bloom (a CSS box-shadow on the marker element) becomes a translucent underlay circle — the
 * standard way to fake a glow on a map, and the only part of the look that is an approximation
 * rather than a transcription.
 *
 * Interaction is bound ONCE to the layer, not per feature: a click reads the feature's id and
 * opens the Event Details dossier, and a single shared Popup is reused for every event, its
 * content built at click time, so an event that is never clicked never constructs a subtree — the
 * laziness `buildPopupLazily` used to provide is now structural: there is nothing to defer because
 * nothing is built until a click happens.
 *
 * Returns the truncation readout ({shown,total}) when the cap hid located events, else null.
 */
export function syncItemLayer(
  map: maplibregl.Map,
  items: GeoItem[],
  corroboration?: Map<string, number>,
  onPopup?: (p: maplibregl.Popup) => void,
  onSelect?: (id: string) => void
): { shown: number; total: number } | null {
  const { features, located } = buildEventFeatures(items, corroboration);
  const data = { type: 'FeatureCollection', features } as unknown as maplibregl.GeoJSONSourceSpecification['data'];

  const existing = map.getSource(EVENTS_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (existing && typeof existing.setData === 'function') {
    existing.setData(data);
  } else {
    map.addSource(EVENTS_SOURCE, { type: 'geojson', data } as maplibregl.SourceSpecification);
    // Bloom underlay, drawn only for corroborated events (the old marker's box-shadow).
    map.addLayer({
      id: EVENTS_GLOW_LAYER,
      type: 'circle',
      source: EVENTS_SOURCE,
      filter: ['>=', ['get', 'count'], 1],
      paint: {
        'circle-radius': ['+', ['get', 'r'], ['min', ['*', ['get', 'count'], 3], 16]],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.35,
        'circle-blur': 0.6,
      },
    } as unknown as maplibregl.LayerSpecification);
    // The dot itself: severity radius, category fill, and the white ring once corroborated.
    map.addLayer({
      id: EVENTS_LAYER,
      type: 'circle',
      source: EVENTS_SOURCE,
      paint: {
        'circle-radius': ['get', 'r'],
        'circle-color': ['get', 'color'],
        'circle-stroke-width': ['case', ['>=', ['get', 'count'], 1], 3, 1],
        'circle-stroke-color': [
          'case',
          ['>=', ['get', 'count'], 1],
          'rgba(255,255,255,0.7)',
          'rgba(0,0,0,0.5)',
        ],
      },
    } as unknown as maplibregl.LayerSpecification);

    // ONE handler for the whole layer. Bound only on creation so a resync never stacks listeners.
    map.on('click', EVENTS_LAYER, (e: unknown) => {
      const ev = e as { features?: Array<{ properties?: Record<string, unknown> }>; lngLat?: { lng: number; lat: number } };
      const props = ev.features?.[0]?.properties;
      if (!props) return;
      const id = String(props.id ?? '');
      const st = layerState(map);
      if (id) st.onSelect?.(id);
      const lngLat = ev.lngLat;
      if (!lngLat) return;
      const popup = sharedPopup(map);
      st.onPopup?.(popup);
      // Content is built HERE — on the click — so events that are never opened never build one.
      popup.setDOMContent(buildPopup(String(props.title ?? ''), String(props.link ?? '')));
      popup.setLngLat([lngLat.lng, lngLat.lat]).addTo(map);
    });
    // Pointer affordance: the dots are clickable, so say so.
    map.on('mouseenter', EVENTS_LAYER, () => { try { map.getCanvas().style.cursor = 'pointer'; } catch { /* no canvas in a stub */ } });
    map.on('mouseleave', EVENTS_LAYER, () => { try { map.getCanvas().style.cursor = ''; } catch { /* no canvas in a stub */ } });
  }

  // The click handler is bound once but the callbacks change across renders; route through refs so
  // the live ones are always used without rebinding (and without stacking listeners).
  const st = layerState(map);
  st.onSelect = onSelect;
  st.onPopup = onPopup;

  return features.length < located ? { shown: features.length, total: located } : null;
}

/**
 * Per-map layer state: the live callbacks for the once-bound click handler, and the single Popup
 * reused by every event.
 *
 * Keyed by the map — NOT module-level singletons. A style rebuild or a second map would otherwise
 * share one popup and clobber each other's callbacks, and a popup would outlive the map it was
 * attached to. A WeakMap also means the entry disappears with the map, with nothing to clean up.
 */
interface EventLayerState {
  onSelect?: (id: string) => void;
  onPopup?: (p: maplibregl.Popup) => void;
  popup?: maplibregl.Popup;
}
const eventLayerState = new WeakMap<object, EventLayerState>();

function layerState(map: maplibregl.Map): EventLayerState {
  let st = eventLayerState.get(map as unknown as object);
  if (!st) {
    st = {};
    eventLayerState.set(map as unknown as object, st);
  }
  return st;
}

/** One Popup per map, created on first click rather than one per event. */
function sharedPopup(map: maplibregl.Map): maplibregl.Popup {
  const st = layerState(map);
  if (!st.popup) st.popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true });
  return st.popup;
}

/**
 * Open the shared popup for one event. Used by the focus path ("Play story", Event Details), which
 * previously reached into the marker store and toggled that marker's own popup. With events drawn
 * as features there is no per-event popup to toggle, so focus opens the shared one at the event's
 * coordinates with content built at open time — the same lazy rule the click path follows.
 */
export function openEventPopup(
  map: maplibregl.Map,
  it: GeoItem,
  onPopup?: (p: maplibregl.Popup) => void
): void {
  if (!validCoord(it.lat, it.lon)) return;
  const popup = sharedPopup(map);
  onPopup?.(popup);
  popup.setDOMContent(buildPopup(String(it.title ?? ''), it.link));
  popup.setLngLat([it.lon as number, it.lat as number]).addTo(map);
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
  /** All geolocated CCTV streams to cluster onto the map (already validCoord-filtered upstream). */
  cctvStreams?: CameraStream[];
  /** When true, render the clustered camera layer. */
  showCctv?: boolean;
  /** Click handler for a single camera pin. */
  onCameraOpen?: (streamId: string) => void;
  /** Satellite records to propagate + draw (already merged: snapshot ∪ active user ∪ celestrak). */
  satRecords?: import('./satellites/types').SatelliteRecord[];
  showSatellites?: boolean;
  satVisibleTypes?: Set<import('./satellites/types').SatelliteType> | null;
  onSatelliteSelect?: (id: string) => void;
  /** Latest propagated set each tick — the panel table consumes this. */
  onSatellitesPropagated?: (sats: import('./satellites/types').PropagatedSat[]) => void;
  /** When set, recenter on this satellite each tick (Track/follow). */
  trackSatId?: string | null;
  /** Propagation cadence in ms (default 2000). */
  satTickMs?: number;
  /** Live aircraft positions to render (ADS-B feed). */
  aircraft?: AircraftPos[];
  showAircraft?: boolean;
  onAircraftSelect?: (id: string) => void;
  /** Live ship positions to render (AIS feed). */
  ships?: ShipPos[];
  showShips?: boolean;
  onShipSelect?: (id: string) => void;
  /** Reports the viewport bounding box after each pan/zoom (~500 ms debounced). */
  onBboxChange?: (b: Bounds) => void;
  /** A marker (blip) click also selects the event and opens the Event Details dossier panel. */
  onSelectItem?: (id: string) => void;
}

export function MapGL(props: MapGLProps = {}): JSX.Element {
  const {
    items = [], corroboration, tilesEnabled, tileUrl, tileAttribution,
    pickMode = false, onPick, focusId, flyTo, onCenterChange,
    overlayUrls = [], overlayAttribution,
    cctvStreams = [], showCctv = false, onCameraOpen,
    satRecords = [], showSatellites = false, satVisibleTypes = null,
    onSatelliteSelect, onSatellitesPropagated, trackSatId = null, satTickMs = 2000,
    aircraft = [], showAircraft = false, onAircraftSelect,
    ships = [], showShips = false, onShipSelect,
    onBboxChange, onSelectItem
  } = props;
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  // Per-item markers keyed by id, so focus can address a marker without rebuilding the set.
  // MapLibre markers aren't in a layer-group, so we track + remove them explicitly on rebuild.
  // Single search pin, kept OUTSIDE the item set so item rebuilds don't clear it; replaced on
  // each new search.
  const searchMarker = useRef<maplibregl.Marker | null>(null);
  // Camera (CCTV) markers, kept in their OWN store so they never touch the event-marker set or its
  // MAX_MARKERS cap. Rebuilt on every viewport change from the clustered cells.
  const cctvMarkers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const cctvStreamsRef = useRef(cctvStreams);
  cctvStreamsRef.current = cctvStreams;
  const showCctvRef = useRef(showCctv);
  showCctvRef.current = showCctv;
  const onCameraOpenRef = useRef(onCameraOpen);
  onCameraOpenRef.current = onCameraOpen;
  const satVisibleRef = useRef(satVisibleTypes); satVisibleRef.current = satVisibleTypes;
  const showSatellitesRef = useRef(showSatellites); showSatellitesRef.current = showSatellites;
  const onSatSelectRef = useRef(onSatelliteSelect); onSatSelectRef.current = onSatelliteSelect;
  const onSatPropRef = useRef(onSatellitesPropagated); onSatPropRef.current = onSatellitesPropagated;
  const trackSatRef = useRef(trackSatId); trackSatRef.current = trackSatId;
  const propagatorRef = useRef<ReturnType<typeof makePropagator> | null>(null);
  const aircraftRef = useRef(aircraft); aircraftRef.current = aircraft;
  const showAircraftRef = useRef(showAircraft); showAircraftRef.current = showAircraft;
  const onAircraftSelectRef = useRef(onAircraftSelect); onAircraftSelectRef.current = onAircraftSelect;
  const shipsRef = useRef(ships); shipsRef.current = ships;
  const showShipsRef = useRef(showShips); showShipsRef.current = showShips;
  const onShipSelectRef = useRef(onShipSelect); onShipSelectRef.current = onShipSelect;
  const onBboxChangeRef = useRef(onBboxChange); onBboxChangeRef.current = onBboxChange;
  // Read the selection callback through a ref so a changed handler doesn't re-thrash the whole
  // marker set (the rebuild effect keys off the item SET + corroboration only).
  const onSelectItemRef = useRef(onSelectItem); onSelectItemRef.current = onSelectItem;
  const bboxDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only ONE popup open at a time. MapLibre's closeOnClick closes popups on a MAP click but NOT
  // when another marker is clicked, so clicking through co-located "blips" left a stack of popups
  // with their ✕ close buttons overlapping. Track the currently-open popup; opening any popup
  // (a marker's or the search pin's) closes the previously-open one.
  const openPopup = useRef<maplibregl.Popup | null>(null);
  const trackPopup = useCallback((p: maplibregl.Popup) => {
    p.on('open', () => {
      if (openPopup.current && openPopup.current !== p) openPopup.current.remove();
      openPopup.current = p;
    });
    p.on('close', () => { if (openPopup.current === p) openPopup.current = null; });
  }, []);
  // Cluster + render the camera layer for the current view. Reads latest props via refs so it can be
  // a stable (deps []) listener on moveend/zoomend without re-creating the map. A cluster click flies
  // one step deeper so clusters progressively split toward individual camera pins.
  const syncCctv = useCallback(() => {
    const m = map.current;
    if (!m) return;
    syncCctvLayer(m, cctvMarkers.current, cctvStreamsRef.current, showCctvRef.current, {
      onOpen: (id) => onCameraOpenRef.current?.(id),
      onCluster: (cell) => m.flyTo({ center: [cell.lon, cell.lat], zoom: Math.min(m.getZoom() + 2, 16) })
    });
  }, []);
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
    m.on('moveend', syncCctv);
    m.on('zoomend', syncCctv);
    // Ensure (and re-ensure) the satellite source/layer whenever the style is ready. `addSource`
    // throws "Style is not done loading" if called before the style finishes — so we MUST NOT call it
    // synchronously at init (the style is still loading) nor on a mid-load `styledata`. Drive it off
    // `load` (initial, style guaranteed loaded) AND `styledata` (after `setStyle`, which destroys all
    // added sources/layers so the satellite layer must be re-added on basemap/network toggles).
    // ensureSatelliteLayer self-guards on isStyleLoaded() + getSource(), so both events are safe and
    // never double-add. Both handlers registered ONCE here in the [] deps init effect.
    const ensureSat = (): void => {
      ensureSatelliteLayer(m, (id) => onSatSelectRef.current?.(id));
      // Repopulate immediately so there is no blank gap when the layer is (re-)created.
      if (showSatellitesRef.current && propagatorRef.current) {
        updateSatelliteLayer(m, propagatorRef.current.propagateAt(new Date()), satVisibleRef.current);
      }
      // Ensure aircraft + ship layers alongside the satellite layer; both self-guard on
      // isStyleLoaded() + getSource(), so calling on load + styledata is safe and idempotent.
      ensureAircraftLayer(m, (id) => onAircraftSelectRef.current?.(id));
      if (showAircraftRef.current) updateAircraftLayer(m, aircraftRef.current);
      ensureShipLayer(m, (id) => onShipSelectRef.current?.(id));
      if (showShipsRef.current) updateShipLayer(m, shipsRef.current);
    };
    m.on('load', ensureSat);
    m.on('styledata', ensureSat);
    // Debounced bbox reporting: fire ~500 ms after the map settles so rapid panning doesn't
    // flood the consumer with fetch requests. Piggybacks on the existing moveend registration.
    m.on('moveend', () => {
      if (bboxDebounceRef.current !== null) clearTimeout(bboxDebounceRef.current);
      bboxDebounceRef.current = setTimeout(() => {
        bboxDebounceRef.current = null;
        const b = m.getBounds();
        onBboxChangeRef.current?.({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
      }, 500);
    });
    map.current = m;
    return () => {
      if (bboxDebounceRef.current) clearTimeout(bboxDebounceRef.current);
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

  // Resync the GPU event layer when the item SET or corroboration changes (items is memoized
  // upstream so a pan that merely re-renders no longer thrashes). One GeoJSON source is updated in
  // place — there are no per-event DOM nodes to remove, which is the point of the layer.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    setTruncated(syncItemLayer(m, items, corroboration, trackPopup, (id) => onSelectItemRef.current?.(id)));
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
    trackPopup(popup); // single-open tracking: the search popup closes any open marker popup
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
    // Events are features, not markers, so focus resolves through the item set by id — the path
    // that used to be the past-the-cap fallback is now the only path, and it works for every event
    // rather than only the ones that got a DOM node.
    const it = itemsRef.current.find((x) => x.id === focusId);
    if (!it || !validCoord(it.lat, it.lon)) return;
    m.flyTo({ center: [it.lon as number, it.lat], zoom: 6 });
    openEventPopup(m, it, trackPopup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  // Re-render the camera layer when toggled or when the stream set changes (the moveend/zoomend
  // listeners cover pan/zoom). Refs are assigned during render, so they're current here.
  useEffect(() => {
    syncCctv();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCctv, cctvStreams]);

  // Rebuild the propagator when the satellite record set changes. The propagator is read by ref
  // inside the tick so the interval closure doesn't stale-capture it.
  useEffect(() => {
    propagatorRef.current = makePropagator(satRecords);
  }, [satRecords]);

  // Propagation tick: runs only while showSatellites is true. Clears the layer when off.
  // Uses new Date() — the documented real-time exception for this feature (satellite positions
  // are inherently wall-clock dependent and the requirement is stated explicitly in the brief).
  useEffect(() => {
    const m = map.current;
    if (!m || !showSatellites) {
      if (m && m.getSource('ga98-satellites')) updateSatelliteLayer(m, [], satVisibleRef.current);
      return;
    }
    const tick = (): void => {
      const mm = map.current; const prop = propagatorRef.current;
      if (!mm || !prop) return;
      const sats: PropagatedSat[] = prop.propagateAt(new Date());
      updateSatelliteLayer(mm, sats, satVisibleRef.current);
      onSatPropRef.current?.(sats);
      const tid = trackSatRef.current;
      if (tid) { const s = sats.find((x) => x.id === tid); if (s) mm.easeTo({ center: [s.lon, s.lat], duration: 400 }); }
    };
    tick();
    const h = setInterval(tick, satTickMs);
    return () => clearInterval(h);
  }, [showSatellites, satRecords, satTickMs]);

  // Update the aircraft layer when the feed or toggle changes. Pass [] when off so
  // the layer is cleared without removing it (consistent with the satellite pattern).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    updateAircraftLayer(m, showAircraft ? aircraft : []);
  }, [aircraft, showAircraft]);

  // Update the ship layer when the feed or toggle changes.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    updateShipLayer(m, showShips ? ships : []);
  }, [ships, showShips]);

  return (
    <div className="ga98-geo-map-wrap" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={ref} className="ga98-geo-map" style={{ width: '100%', height: '100%' }} />
      {truncated && (
        <div
          className="ga98-panel"
          style={{ position: 'absolute', left: 6, bottom: 6, zIndex: 500, fontSize: 11, padding: '2px 6px', background: 'var(--ga98-face,#c0c0c0)', border: '2px outset var(--ga98-shadow-light)', pointerEvents: 'none' }}
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

/**
 * Leaflet map for GeoINT. Tiles load ONLY when networkEnabled and a tile URL is set —
 * otherwise a placeholder is shown and no tile request is made (app-layer egress gate).
 * Markers use L.divIcon (an emoji pin) to avoid Leaflet's default-marker asset-path
 * breakage under bundlers. Pick mode turns a map click into an onPick(lat, lon) call.
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoItem } from '@shared/post-mvp-types';
import { buildPopup } from './popup';

// Marker fill by feed-item category. Falls back to a neutral grey for unknown/undefined.
const CATEGORY_COLOR: Record<string, string> = {
  conflict: '#c0392b', cyber: '#8e44ad', protest: '#e67e22',
  disaster: '#16a085', crime: '#7f8c8d', politics: '#2980b9'
};
// Distinct icon for the searched location so it reads differently from the item markers.
const searchPin = L.divIcon({ className: 'ga98-geo-search-pin', html: '📌', iconSize: [20, 20], iconAnchor: [10, 20] });

// Diameter (px) by severity. Undefined/low → 11, medium → 14, high → 18.
function severityDiameter(sev: GeoItem['severity']): number {
  return sev === 'high' ? 18 : sev === 'medium' ? 14 : 11;
}

// Build a per-item round-dot divIcon: fill by category, size by severity, and a white halo + colored
// glow ring when corroborated (count >= 1). Glow radius grows with the count but is capped so a heavily
// corroborated cluster doesn't bloom across the map. Self-contained inline styles (Win98-flat dot; the
// glow is the "resonance"). Sized so iconSize/anchor match the dot's outer box.
function buildIcon(it: GeoItem, count: number): L.DivIcon {
  const d = severityDiameter(it.severity);
  const color = CATEGORY_COLOR[it.category ?? ''] ?? '#555';
  const glow = count >= 1 ? Math.min(4 + count * 3, 16) : 0; // cap the bloom
  const ring = count >= 1
    ? `box-shadow:0 0 0 3px rgba(255,255,255,.7), 0 0 ${glow}px ${glow}px ${color};`
    : '';
  const html = `<span style="display:block;width:${d}px;height:${d}px;border-radius:50%;`
    + `background:${color};border:1px solid rgba(0,0,0,.5);box-sizing:border-box;${ring}"></span>`;
  return L.divIcon({ className: 'ga98-geo-mk', html, iconSize: [d, d], iconAnchor: [d / 2, d / 2] });
}

export function MapPane({ items, corroboration, tilesEnabled, tileUrl, tileAttribution, pickMode, onPick, focusId, flyTo, onCenterChange, overlayUrls = [], overlayAttribution = '' }: {
  items: GeoItem[];
  /** Per-item count of distinct other sources reporting nearby in time (from corroborate()). */
  corroboration: Map<string, number>;
  tilesEnabled: boolean;
  tileUrl: string;
  tileAttribution: string;
  pickMode: boolean;
  onPick: (lat: number, lon: number) => void;
  focusId: string | null;
  /** Search target: when it changes to a non-null value, recenter the map there. */
  flyTo: { lat: number; lon: number; key: number } | null;
  /** Reports the map center after each pan/zoom, so Street View can open the current spot. */
  onCenterChange?: (lat: number, lon: number) => void;
  /** Transparent overlay tile URLs (street/place labels) drawn ON TOP of the basemap. */
  overlayUrls?: string[];
  overlayAttribution?: string;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef<Map<string, L.Marker>>(new Map());
  const searchMarker = useRef<L.Marker | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const overlays = useRef<L.TileLayer[]>([]);
  const pickRef = useRef(pickMode);
  pickRef.current = pickMode;
  const centerCb = useRef(onCenterChange);
  centerCb.current = onCenterChange;

  useEffect(() => {
    if (!ref.current || map.current) return;
    const m = L.map(ref.current, { center: [20, 0], zoom: 2, attributionControl: true });
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => { if (pickRef.current) onPick(e.latlng.lat, e.latlng.lng); });
    m.on('moveend', () => { const c = m.getCenter(); centerCb.current?.(c.lat, c.lng); });
    map.current = m;
    // Leaflet measures the container on creation; nudge a resize after mount.
    setTimeout(() => m.invalidateSize(), 0);
  }, [onPick]);

  // Keep the map sized to its container. Leaflet caches the container size and renders grey
  // gaps when the pane grows/shrinks — on window resize, on split-pane drag, and (with the
  // keep-mounted minimize model) when the window is restored from display:none (0→N px fires
  // this too). A ResizeObserver in its own effect re-measures on every size change. Separate
  // from the init effect so the churny `onPick` dependency can't tear it down mid-session.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => map.current?.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (tiles.current) { tiles.current.remove(); tiles.current = null; }
    if (tilesEnabled && tileUrl) tiles.current = L.tileLayer(tileUrl, { attribution: tileAttribution }).addTo(m);
  }, [tilesEnabled, tileUrl, tileAttribution]);

  // Transparent label overlays on top of the basemap (zIndex above the base tiles). Rebuilt
  // whenever the URL set or the network gate changes; removed entirely when off.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const o of overlays.current) o.remove();
    overlays.current = [];
    if (!tilesEnabled) return;
    overlays.current = overlayUrls.map((url) =>
      L.tileLayer(url, { attribution: overlayAttribution, zIndex: 10, pane: 'tilePane' }).addTo(m)
    );
  }, [tilesEnabled, overlayUrls.join('|'), overlayAttribution]);

  // Recenter on a geocoded search hit. The `key` nonce makes repeated searches for the same
  // coordinates still fire (a new object each time), without re-running on unrelated renders.
  useEffect(() => {
    const m = map.current;
    if (!m || !flyTo) return;
    m.setView([flyTo.lat, flyTo.lon], 9);
    // Drop a single search pin at the hit. Added directly to the map (not the item `layer`
    // group) so item-layer rebuilds don't clear it; a new search replaces the prior pin.
    if (searchMarker.current) { searchMarker.current.remove(); searchMarker.current = null; }
    const sm = L.marker([flyTo.lat, flyTo.lon], { icon: searchPin })
      .bindPopup(`${flyTo.lat.toFixed(5)}, ${flyTo.lon.toFixed(5)}`)
      .addTo(m);
    searchMarker.current = sm;
    sm.openPopup();
  }, [flyTo?.key]);

  // Rebuild the marker layer only when the item SET changes (items is memoized upstream, so a pan that
  // merely re-renders the parent no longer thrashes the layer). Markers are kept by id so focus can
  // address them without rebuilding.
  useEffect(() => {
    const lg = layer.current;
    if (!lg) return;
    lg.clearLayers();
    markers.current.clear();
    for (const it of items) {
      if (it.lat == null || it.lon == null) continue;
      const mk = L.marker([it.lat, it.lon], { icon: buildIcon(it, corroboration.get(it.id) ?? 0) }).bindPopup(buildPopup(it.title, it.link));
      mk.addTo(lg);
      markers.current.set(it.id, mk);
    }
  }, [items, corroboration]);

  // Recenter + open the focused marker's popup ONLY when the focus actually changes. Keeping setView out
  // of the build effect breaks the setView→moveend→onCenterChange→re-render→rebuild loop that flashed the
  // popup in the centre and made dragging catch.
  useEffect(() => {
    const m = map.current;
    if (!m || !focusId) return;
    const mk = markers.current.get(focusId);
    if (mk) { m.setView(mk.getLatLng(), 6); mk.openPopup(); }
  }, [focusId]);

  return (
    <div className="ga98-geo-map-wrap">
      <div ref={ref} className="ga98-geo-map" />
      {(!tilesEnabled || !tileUrl) && (
        <div className="ga98-geo-map-placeholder">
          Map tiles disabled. Enable GeoINT network and set a tile-server URL to view the map.
          {pickMode ? ' (Pin mode is on — clicks still drop a pin once tiles load.)' : ''}
        </div>
      )}
    </div>
  );
}

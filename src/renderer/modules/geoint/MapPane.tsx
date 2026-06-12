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

const pin = L.divIcon({ className: 'ga98-geo-pin', html: '📍', iconSize: [16, 16], iconAnchor: [8, 16] });

export function MapPane({ items, tilesEnabled, tileUrl, tileAttribution, pickMode, onPick, focusId, flyTo, onCenterChange, overlayUrls = [], overlayAttribution = '' }: {
  items: GeoItem[];
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
    if (m && flyTo) m.setView([flyTo.lat, flyTo.lon], 9);
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
      const mk = L.marker([it.lat, it.lon], { icon: pin }).bindPopup(buildPopup(it.title, it.link));
      mk.addTo(lg);
      markers.current.set(it.id, mk);
    }
  }, [items]);

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

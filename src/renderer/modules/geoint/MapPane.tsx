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

const pin = L.divIcon({ className: 'ga98-geo-pin', html: '📍', iconSize: [16, 16], iconAnchor: [8, 16] });

export function MapPane({ items, tilesEnabled, tileUrl, tileAttribution, pickMode, onPick, focusId }: {
  items: GeoItem[];
  tilesEnabled: boolean;
  tileUrl: string;
  tileAttribution: string;
  pickMode: boolean;
  onPick: (lat: number, lon: number) => void;
  focusId: string | null;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const pickRef = useRef(pickMode);
  pickRef.current = pickMode;

  useEffect(() => {
    if (!ref.current || map.current) return;
    const m = L.map(ref.current, { center: [20, 0], zoom: 2, attributionControl: true });
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => { if (pickRef.current) onPick(e.latlng.lat, e.latlng.lng); });
    map.current = m;
    // Leaflet measures the container on creation; nudge a resize after mount.
    setTimeout(() => m.invalidateSize(), 0);
  }, [onPick]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (tiles.current) { tiles.current.remove(); tiles.current = null; }
    if (tilesEnabled && tileUrl) tiles.current = L.tileLayer(tileUrl, { attribution: tileAttribution }).addTo(m);
  }, [tilesEnabled, tileUrl, tileAttribution]);

  useEffect(() => {
    const lg = layer.current;
    const m = map.current;
    if (!lg || !m) return;
    lg.clearLayers();
    for (const it of items) {
      if (it.lat == null || it.lon == null) continue;
      const link = it.link ? `<br><a href="${it.link}" target="_blank" rel="noopener">open</a>` : '';
      const mk = L.marker([it.lat, it.lon], { icon: pin }).bindPopup(`<b>${it.title}</b>${link}`);
      mk.addTo(lg);
      if (it.id === focusId) { m.setView([it.lat, it.lon], 6); mk.openPopup(); }
    }
  }, [items, focusId]);

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

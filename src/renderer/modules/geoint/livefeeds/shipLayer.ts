// src/renderer/modules/geoint/livefeeds/shipLayer.ts
/** GPU GeoJSON layer for ships — one source + one circle layer, single color (vessel type deferred in v1).
 *  Updated imperatively each feed tick (source.setData). buildShipFeatures is pure + unit-tested. */
import maplibregl from 'maplibre-gl';
import type { ShipPos } from '@shared/livefeeds/types';

/** Minimal inline structural aliases — avoids depending on @types/geojson resolution. */
type SatFeatureCollection = { type: 'FeatureCollection'; features: SatFeature[] };
type SatFeature = { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: Record<string, unknown> };

export const SHIP_SOURCE_ID = 'ga98-ships';
export const SHIP_LAYER_ID = 'ga98-ships-circles';

const SHIP_COLOR = '#06d6a0';

export function buildShipFeatures(items: ShipPos[]): SatFeatureCollection {
  const features: SatFeature[] = [];
  for (const s of items) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { id: s.id, name: s.name, sogKt: s.sogKt, cogDeg: s.cogDeg }
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Create the source+layer once and wire feature clicks → onSelect(id). Idempotent, and a NO-OP
 *  until the style is fully loaded — MapLibre's `addSource`/`addLayer` throw "Style is not done
 *  loading" if called before then (e.g. from a `styledata` event mid-load), which would crash the
 *  map. Callers re-invoke on `load` + `styledata` until it sticks. */
export function ensureShipLayer(map: maplibregl.Map, onSelect: (id: string) => void): void {
  if (!map.isStyleLoaded()) return;
  if (map.getSource(SHIP_SOURCE_ID)) return;
  map.addSource(SHIP_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: SHIP_LAYER_ID, type: 'circle', source: SHIP_SOURCE_ID,
    paint: { 'circle-radius': 4, 'circle-color': SHIP_COLOR, 'circle-stroke-width': 0.5, 'circle-stroke-color': '#000' }
  });
  map.on('click', SHIP_LAYER_ID, (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === 'string') onSelect(id);
  });
  map.on('mouseenter', SHIP_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', SHIP_LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
}

export function updateShipLayer(map: maplibregl.Map, items: ShipPos[]): void {
  const src = map.getSource(SHIP_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  // cast: SatFeatureCollection is structurally GeoJSON.FeatureCollection; GeoJSON namespace not resolvable
  // in this tsconfig without @types/geojson in the types array — cast bridges the gap.
  if (src) src.setData(buildShipFeatures(items) as unknown as Parameters<typeof src.setData>[0]);
}

export function removeShipLayer(map: maplibregl.Map): void {
  if (map.getLayer(SHIP_LAYER_ID)) map.removeLayer(SHIP_LAYER_ID);
  if (map.getSource(SHIP_SOURCE_ID)) map.removeSource(SHIP_SOURCE_ID);
}

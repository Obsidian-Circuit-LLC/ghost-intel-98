// src/renderer/modules/geoint/satellites/satelliteLayer.ts
/** GPU GeoJSON layer for satellites — one source + one circle layer, color-coded by type. Updated
 *  imperatively each propagation tick (source.setData). Scales to ~10k points; MapLibre culls
 *  offscreen features. buildSatelliteFeatures is pure + unit-tested. */
import maplibregl from 'maplibre-gl';
import type { PropagatedSat, SatelliteType } from './types';

/** Minimal inline structural aliases — avoids depending on @types/geojson resolution. */
type SatFeatureCollection = { type: 'FeatureCollection'; features: SatFeature[] };
type SatFeature = { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: Record<string, unknown> };

export const SAT_SOURCE_ID = 'ga98-satellites';
export const SAT_LAYER_ID = 'ga98-satellites-circles';

export const SAT_TYPE_COLORS: Record<SatelliteType, string> = {
  starlink: '#ffd166', gps: '#06d6a0', weather: '#4cc9f0', comms: '#b388ff',
  'earth-obs': '#90be6d', station: '#ff6b6b', scientific: '#f7b2ad', other: '#cfd8dc'
};

export function buildSatelliteFeatures(
  sats: PropagatedSat[], visibleTypes: Set<SatelliteType> | null
): SatFeatureCollection {
  const features: SatFeature[] = [];
  for (const s of sats) {
    if (visibleTypes && !visibleTypes.has(s.type)) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { id: s.id, name: s.name, type: s.type, altKm: Math.round(s.altKm), velocityKmS: +s.velocityKmS.toFixed(2) }
    });
  }
  return { type: 'FeatureCollection', features };
}

const colorExpr = (): maplibregl.ExpressionSpecification => {
  const m: (string | maplibregl.ExpressionSpecification)[] = ['match', ['get', 'type']];
  for (const [k, v] of Object.entries(SAT_TYPE_COLORS)) m.push(k, v);
  m.push(SAT_TYPE_COLORS.other);
  return m as unknown as maplibregl.ExpressionSpecification;
};

/** Create the source+layer once and wire feature clicks → onSelect(id). Idempotent, and a NO-OP
 *  until the style is fully loaded — MapLibre's `addSource`/`addLayer` throw "Style is not done
 *  loading" if called before then (e.g. from a `styledata` event mid-load), which would crash the
 *  map. Callers re-invoke on `load` + `styledata` until it sticks. */
export function ensureSatelliteLayer(map: maplibregl.Map, onSelect: (id: string) => void): void {
  if (!map.isStyleLoaded()) return;
  if (map.getSource(SAT_SOURCE_ID)) return;
  map.addSource(SAT_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: SAT_LAYER_ID, type: 'circle', source: SAT_SOURCE_ID,
    paint: { 'circle-radius': 3, 'circle-color': colorExpr(), 'circle-stroke-width': 0.5, 'circle-stroke-color': '#000' }
  });
  map.on('click', SAT_LAYER_ID, (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === 'string') onSelect(id);
  });
  map.on('mouseenter', SAT_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', SAT_LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
}

export function updateSatelliteLayer(map: maplibregl.Map, sats: PropagatedSat[], visibleTypes: Set<SatelliteType> | null): void {
  const src = map.getSource(SAT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  // cast: SatFeatureCollection is structurally GeoJSON.FeatureCollection; GeoJSON namespace not resolvable
  // in this tsconfig without @types/geojson in the types array — cast bridges the gap.
  if (src) src.setData(buildSatelliteFeatures(sats, visibleTypes) as unknown as Parameters<typeof src.setData>[0]);
}

export function removeSatelliteLayer(map: maplibregl.Map): void {
  if (map.getLayer(SAT_LAYER_ID)) map.removeLayer(SAT_LAYER_ID);
  if (map.getSource(SAT_SOURCE_ID)) map.removeSource(SAT_SOURCE_ID);
}

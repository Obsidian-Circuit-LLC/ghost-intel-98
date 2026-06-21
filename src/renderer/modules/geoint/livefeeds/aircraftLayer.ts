// src/renderer/modules/geoint/livefeeds/aircraftLayer.ts
/** GPU GeoJSON layer for aircraft — one source + one circle layer, color-coded by altitude band.
 *  Updated imperatively each feed tick (source.setData). buildAircraftFeatures is pure + unit-tested. */
import maplibregl from 'maplibre-gl';
import type { AircraftPos } from '@shared/livefeeds/types';

/** Minimal inline structural aliases — avoids depending on @types/geojson resolution. */
type SatFeatureCollection = { type: 'FeatureCollection'; features: SatFeature[] };
type SatFeature = { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: Record<string, unknown> };

export const AIRCRAFT_SOURCE_ID = 'ga98-aircraft';
export const AIRCRAFT_LAYER_ID = 'ga98-aircraft-circles';

const BAND_COLORS: Record<string, string> = {
  ground: '#888',
  low: '#4cc9f0',
  mid: '#ffd166',
  high: '#ff6b6b',
};

export function buildAircraftFeatures(items: AircraftPos[]): SatFeatureCollection {
  const features: SatFeature[] = [];
  for (const a of items) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: { id: a.id, callsign: a.callsign, band: a.band, altFt: a.altFt, gsKt: a.gsKt }
    });
  }
  return { type: 'FeatureCollection', features };
}

const colorExpr = (): maplibregl.ExpressionSpecification => {
  const m: (string | maplibregl.ExpressionSpecification)[] = [
    'match', ['get', 'band'],
    'ground', BAND_COLORS.ground,
    'low',    BAND_COLORS.low,
    'mid',    BAND_COLORS.mid,
    'high',   BAND_COLORS.high,
    BAND_COLORS.ground,
  ];
  return m as unknown as maplibregl.ExpressionSpecification;
};

/** Create the source+layer once and wire feature clicks → onSelect(id). Idempotent, and a NO-OP
 *  until the style is fully loaded — MapLibre's `addSource`/`addLayer` throw "Style is not done
 *  loading" if called before then (e.g. from a `styledata` event mid-load), which would crash the
 *  map. Callers re-invoke on `load` + `styledata` until it sticks. */
export function ensureAircraftLayer(map: maplibregl.Map, onSelect: (id: string) => void): void {
  if (!map.isStyleLoaded()) return;
  if (map.getSource(AIRCRAFT_SOURCE_ID)) return;
  map.addSource(AIRCRAFT_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: AIRCRAFT_LAYER_ID, type: 'circle', source: AIRCRAFT_SOURCE_ID,
    paint: { 'circle-radius': 4, 'circle-color': colorExpr(), 'circle-stroke-width': 0.5, 'circle-stroke-color': '#000' }
  });
  map.on('click', AIRCRAFT_LAYER_ID, (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === 'string') onSelect(id);
  });
  map.on('mouseenter', AIRCRAFT_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', AIRCRAFT_LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
}

export function updateAircraftLayer(map: maplibregl.Map, items: AircraftPos[]): void {
  const src = map.getSource(AIRCRAFT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  // cast: SatFeatureCollection is structurally GeoJSON.FeatureCollection; GeoJSON namespace not resolvable
  // in this tsconfig without @types/geojson in the types array — cast bridges the gap.
  if (src) src.setData(buildAircraftFeatures(items) as unknown as Parameters<typeof src.setData>[0]);
}

export function removeAircraftLayer(map: maplibregl.Map): void {
  if (map.getLayer(AIRCRAFT_LAYER_ID)) map.removeLayer(AIRCRAFT_LAYER_ID);
  if (map.getSource(AIRCRAFT_SOURCE_ID)) map.removeSource(AIRCRAFT_SOURCE_ID);
}

import { describe, it, expect } from 'vitest';
import { buildSatelliteFeatures } from '../src/renderer/modules/geoint/satellites/satelliteLayer';
import type { PropagatedSat } from '../src/renderer/modules/geoint/satellites/types';

const mk = (id: string, type: PropagatedSat['type'], lon: number, lat: number): PropagatedSat => ({
  id, name: id, noradId: 1, type, lat, lon, altKm: 500, velocityKmS: 7.5, inclinationDeg: 53, active: true
});

describe('buildSatelliteFeatures', () => {
  it('emits one point feature per sat in [lng, lat] order with props', () => {
    const fc = buildSatelliteFeatures([mk('a', 'starlink', 10, 20)], null);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [10, 20] });
    expect(fc.features[0].properties).toMatchObject({ id: 'a', type: 'starlink' });
  });
  it('applies the type filter when a Set is given', () => {
    const fc = buildSatelliteFeatures([mk('a', 'starlink', 0, 0), mk('b', 'gps', 1, 1)], new Set(['gps'] as const));
    expect(fc.features.map((f) => f.properties!.id)).toEqual(['b']);
  });
  it('null filter passes everything', () => {
    expect(buildSatelliteFeatures([mk('a', 'gps', 0, 0), mk('b', 'weather', 1, 1)], null).features).toHaveLength(2);
  });
});

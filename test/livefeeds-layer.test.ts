import { describe, it, expect } from 'vitest';
import { buildAircraftFeatures } from '../src/renderer/modules/geoint/livefeeds/aircraftLayer';
import { buildShipFeatures } from '../src/renderer/modules/geoint/livefeeds/shipLayer';

describe('buildAircraftFeatures', () => {
  it('one point per aircraft, [lng,lat] order, band + id props', () => {
    const fc = buildAircraftFeatures([{ id: 'h', callsign: 'X', lat: 52, lon: 1, altFt: 30000, gsKt: 400, trackDeg: 90, band: 'mid' }]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [1, 52] });
    expect(fc.features[0].properties).toMatchObject({ id: 'h', band: 'mid' });
  });
});
describe('buildShipFeatures', () => {
  it('one point per ship, [lng,lat] order, id prop', () => {
    const fc = buildShipFeatures([{ id: 'm', name: 'S', lat: 60, lon: 5, sogKt: 10, cogDeg: 180, type: 'other', lastSeen: 0 }]);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [5, 60] });
    expect(fc.features[0].properties).toMatchObject({ id: 'm' });
  });
});

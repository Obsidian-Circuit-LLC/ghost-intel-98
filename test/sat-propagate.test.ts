import { describe, it, expect } from 'vitest';
import { makePropagator } from '../src/renderer/modules/geoint/satellites/propagate';
import type { SatelliteRecord } from '../src/renderer/modules/geoint/satellites/types';

const iss: SatelliteRecord = {
  id: 'sat-25544', name: 'ISS (ZARYA)', noradId: 25544,
  line1: '1 25544U 98067A   24079.07757601  .00016717  00000-0  30532-3 0  9993',
  line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49815308434500',
  type: 'station', source: 'celestrak', active: true, addedAt: ''
};

describe('makePropagator', () => {
  const at = new Date('2024-03-19T12:00:00Z'); // fixed epoch → deterministic

  it('propagates the ISS to a plausible LEO position', () => {
    const [s] = makePropagator([iss]).propagateAt(at);
    expect(s.id).toBe('sat-25544');
    expect(s.lat).toBeGreaterThanOrEqual(-90); expect(s.lat).toBeLessThanOrEqual(90);
    expect(s.lon).toBeGreaterThanOrEqual(-180); expect(s.lon).toBeLessThanOrEqual(180);
    expect(s.altKm).toBeGreaterThan(300); expect(s.altKm).toBeLessThan(460);   // ISS ~410 km
    expect(s.velocityKmS).toBeGreaterThan(7); expect(s.velocityKmS).toBeLessThan(8); // ~7.66 km/s
    expect(s.inclinationDeg).toBeCloseTo(51.64, 1);
  });

  it('is deterministic for a fixed date', () => {
    const a = makePropagator([iss]).propagateAt(at);
    const b = makePropagator([iss]).propagateAt(at);
    expect(b).toEqual(a);
  });

  it('drops records SGP4 cannot propagate without throwing', () => {
    const bad: SatelliteRecord = { ...iss, id: 'sat-bad', line1: '1 00000U', line2: '2 00000' };
    expect(makePropagator([bad]).propagateAt(at)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { boundsToRadius, boundsToAisSubscription } from '../src/shared/livefeeds/bbox';

const b = { west: -1, south: 51, east: 1, north: 53 };

describe('boundsToRadius', () => {
  it('centers the box and returns a capped NM radius', () => {
    const r = boundsToRadius(b);
    expect(r.lat).toBeCloseTo(52, 5);
    expect(r.lon).toBeCloseTo(0, 5);
    expect(r.radiusNm).toBeGreaterThan(0);
    expect(r.radiusNm).toBeLessThanOrEqual(250); // adsb.lol cap
  });
  it('caps the radius at 250 NM for a huge box', () => {
    expect(boundsToRadius({ west: -120, south: -40, east: 120, north: 60 }).radiusNm).toBe(250);
  });
});

describe('boundsToAisSubscription', () => {
  it('emits a single bbox of two [lat,lon] corners (SW-ish, NE-ish)', () => {
    const sub = boundsToAisSubscription(b);
    expect(sub).toEqual([[[53, -1], [51, 1]]]); // [[ [north,west], [south,east] ]]
  });
});

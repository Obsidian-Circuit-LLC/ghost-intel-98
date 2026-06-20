import { describe, it, expect } from 'vitest';
import { pickGeo } from '../src/main/services/streams';

describe('pickGeo coordinate gating', () => {
  it('keeps an in-range lat/lon pair', () => {
    expect(pickGeo({ lat: -33.8, lon: 151.2 })).toEqual({ lat: -33.8, lon: 151.2 });
  });
  it('drops BOTH when lat is out of range', () => {
    const g = pickGeo({ lat: 500, lon: 151.2 });
    expect(g.lat).toBeUndefined();
    expect(g.lon).toBeUndefined();
  });
  it('drops BOTH when lon is out of range', () => {
    const g = pickGeo({ lat: 33.8, lon: 999 });
    expect(g.lat).toBeUndefined();
    expect(g.lon).toBeUndefined();
  });
  it('drops a lone latitude (no longitude)', () => {
    expect(pickGeo({ lat: 33.8 }).lat).toBeUndefined();
  });
  it('drops a lone longitude (no latitude)', () => {
    expect(pickGeo({ lon: 151.2 }).lon).toBeUndefined();
  });
  it('drops a non-finite coordinate', () => {
    expect(pickGeo({ lat: NaN, lon: 10 })).toEqual({});
  });
  it('keeps country/region/city independently of coordinates', () => {
    expect(pickGeo({ country: 'Australia', city: 'Sydney', lat: 500, lon: 1 })).toEqual({ country: 'Australia', city: 'Sydney' });
  });
});

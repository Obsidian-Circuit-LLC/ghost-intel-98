import { describe, it, expect } from 'vitest';
import { parseAdsb } from '../src/shared/livefeeds/adsbParse';

describe('parseAdsb', () => {
  it('maps a normal airborne aircraft, trimming the space-padded flight', () => {
    const out = parseAdsb({ ac: [{ hex: 'a53f20', flight: 'SWA2896 ', t: 'B737', alt_baro: 2100, gs: 202.5, track: 343.35, lat: 40.819153, lon: -73.90387 }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a53f20', callsign: 'SWA2896', altFt: 2100, gsKt: 202.5, trackDeg: 343.35, band: 'low' });
  });
  it('handles alt_baro "ground" (altFt null, band ground) and track absent → true_heading', () => {
    const out = parseAdsb({ ac: [{ hex: 'ac5087', flight: 'N893AP  ', alt_baro: 'ground', gs: 0, true_heading: 22.5, lat: 40.735096, lon: -73.97287 }] });
    expect(out[0]).toMatchObject({ id: 'ac5087', altFt: null, band: 'ground', trackDeg: 22.5 });
  });
  it('drops entries failing the coordinate gate; never throws on garbage', () => {
    expect(parseAdsb({ ac: [{ hex: 'x', lat: 999, lon: 0 }, { hex: 'y' }] })).toEqual([]);
    expect(parseAdsb(null)).toEqual([]);
    expect(parseAdsb({})).toEqual([]);
  });
  it('assigns altitude bands', () => {
    const band = (alt: number): string => parseAdsb({ ac: [{ hex: 'h', lat: 0, lon: 0, alt_baro: alt }] })[0].band;
    expect(band(500)).toBe('low');     // <10k
    expect(band(20000)).toBe('mid');   // 10k–30k
    expect(band(38000)).toBe('high');  // >30k
  });
});

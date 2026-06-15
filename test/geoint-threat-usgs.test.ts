import { describe, it, expect } from 'vitest';
import { parseUsgs, isUsgsFeed, USGS_FEEDS, DEFAULT_USGS_FEED } from '../src/main/geoint/threat-layers/usgs';
import { fetchThreatLayer } from '../src/main/geoint/threat-layers';
import { ensureThreatLayerId } from '../src/main/security/validate';

// A small fixture FeatureCollection covering the cases the parser must get right:
//  - valid feature (lon-first coords, place/url/time/mag present)
//  - high/medium/low magnitude → severity
//  - out-of-range lon (off-globe), NaN-ish coord, missing geometry → all dropped (no (0,0))
//  - missing id → dropped (no unstable id)
const fixture = {
  type: 'FeatureCollection',
  features: [
    { id: 'a1', properties: { place: '10km N of Tokyo', url: 'https://usgs.gov/a1', time: 1700000000000, mag: 6.2 },
      geometry: { type: 'Point', coordinates: [139.69, 35.68, 30] } }, // valid, high
    { id: 'a2', properties: { place: 'off Chile', url: 'https://usgs.gov/a2', time: 1700000001000, mag: 4.5 },
      geometry: { type: 'Point', coordinates: [-70.5, -33.4, 10] } }, // valid, medium
    { id: 'a3', properties: { place: 'somewhere', time: 1700000002000, mag: 1.1 },
      geometry: { type: 'Point', coordinates: [0, 0, 0] } }, // valid (0,0 is on-globe), low — kept
    { id: 'bad-lon', properties: { place: 'off-globe', mag: 3 },
      geometry: { type: 'Point', coordinates: [200, 5, 0] } }, // out-of-range lon → DROP
    { id: 'bad-nan', properties: { place: 'garbage', mag: 3 },
      geometry: { type: 'Point', coordinates: ['x', 10, 0] } }, // NaN lon → DROP
    { id: 'no-geom', properties: { place: 'no geometry', mag: 3 }, geometry: null }, // DROP
    { properties: { place: 'no id', mag: 3 }, geometry: { type: 'Point', coordinates: [1, 1] } } // no id → DROP
  ]
};

describe('parseUsgs', () => {
  const items = parseUsgs(fixture);

  it('maps lon-first coords to the correct lat/lon', () => {
    const a1 = items.find((i) => i.id === 'usgs:a1')!;
    expect(a1.lon).toBe(139.69);
    expect(a1.lat).toBe(35.68);
    expect(a1.located).toBe('geo');
    expect(a1.category).toBe('disaster');
    expect(a1.sourceId).toBe('threat:usgs');
    expect(a1.title).toBe('10km N of Tokyo');
    expect(a1.link).toBe('https://usgs.gov/a1');
    expect(a1.published).toBe(new Date(1700000000000).toISOString());
  });

  it('maps magnitude to severity (>=6 high, >=4 medium, else low)', () => {
    expect(items.find((i) => i.id === 'usgs:a1')!.severity).toBe('high');
    expect(items.find((i) => i.id === 'usgs:a2')!.severity).toBe('medium');
    expect(items.find((i) => i.id === 'usgs:a3')!.severity).toBe('low');
  });

  it('drops out-of-range / NaN / missing-geometry / missing-id features (no silent (0,0))', () => {
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(['usgs:a1', 'usgs:a2', 'usgs:a3']);
    // None of the dropped features leaked a (0,0) or off-globe pin into the result.
    expect(items.some((i) => i.lon === 200)).toBe(false);
  });

  it('guards a non-finite time (no Invalid Date ISO)', () => {
    const r = parseUsgs({ features: [{ id: 'z', properties: { place: 'p', time: 'nope', mag: 2 }, geometry: { type: 'Point', coordinates: [10, 10] } }] });
    expect(r[0].published).toBeUndefined();
  });

  it('caps the result at the max', () => {
    const many = { features: Array.from({ length: 2500 }, (_, n) => ({ id: 'm' + n, properties: { place: 'p', time: 1, mag: 1 }, geometry: { type: 'Point', coordinates: [10, 10] } })) };
    expect(parseUsgs(many).length).toBe(2000);
  });

  it('tolerates non-object / empty input', () => {
    expect(parseUsgs(null)).toEqual([]);
    expect(parseUsgs({})).toEqual([]);
    expect(parseUsgs({ features: [] })).toEqual([]);
  });
});

describe('USGS feed-token allowlist', () => {
  it('accepts every allowlisted feed', () => {
    for (const f of USGS_FEEDS) expect(isUsgsFeed(f)).toBe(true);
    expect(isUsgsFeed(DEFAULT_USGS_FEED)).toBe(true);
  });
  it('rejects arbitrary tokens (no path injection into the URL)', () => {
    expect(isUsgsFeed('../../etc/passwd')).toBe(false);
    expect(isUsgsFeed('all_day.geojson')).toBe(false); // the suffix is added by the module
    expect(isUsgsFeed('')).toBe(false);
    expect(isUsgsFeed(undefined)).toBe(false);
    expect(isUsgsFeed(42)).toBe(false);
  });
});

describe('ensureThreatLayerId', () => {
  it('accepts the allowlisted ids', () => {
    expect(ensureThreatLayerId('usgs')).toBe('usgs');
  });
  it('rejects unknown ids', () => {
    expect(() => ensureThreatLayerId('nonsense')).toThrow();
    expect(() => ensureThreatLayerId('../usgs')).toThrow();
    expect(() => ensureThreatLayerId(123)).toThrow();
    expect(() => ensureThreatLayerId(undefined)).toThrow();
  });
});

describe('fetchThreatLayer dispatcher', () => {
  it('throws on an unknown layer id (defense in depth)', async () => {
    // @ts-expect-error — deliberately passing an off-allowlist id to exercise the throw.
    await expect(fetchThreatLayer('nope', {})).rejects.toThrow(/unknown threat layer/);
  });
});

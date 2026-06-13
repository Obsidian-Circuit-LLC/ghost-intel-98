import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRss, parseAtom, parseGeoJson, parseOpml, detectType } from '../src/main/geoint/feeds';

const fx = (n: string): string => readFileSync(resolve(__dirname, 'fixtures/geoint', n), 'utf8');
const mali = (t: string): { lat: number; lon: number; name: string } | null => (t.includes('Mali') ? { lat: 17, lon: -4, name: 'Mali' } : null);

describe('feed parsers', () => {
  it('parses RSS incl GeoRSS coords, geocodes the rest', () => {
    const items = parseRss(fx('rss.xml'), 's1', mali);
    expect(items[0]).toMatchObject({ title: 'Quake near Tokyo', lat: 35.68, lon: 139.69, located: 'geo' });
    expect(items[1]).toMatchObject({ title: 'Unrest in Mali', lat: 17, lon: -4, located: 'gazetteer', place: 'Mali' });
  });
  it('parses Atom entries', () => {
    const items = parseAtom(fx('atom.xml'), 's2', () => null);
    expect(items[0]).toMatchObject({ title: 'Border tension', link: 'http://y/1', located: 'none' });
  });
  it('parses GeoJSON point features ([lon,lat] order)', () => {
    const items = parseGeoJson(fx('points.geojson'), 's3');
    expect(items[0]).toMatchObject({ title: 'Paris event', lat: 48.8566, lon: 2.3522, located: 'geo' });
  });
  it('drops GeoJSON features with non-finite / out-of-range coordinates (no NaN-located item)', () => {
    // FIX 3: a feature whose coordinates parse to NaN (or fall outside lat/lon bounds) must NOT
    // produce a 'geo'-located item — a NaN pin is a silent mislocation in an OSINT tool.
    const fc = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: ['x', 10] }, properties: { title: 'Bad lon' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [null, 5] }, properties: { title: 'Null lon' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [200, 5] }, properties: { title: 'Out of range lon' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [10, 95] }, properties: { title: 'Out of range lat' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [2.35, 48.85] }, properties: { title: 'Good' } }
      ]
    });
    const items = parseGeoJson(fc, 's4');
    expect(items.map((i) => i.title)).toEqual(['Good']);
    expect(items.every((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon))).toBe(true);
  });
  it('parses OPML to sources with detected types', () => {
    expect(parseOpml(fx('sources.opml'))).toEqual([
      { label: 'Wire', url: 'http://feeds/wire.xml', type: 'rss' },
      { label: 'Quakes', url: 'http://feeds/quakes.geojson', type: 'geojson' }
    ]);
  });
  it('detects type from URL/body', () => {
    expect(detectType('http://x/feed.geojson', '')).toBe('geojson');
    expect(detectType('http://x/feed', '<feed xmlns="http://www.w3.org/2005/Atom">')).toBe('atom');
    expect(detectType('http://x/feed', '<rss>')).toBe('rss');
  });
});

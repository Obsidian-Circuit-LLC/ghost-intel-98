import { describe, it, expect } from 'vitest';
import { ensureGeoItem, isPublicHttpUrl, ensureGeoSource } from '../src/main/security/validate';

// Regression guards for the cycle-2 red-team findings (2026-05-31).

describe('ensureGeoItem (H1: validate the saveToCase item)', () => {
  const ok = { id: 'e1', sourceId: 's1', title: 'Quake', summary: 'm5', lat: 17, lon: -4, place: 'Mali', located: 'gazetteer' };

  it('accepts a well-formed item', () => {
    expect(ensureGeoItem(ok)).toMatchObject({ title: 'Quake', place: 'Mali', located: 'gazetteer' });
  });
  it('rejects an oversized place (would bypass MAX_ENTITY_VALUE via auto location-entity)', () => {
    expect(() => ensureGeoItem({ ...ok, place: 'B'.repeat(5_000_000) })).toThrow();
  });
  it('rejects an oversized title/summary', () => {
    expect(() => ensureGeoItem({ ...ok, title: 'A'.repeat(5_000_000) })).toThrow();
    expect(() => ensureGeoItem({ ...ok, summary: 'A'.repeat(5_000_000) })).toThrow();
  });
  it('rejects a bad located value and out-of-range coords', () => {
    expect(() => ensureGeoItem({ ...ok, located: 'evil' })).toThrow();
    expect(() => ensureGeoItem({ ...ok, lat: 999 })).toThrow();
    expect(() => ensureGeoItem({ ...ok, lon: -999 })).toThrow();
  });
  it('requires a title', () => {
    expect(() => ensureGeoItem({ ...ok, title: '' })).toThrow();
    expect(() => ensureGeoItem({ sourceId: 's', located: 'none' })).toThrow();
  });
});

describe('isPublicHttpUrl + ensureGeoSource (H2: SSRF guard)', () => {
  it('rejects loopback / private / link-local / metadata hosts', () => {
    expect(isPublicHttpUrl('http://127.0.0.1/x')).toBe(false);
    expect(isPublicHttpUrl('http://localhost/x')).toBe(false);
    expect(isPublicHttpUrl('http://10.0.0.1/x')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.5/x')).toBe(false);
    expect(isPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isPublicHttpUrl('http://[::1]/x')).toBe(false);
  });
  it('rejects non-http(s) schemes', () => {
    expect(isPublicHttpUrl('ftp://example.com/x')).toBe(false);
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('not a url')).toBe(false);
  });
  it('accepts a public http(s) URL', () => {
    expect(isPublicHttpUrl('https://feeds.example.com/geo.xml')).toBe(true);
  });
  it('ensureGeoSource rejects a private/loopback source URL', () => {
    expect(() => ensureGeoSource({ label: 'x', url: 'http://127.0.0.1/feed', type: 'rss' })).toThrow();
    expect(() => ensureGeoSource({ label: 'x', url: 'http://169.254.169.254/', type: 'rss' })).toThrow();
    expect(ensureGeoSource({ label: 'ok', url: 'https://feeds.example.com/x.xml', type: 'rss' }).url).toMatch(/^https:/);
  });
});

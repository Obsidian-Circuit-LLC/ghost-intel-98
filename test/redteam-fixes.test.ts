import { describe, it, expect } from 'vitest';
import { assertResolvedPublic, ensureBookmarkBoard, ensureMarketsSettings, isPublicHttpUrl } from '../src/main/security/validate';

// Finding 1 — DNS-aware SSRF guard. IP literals resolve locally (no network), so we can assert the
// private-address rejection offline. (Public-hostname rebind cases need live DNS and aren't unit-tested.)
describe('assertResolvedPublic (SSRF DNS guard)', () => {
  it('rejects hosts that resolve to loopback / private / link-local', async () => {
    await expect(assertResolvedPublic('127.0.0.1')).rejects.toThrow();
    await expect(assertResolvedPublic('10.0.0.1')).rejects.toThrow();
    await expect(assertResolvedPublic('169.254.169.254')).rejects.toThrow(); // cloud metadata
    await expect(assertResolvedPublic('::1')).rejects.toThrow();
  });
  it('allows a public IP literal', async () => {
    await expect(assertResolvedPublic('8.8.8.8')).resolves.toBeUndefined();
  });
});

// Finding 5 (SUPERSEDED v3.55.0) — the per-card resize feature was retired; cards auto-fit their
// links. The validator now DROPS any stored `height` on the get/save round-trip so no legacy board
// data can resurface a full-height card. This block now guards the retirement instead of the carry.
describe('ensureBookmarkBoard strips retired category height', () => {
  const h = (cat: object): unknown =>
    (ensureBookmarkBoard({ categories: [{ id: 'c', title: 'T', links: [], ...cat }], networkEnabled: false })
      .categories[0] as { height?: number }).height;
  it('drops a valid height (retired)', () => { expect(h({ height: 420 })).toBeUndefined(); });
  it('drops an out-of-range height (retired)', () => { expect(h({ height: 99999 })).toBeUndefined(); });
  it('is undefined when absent or non-numeric', () => {
    expect(h({})).toBeUndefined();
    expect(h({ height: 'tall' })).toBeUndefined();
  });
});

// Finding 3 — markets settings patch is bounded + URL-checked server-side.
describe('ensureMarketsSettings bounds + sanitizes', () => {
  it('drops non-string / empty watchlist entries', () => {
    const m = ensureMarketsSettings({ networkEnabled: true, watchlist: { crypto: ['bitcoin', 123, ''], fx: [], symbols: [] }, customFeeds: [] });
    expect(m.watchlist.crypto).toEqual(['bitcoin']);
    expect(m.networkEnabled).toBe(true);
  });
  it('rejects custom feeds whose URL is not public http(s)', () => {
    const m = ensureMarketsSettings({
      networkEnabled: false,
      watchlist: { crypto: [], fx: [], symbols: [] },
      customFeeds: [
        { id: 'x', label: 'Internal', url: 'http://127.0.0.1/q' },
        { id: 'y', label: 'File', url: 'file:///etc/passwd' },
        { label: 'Good', url: 'https://example.com/q' }
      ]
    });
    expect(m.customFeeds).toHaveLength(1);
    expect(m.customFeeds[0]).toMatchObject({ label: 'Good', url: 'https://example.com/q' });
  });
  it('agrees with isPublicHttpUrl on the textual layer', () => {
    expect(isPublicHttpUrl('https://example.com')).toBe(true);
    expect(isPublicHttpUrl('http://127.0.0.1/')).toBe(false);
  });
});

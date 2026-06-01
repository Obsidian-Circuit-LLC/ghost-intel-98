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

// Finding 5 — the per-card resize height must survive the ensureBookmarkBoard round-trip.
describe('ensureBookmarkBoard carries category height', () => {
  it('keeps a valid height', () => {
    const b = ensureBookmarkBoard({ categories: [{ id: 'c1', title: 'T', height: 420, links: [] }], networkEnabled: false });
    expect(b.categories[0].height).toBe(420);
  });
  it('clamps an out-of-range height', () => {
    const b = ensureBookmarkBoard({ categories: [{ id: 'c2', title: 'T', height: 99999, links: [] }], networkEnabled: false });
    expect(b.categories[0].height).toBe(4000);
  });
  it('leaves height undefined when absent or non-numeric', () => {
    expect(ensureBookmarkBoard({ categories: [{ id: 'c3', title: 'T', links: [] }], networkEnabled: false }).categories[0].height).toBeUndefined();
    expect(ensureBookmarkBoard({ categories: [{ id: 'c4', title: 'T', height: 'tall', links: [] }], networkEnabled: false }).categories[0].height).toBeUndefined();
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

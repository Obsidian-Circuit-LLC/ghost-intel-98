import { describe, it, expect } from 'vitest';
import { ensureBookmarkBoard } from '../src/main/security/validate';

// The Bookmarks board is renderer-supplied → hostile. ensureBookmarkBoard clamps + validates it
// before it touches disk: only http(s) links, bounded text, data:-URI favicons only.

describe('ensureBookmarkBoard', () => {
  it('round-trips a valid board and defaults networkEnabled to false', () => {
    const b = ensureBookmarkBoard({
      categories: [{ id: 'c1', title: 'Tools', links: [{ id: 'l1', name: 'Example', url: 'https://example.com' }] }]
    });
    expect(b.networkEnabled).toBe(false);
    expect(b.categories[0].title).toBe('Tools');
    expect(b.categories[0].links[0].url).toBe('https://example.com/');
  });

  it('drops non-http(s) links (no javascript:/file:/mailto: on the board)', () => {
    const b = ensureBookmarkBoard({
      categories: [{
        id: 'c', title: 'x', links: [
          { id: '1', name: 'bad', url: 'javascript:alert(1)' },
          { id: '2', name: 'bad2', url: 'file:///etc/passwd' },
          { id: '3', name: 'mail', url: 'mailto:a@b.com' },
          { id: '4', name: 'ok', url: 'https://ok.test' }
        ]
      }]
    });
    expect(b.categories[0].links).toHaveLength(1);
    expect(b.categories[0].links[0].url).toBe('https://ok.test/');
  });

  it('keeps a data: favicon but rejects a remote one and an oversized one', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(300 * 1024);
    const b = ensureBookmarkBoard({
      categories: [{
        id: 'c', title: 'x', links: [
          { id: '1', name: 'a', url: 'https://a.test', favicon: 'data:image/png;base64,AAAA' },
          { id: '2', name: 'b', url: 'https://b.test', favicon: 'https://evil.test/track.png' },
          { id: '3', name: 'c', url: 'https://c.test', favicon: big }
        ]
      }]
    });
    expect(b.categories[0].links[0].favicon).toBe('data:image/png;base64,AAAA');
    expect(b.categories[0].links[1].favicon).toBeUndefined(); // remote ref dropped
    expect(b.categories[0].links[2].favicon).toBeUndefined(); // oversized dropped
  });

  it('bounds title/name length and generates an id when missing', () => {
    const b = ensureBookmarkBoard({
      categories: [{ title: 'T'.repeat(500), links: [{ name: 'N'.repeat(500), url: 'https://x.test' }] }]
    });
    expect(b.categories[0].id).toMatch(/[0-9a-f-]{36}/);
    expect(b.categories[0].title.length).toBeLessThanOrEqual(200);
    expect(b.categories[0].links[0].name.length).toBeLessThanOrEqual(200);
  });

  it('preserves hyphens and spaces in names (control-char strip must not mangle them)', () => {
    const b = ensureBookmarkBoard({
      categories: [{ id: 'c', title: 'start-me ops', links: [{ id: 'l', name: 'op-center test', url: 'https://start.me' }] }]
    });
    expect(b.categories[0].title).toBe('start-me ops');
    expect(b.categories[0].links[0].name).toBe('op-center test');
  });

  it('tolerates garbage input', () => {
    expect(ensureBookmarkBoard(null)).toEqual({ categories: [], networkEnabled: false });
    expect(ensureBookmarkBoard({ categories: 'nope' })).toEqual({ categories: [], networkEnabled: false });
  });
});

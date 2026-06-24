import { describe, it, expect, beforeEach } from 'vitest';
import { loadFavicons, faviconFor, _resetForTest } from '@main/searchlight/site-db';

describe('searchlight favicons', () => {
  beforeEach(() => _resetForTest());

  it('returns the data-uri for a known site and null for unknown', () => {
    loadFavicons(() => ({ GitHub: 'data:image/png;base64,AAAA', Evil: 'javascript:alert(1)' }));
    expect(faviconFor('GitHub')).toBe('data:image/png;base64,AAAA');
    expect(faviconFor('Nope')).toBeNull();
  });

  it('drops non data:image values at load (trust boundary)', () => {
    loadFavicons(() => ({ Evil: 'javascript:alert(1)', Http: 'http://x/y.png' }));
    expect(faviconFor('Evil')).toBeNull();
    expect(faviconFor('Http')).toBeNull();
  });

  it('tolerates a missing favicons.json', () => {
    loadFavicons(() => { throw new Error('missing'); });
    expect(faviconFor('GitHub')).toBeNull();
  });
});

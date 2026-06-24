import { describe, it, expect, beforeEach } from 'vitest';
import { loadFavicons, faviconFor, _resetForTest } from '@main/searchlight/site-db';

describe('searchlight favicons', () => {
  beforeEach(() => _resetForTest());

  it('returns the data-uri for a known site and null for unknown', () => {
    loadFavicons(() => ({ GitHub: 'data:image/png;base64,AAAA', Evil: 'javascript:alert(1)' }));
    expect(faviconFor('GitHub')).toBe('data:image/png;base64,AAAA');
    expect(faviconFor('Nope')).toBeNull();
  });

  it('drops non data:image and SVG values at load (trust boundary)', () => {
    loadFavicons(() => ({
      Evil: 'javascript:alert(1)',
      Http: 'http://x/y.png',
      Svg: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      Png: 'data:image/png;base64,AAAA',
    }));
    expect(faviconFor('Evil')).toBeNull();
    expect(faviconFor('Http')).toBeNull();
    expect(faviconFor('Svg')).toBeNull();
    expect(faviconFor('Png')).toBe('data:image/png;base64,AAAA');
  });

  it('tolerates a missing favicons.json', () => {
    loadFavicons(() => { throw new Error('missing'); });
    expect(faviconFor('GitHub')).toBeNull();
  });
});

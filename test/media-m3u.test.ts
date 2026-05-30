import { describe, it, expect } from 'vitest';
import { parseM3u, toM3u } from '../src/main/media/m3u';

describe('m3u', () => {
  it('parses #EXTINF titles + local + http entries, resolving relative paths', () => {
    const text = '#EXTM3U\n#EXTINF:123,Artist - Song\n./sub/a.mp3\nhttp://radio/stream\n';
    expect(parseM3u(text, '/music/list')).toEqual([
      { title: 'Artist - Song', path: '/music/list/sub/a.mp3' },
      { title: 'http://radio/stream', url: 'http://radio/stream' }
    ]);
  });

  it('keeps absolute local paths and ignores blanks + unknown directives', () => {
    expect(parseM3u('\n# comment\n/abs.mp3\n', '/x')).toEqual([{ title: 'abs.mp3', path: '/abs.mp3' }]);
  });

  it('uses the EXTINF title only for the next entry', () => {
    const out = parseM3u('#EXTINF:1,Named\n/a.mp3\n/b.mp3\n', '/m');
    expect(out[0].title).toBe('Named');
    expect(out[1].title).toBe('b.mp3');
  });

  it('round-trips through toM3u', () => {
    const items = [{ title: 'A', path: '/m/a.mp3' }, { title: 'R', url: 'http://r/s' }];
    expect(parseM3u(toM3u(items), '/m')).toEqual([{ title: 'A', path: '/m/a.mp3' }, { title: 'R', url: 'http://r/s' }]);
  });
});

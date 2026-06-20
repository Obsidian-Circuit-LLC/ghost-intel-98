import { describe, it, expect } from 'vitest';
import { newsRenderMode, type NewsStream } from '../src/renderer/modules/geoint/NewsStreamView';

const hls: NewsStream = { label: 'A', url: 'https://cdn.example.com/live.m3u8', kind: 'hls' };
const yt: NewsStream = { label: 'B', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', kind: 'youtube' };
const ytBad: NewsStream = { label: 'C', url: 'https://www.youtube.com/watch?v=', kind: 'youtube' };

describe('newsRenderMode', () => {
  it('network OFF renders nothing playable, for every kind (egress-gate invariant)', () => {
    expect(newsRenderMode(hls, false)).toBe('offline');
    expect(newsRenderMode(yt, false)).toBe('offline');
    expect(newsRenderMode(ytBad, false)).toBe('offline');
  });
  it('network ON: hls plays', () => {
    expect(newsRenderMode(hls, true)).toBe('hls');
  });
  it('network ON: a parseable YouTube url embeds', () => {
    expect(newsRenderMode(yt, true)).toBe('youtube');
  });
  it('network ON: an unparseable YouTube url is flagged, not embedded', () => {
    expect(newsRenderMode(ytBad, true)).toBe('bad-youtube-id');
  });
});

import { describe, it, expect } from 'vitest';
import { newsWindowId, newsWindowSpec } from '../src/renderer/modules/geoint/newsWindow';
import type { NewsStream } from '../src/renderer/modules/geoint/NewsStreamView';

const a: NewsStream = { label: 'Bloomberg', url: 'https://x/live.m3u8', kind: 'hls' };
const aSameId: NewsStream = { label: 'Renamed', url: 'https://x/live.m3u8', kind: 'hls' };
const bUrl: NewsStream = { label: 'Bloomberg', url: 'https://y/live.m3u8', kind: 'hls' };
const bKind: NewsStream = { label: 'Bloomberg', url: 'https://x/live.m3u8', kind: 'youtube' };

describe('newsWindowId', () => {
  it('is stable across label changes (identity is kind+url)', () => {
    expect(newsWindowId(a)).toBe(newsWindowId(aSameId));
  });
  it('differs when the url differs', () => {
    expect(newsWindowId(a)).not.toBe(newsWindowId(bUrl));
  });
  it('differs when the kind differs', () => {
    expect(newsWindowId(a)).not.toBe(newsWindowId(bKind));
  });
  it('is namespaced to the module', () => {
    expect(newsWindowId(a)).toBe('news-view:hls:https://x/live.m3u8');
  });
});

describe('newsWindowSpec', () => {
  it('builds the exact open() argument', () => {
    expect(newsWindowSpec(a)).toEqual({
      module: 'news-view',
      id: 'news-view:hls:https://x/live.m3u8',
      title: 'Bloomberg',
      props: { stream: a },
      width: 640,
      height: 480
    });
  });
});

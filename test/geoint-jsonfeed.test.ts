import { describe, it, expect } from 'vitest';
import { parseJsonFeed, detectType } from '../src/main/geoint/feeds';

const feed = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'Sample Feed',
  items: [
    {
      id: 'a1',
      url: 'https://example.com/a1',
      title: 'First post',
      summary: 'A short summary',
      date_published: '2026-06-15T10:00:00Z',
      image: 'https://example.com/a1.png'
    },
    {
      // No id → falls back to url; no summary → uses content_text; banner_image as image.
      url: 'https://example.com/b2',
      title: 'Second post',
      content_text: 'plain body text',
      banner_image: 'https://example.com/b2-banner.png'
    },
    {
      // Only content_html → stripped to plain text for the summary.
      id: 'c3',
      url: 'https://example.com/c3',
      title: 'Third post',
      content_html: '<p>Hello <b>world</b></p>'
    },
    {
      // Almost everything missing — must not throw, title defaults to ''.
      id: 'd4'
    }
  ]
});

describe('parseJsonFeed', () => {
  it('maps title/url/summary/date/image and derives the id from sourceId + item id', () => {
    const items = parseJsonFeed(feed, 'src1');
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      id: 'src1:a1',
      sourceId: 'src1',
      title: 'First post',
      link: 'https://example.com/a1',
      summary: 'A short summary',
      published: '2026-06-15T10:00:00Z',
      image: 'https://example.com/a1.png',
      located: 'none'
    });
  });

  it('falls back: url for missing id, content_text/content_html for summary, banner_image for image', () => {
    const items = parseJsonFeed(feed, 'src1');
    expect(items[1]).toMatchObject({
      id: 'src1:https://example.com/b2',
      summary: 'plain body text',
      image: 'https://example.com/b2-banner.png'
    });
    expect(items[2].summary).toBe('Hello world'); // HTML stripped
  });

  it('tolerates missing fields (no throw; title defaults to empty)', () => {
    const items = parseJsonFeed(feed, 'src1');
    expect(items[3]).toMatchObject({ id: 'src1:d4', title: '', located: 'none' });
    expect(items[3].link).toBeUndefined();
    expect(items[3].image).toBeUndefined();
    expect(items[3].summary).toBeUndefined();
  });

  it('returns [] when items is not an array or body is not JSON', () => {
    expect(parseJsonFeed(JSON.stringify({ version: 'jsonfeed', items: {} }), 's')).toEqual([]);
    expect(parseJsonFeed(JSON.stringify({ version: 'jsonfeed' }), 's')).toEqual([]);
    expect(parseJsonFeed('not json', 's')).toEqual([]);
  });
});

describe('detectType — JSON Feed vs GeoJSON', () => {
  it('detects jsonfeed for a JSON Feed body', () => {
    expect(detectType('https://example.com/feed', feed)).toBe('jsonfeed');
  });
  it('still detects geojson for a FeatureCollection (GeoJSON wins)', () => {
    const fc = JSON.stringify({ type: 'FeatureCollection', features: [] });
    expect(detectType('https://example.com/data', fc)).toBe('geojson');
  });
  it('does not mistake a FeatureCollection that also has version/items for jsonfeed', () => {
    const fc = JSON.stringify({ type: 'FeatureCollection', version: 'jsonfeed', items: [{}], features: [] });
    expect(detectType('https://example.com/data', fc)).toBe('geojson');
  });
});

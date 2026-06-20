import { describe, it, expect } from 'vitest';
import { streamsToMasterTree } from '../src/main/services/cctv-export';
import { parseFeedList } from '../src/main/services/feed-import';
import type { CameraStream } from '../src/shared/post-mvp-types';

function cam(p: Partial<CameraStream> & { url: string }): CameraStream {
  return { id: p.id ?? p.url, label: p.label ?? 'c', url: p.url, kind: p.kind ?? 'mjpeg', caseId: null, addedAt: '2026-01-01T00:00:00Z', notes: '', ...p };
}

describe('streamsToMasterTree', () => {
  it('groups by country/region/city and emits coordinates when present', () => {
    const tree = streamsToMasterTree([
      cam({ url: 'http://a/1', country: 'Australia', region: 'New South Wales', city: 'Sydney', lat: -33.86785, lon: 151.20732 })
    ]);
    expect(tree).toEqual({
      Australia: { 'New South Wales': { Sydney: [{ stream_url: 'http://a/1', coordinates: { latitude: -33.86785, longitude: 151.20732 } }] } }
    });
  });

  it('omits coordinates when lat/lon are absent', () => {
    const tree = streamsToMasterTree([cam({ url: 'http://a/2', country: 'Armenia', region: 'Erevan', city: 'Yerevan' })]);
    expect(tree.Armenia.Erevan.Yerevan).toEqual([{ stream_url: 'http://a/2' }]);
  });

  it('buckets missing geo levels under "Unknown"', () => {
    const tree = streamsToMasterTree([cam({ url: 'http://a/3' })]);
    expect(tree).toEqual({ Unknown: { Unknown: { Unknown: [{ stream_url: 'http://a/3' }] } } });
  });

  it('emits country/region/city keys in sorted order', () => {
    const tree = streamsToMasterTree([
      cam({ url: 'http://a/z', country: 'Zambia', region: 'R', city: 'C' }),
      cam({ url: 'http://a/a', country: 'Angola', region: 'R', city: 'C' })
    ]);
    expect(Object.keys(tree)).toEqual(['Angola', 'Zambia']);
  });

  it('keeps multiple cameras in the same city in stable input order', () => {
    const tree = streamsToMasterTree([
      cam({ url: 'http://a/first', country: 'X', region: 'Y', city: 'Z' }),
      cam({ url: 'http://a/second', country: 'X', region: 'Y', city: 'Z' })
    ]);
    expect(tree.X.Y.Z.map((c) => c.stream_url)).toEqual(['http://a/first', 'http://a/second']);
  });

  it('round-trips through feed-import parseFeedList (url + coords + path stamps)', () => {
    const tree = streamsToMasterTree([
      cam({ url: 'http://a/rt', country: 'Australia', region: 'New South Wales', city: 'Sydney', lat: -33.86785, lon: 151.20732 })
    ]);
    const parsed = parseFeedList(JSON.stringify(tree));
    const f = parsed.find((p) => p.url === 'http://a/rt')!;
    expect(f).toBeDefined();
    expect(f.lat).toBe(-33.86785);
    expect(f.lon).toBe(151.20732);
    expect(f.country).toBe('Australia');
    expect(f.region).toBe('New South Wales');
    expect(f.city).toBe('Sydney');
  });
});

import { describe, it, expect } from 'vitest';
import { parseFeedList, inferKind, deriveLabel, feedToUpsert } from '../src/main/services/feed-import';

describe('inferKind', () => {
  it('maps schemes/extensions to kinds', () => {
    expect(inferKind('rtsp://10.0.0.5:554/h264')).toBe('rtsp');
    expect(inferKind('https://cam/live/index.m3u8')).toBe('hls');
    expect(inferKind('http://cam/clip.mp4')).toBe('mp4');
    expect(inferKind('http://cam/snapshot.jpg')).toBe('http');
    expect(inferKind('http://cam/mjpg/video.cgi')).toBe('mjpeg'); // default for http(s)
  });
});

describe('parseFeedList — auto-detect', () => {
  it('parses a JSON array of objects', () => {
    const json = JSON.stringify([
      { label: 'Front Door', url: 'https://cam/front.m3u8' },
      { name: 'Garage', url: 'rtsp://10.0.0.9:554/s', kind: 'rtsp' }
    ]);
    expect(parseFeedList(json)).toEqual([
      { label: 'Front Door', url: 'https://cam/front.m3u8', kind: 'hls' },
      { label: 'Garage', url: 'rtsp://10.0.0.9:554/s', kind: 'rtsp' }
    ]);
  });

  it('parses a JSON array of bare URL strings', () => {
    const json = JSON.stringify(['rtsp://10.0.0.1/a', 'http://cam/b.mp4']);
    expect(parseFeedList(json)).toEqual([
      { label: '10.0.0.1', url: 'rtsp://10.0.0.1/a', kind: 'rtsp' },
      { label: 'cam', url: 'http://cam/b.mp4', kind: 'mp4' }
    ]);
  });

  it('parses CSV with a header and an explicit kind, honoring quoted commas', () => {
    const csv = 'label,url,kind\n"Lobby, East",https://cam/lobby.m3u8,hls\nGate,rtsp://10.0.0.2/g\n';
    expect(parseFeedList(csv)).toEqual([
      { label: 'Lobby, East', url: 'https://cam/lobby.m3u8', kind: 'hls' },
      { label: 'Gate', url: 'rtsp://10.0.0.2/g', kind: 'rtsp' }
    ]);
  });

  it('parses a plain one-URL-per-line list, deriving labels + kinds', () => {
    const txt = '# my cameras\nhttps://cam1/live.m3u8\n\nrtsp://10.0.0.3:554/stream\n';
    expect(parseFeedList(txt)).toEqual([
      { label: 'cam1', url: 'https://cam1/live.m3u8', kind: 'hls' },
      { label: '10.0.0.3', url: 'rtsp://10.0.0.3:554/stream', kind: 'rtsp' }
    ]);
  });

  it('dedupes by URL (case-insensitive) and drops rows without a URL', () => {
    const txt = 'http://cam/a\njust some label,no url here\nHTTP://CAM/a\n';
    const out = parseFeedList(txt);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('http://cam/a');
  });

  it('deriveLabel falls back to the raw string on unparseable input', () => {
    expect(deriveLabel('not a url')).toBe('not a url');
  });
});

describe('parseFeedList — optional geo metadata (JSON)', () => {
  it('extracts country/region/city/lat/lon/source from JSON objects', () => {
    const json = JSON.stringify([
      { label: 'Parliament Sq', url: 'https://cam/ps.m3u8', country: 'GB', region: 'England', city: 'London', lat: 51.5007, lon: -0.1246, source: 'tfl-jamcams' }
    ]);
    expect(parseFeedList(json)).toEqual([
      {
        label: 'Parliament Sq', url: 'https://cam/ps.m3u8', kind: 'hls',
        country: 'GB', region: 'England', city: 'London', lat: 51.5007, lon: -0.1246, source: 'tfl-jamcams'
      }
    ]);
  });

  it('accepts state/latitude/longitude/lng aliases and coerces numeric strings', () => {
    const [f] = parseFeedList(JSON.stringify([{ url: 'https://cam/x.m3u8', state: 'CA', latitude: '34.05', longitude: '-118.24' }]));
    expect(f.region).toBe('CA');
    expect(f.lat).toBeCloseTo(34.05);
    expect(f.lon).toBeCloseTo(-118.24);
  });

  it('omits geo keys entirely when absent (no undefined noise breaking equality)', () => {
    const [f] = parseFeedList(JSON.stringify([{ url: 'https://cam/y.m3u8' }]));
    expect(Object.keys(f).sort()).toEqual(['kind', 'label', 'url']);
  });

  it('drops non-finite lat/lon rather than storing NaN', () => {
    const [f] = parseFeedList(JSON.stringify([{ url: 'https://cam/z.m3u8', lat: 'north', lon: '' }]));
    expect('lat' in f).toBe(false);
    expect('lon' in f).toBe(false);
  });
});

describe('parseFeedList — geo-aware header-mapped CSV', () => {
  it('imports geo columns when the header names them (order-independent, alias-aware)', () => {
    const csv = [
      'source,city,url,country,lat,lon,label,kind',
      'tfl-jamcams,London,https://cam/ps.m3u8,GB,51.5007,-0.1246,Parliament Sq,hls'
    ].join('\n');
    expect(parseFeedList(csv)).toEqual([
      {
        label: 'Parliament Sq', url: 'https://cam/ps.m3u8', kind: 'hls',
        country: 'GB', city: 'London', lat: 51.5007, lon: -0.1246, source: 'tfl-jamcams'
      }
    ]);
  });

  it('accepts src/state/latitude/longitude/town header aliases and coerces numeric strings', () => {
    const csv = 'name,src,state,town,latitude,longitude\nGarage,https://cam/g.m3u8,CA,Fresno,36.7,-119.8\n';
    const [f] = parseFeedList(csv);
    expect(f.label).toBe('Garage');
    expect(f.region).toBe('CA');
    expect(f.city).toBe('Fresno');
    expect(f.lat).toBeCloseTo(36.7);
    expect(f.lon).toBeCloseTo(-119.8);
  });

  it('omits geo for a row whose geo cells are blank (no undefined noise)', () => {
    const [f] = parseFeedList('url,city,lat,lon\nhttps://cam/x.m3u8,,,\n');
    expect(Object.keys(f).sort()).toEqual(['kind', 'label', 'url']);
  });

  it('honors quoted commas inside a geo cell', () => {
    const [f] = parseFeedList('url,city,country\nhttps://cam/y.m3u8,"Springfield, IL",US\n');
    expect(f.city).toBe('Springfield, IL');
    expect(f.country).toBe('US');
  });

  it('drops non-finite lat/lon from a CSV row rather than storing NaN', () => {
    const [f] = parseFeedList('url,lat,lon\nhttps://cam/z.m3u8,north,\n');
    expect('lat' in f).toBe(false);
    expect('lon' in f).toBe(false);
  });

  it('falls back to the positional (geo-unaware) path when the header names no URL column', () => {
    // No url-aliased column ⇒ not treated as a header; the bare header row drops (no URL) and the
    // data line parses positionally.
    expect(parseFeedList('label,kind\nhttps://cam/a.m3u8,hls\n')).toEqual([
      { label: 'cam', url: 'https://cam/a.m3u8', kind: 'hls' }
    ]);
  });
});

describe('parseFeedList — nested geo tree (insecam-style Country → Region → City → [urls])', () => {
  it('walks 3-level nesting, stamping country/region/city + a readable label per leaf', () => {
    const json = JSON.stringify({
      Australia: { 'New South Wales': { Sydney: ['http://220.233.144.165:8888/mjpg/video.mjpg'] } }
    });
    expect(parseFeedList(json)).toEqual([
      {
        url: 'http://220.233.144.165:8888/mjpg/video.mjpg',
        kind: 'mjpeg',
        label: 'Sydney · 220.233.144.165:8888',
        country: 'Australia',
        region: 'New South Wales',
        city: 'Sydney'
      }
    ]);
  });

  it('handles multiple cameras in one city and multiple cities/countries', () => {
    const json = JSON.stringify({
      Austria: { Niederosterreich: { Erlauf: ['http://85.255.155.178/a', 'http://85.255.155.179/b'] } },
      Armenia: { Erevan: { Yerevan: ['http://185.79.2.66:8081/c'] } }
    });
    const feeds = parseFeedList(json);
    expect(feeds).toHaveLength(3);
    expect(feeds.filter((f) => f.country === 'Austria')).toHaveLength(2);
    expect(feeds.every((f) => !!f.city && !!f.country)).toBe(true);
    expect(feeds[0]).toMatchObject({ country: 'Austria', region: 'Niederosterreich', city: 'Erlauf' });
  });

  it('maps 2-level nesting to country + city (no region) and 1-level to country only', () => {
    const two = parseFeedList(JSON.stringify({ Japan: { Tokyo: ['http://cam.jp/1'] } }))[0];
    expect(two).toMatchObject({ country: 'Japan', city: 'Tokyo' });
    expect(two.region).toBeUndefined();
    const one = parseFeedList(JSON.stringify({ Narnia: ['http://cam.nn/1'] }))[0];
    expect(one).toMatchObject({ country: 'Narnia' });
    expect(one.city).toBeUndefined();
    expect(one.region).toBeUndefined();
  });

  it('joins extra middle levels into region for deeper trees', () => {
    const json = JSON.stringify({ US: { California: { 'LA County': { 'Los Angeles': ['http://cam.us/1'] } } } });
    expect(parseFeedList(json)[0]).toMatchObject({ country: 'US', region: 'California / LA County', city: 'Los Angeles' });
  });

  it('keeps an explicit per-leaf object name/geo, overriding the path geo', () => {
    const json = JSON.stringify({
      UK: { England: { London: [{ url: 'http://cam.uk/1', name: 'Horse Guards Ave', city: 'Westminster' }] } }
    });
    const f = parseFeedList(json)[0];
    expect(f.label).toBe('Horse Guards Ave');
    expect(f.country).toBe('UK');
    expect(f.city).toBe('Westminster'); // the leaf object's explicit city overrides the path "London"
  });

  it('still parses a single flat object (regression)', () => {
    expect(parseFeedList(JSON.stringify({ url: 'http://cam/x.mp4', label: 'X' }))).toEqual([
      { url: 'http://cam/x.mp4', kind: 'mp4', label: 'X' }
    ]);
  });
});

describe('parseFeedList — GhostExodus scrape shape (stream_url key + nested coordinates)', () => {
  it('reads the URL from a stream_url key inside a nested geo tree', () => {
    const json = JSON.stringify({
      Argentina: { 'Ciudad Autonoma De Buenos Aires': { 'Buenos Aires': [
        { stream_url: 'http://190.210.250.149:91/mjpg/video.mjpg', coordinates: { latitude: -34.61315, longitude: -58.37723 } }
      ] } }
    });
    expect(parseFeedList(json)).toEqual([
      {
        url: 'http://190.210.250.149:91/mjpg/video.mjpg',
        kind: 'mjpeg',
        label: 'Buenos Aires · 190.210.250.149:91',
        country: 'Argentina',
        region: 'Ciudad Autonoma De Buenos Aires',
        city: 'Buenos Aires',
        lat: -34.61315,
        lon: -58.37723
      }
    ]);
  });

  it('reads the URL from a stream_url key in a flat JSON array', () => {
    const [f] = parseFeedList(JSON.stringify([
      { stream_url: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.09732.mp4', coordinates: { latitude: 51.5818, longitude: -0.15644 } }
    ]));
    expect(f.url).toBe('https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.09732.mp4');
    expect(f.kind).toBe('mp4');
    expect(f.lat).toBeCloseTo(51.5818);
    expect(f.lon).toBeCloseTo(-0.15644);
  });

  it('extracts lat/lon from a nested coordinates object (latitude/longitude)', () => {
    const [f] = parseFeedList(JSON.stringify([{ url: 'http://cam/x.mjpg', coordinates: { latitude: 40.18111, longitude: 44.51361 } }]));
    expect(f.lat).toBeCloseTo(40.18111);
    expect(f.lon).toBeCloseTo(44.51361);
  });

  it('tolerates a stream_url leaf with no coordinates (geo from the path only)', () => {
    const json = JSON.stringify({ Argentina: { Jujuy: { 'La Mendieta': [{ stream_url: 'http://179.62.210.138:8088/x.jpg' }] } } });
    const f = parseFeedList(json)[0];
    expect(f.url).toBe('http://179.62.210.138:8088/x.jpg');
    expect(f).toMatchObject({ country: 'Argentina', region: 'Jujuy', city: 'La Mendieta' });
    expect('lat' in f).toBe(false);
    expect('lon' in f).toBe(false);
  });

  it('lets an explicit flat lat/lon override the nested coordinates block', () => {
    const [f] = parseFeedList(JSON.stringify([{ url: 'http://cam/x', lat: 1.5, lon: 2.5, coordinates: { latitude: 9.9, longitude: 9.9 } }]));
    expect(f.lat).toBe(1.5);
    expect(f.lon).toBe(2.5);
  });
});

describe('feedToUpsert — carries geo through to the store payload', () => {
  it('passes present geo fields onto the upsert payload', () => {
    const [f] = parseFeedList(JSON.stringify([{ url: 'https://cam/a.m3u8', city: 'Paris', lat: 48.85, lon: 2.35 }]));
    expect(feedToUpsert(f)).toEqual({ label: 'cam', url: 'https://cam/a.m3u8', kind: 'hls', city: 'Paris', lat: 48.85, lon: 2.35 });
  });

  it('returns a clean label/url/kind payload when no geo is present', () => {
    const [f] = parseFeedList(JSON.stringify([{ url: 'https://cam/b.m3u8' }]));
    expect(feedToUpsert(f)).toEqual({ label: 'cam', url: 'https://cam/b.m3u8', kind: 'hls' });
  });
});

describe('feedToUpsert location stamp', () => {
  it('with no stamp, output is the feed unchanged', () => {
    expect(feedToUpsert({ label: 'x', url: 'https://c/x.m3u8', kind: 'hls' })).toEqual({ label: 'x', url: 'https://c/x.m3u8', kind: 'hls' });
  });
  it('stamp fills geo only where the feed lacks it (feed geo wins)', () => {
    const out = feedToUpsert({ label: 'x', url: 'https://c/x.m3u8', kind: 'hls', city: 'Austin' }, { country: 'United States', region: 'Texas', city: 'Dallas' });
    expect(out.country).toBe('United States');
    expect(out.region).toBe('Texas');
    expect(out.city).toBe('Austin');
  });
});

import { describe, it, expect } from 'vitest';
import { parseFeedList, inferKind, deriveLabel } from '../src/main/services/feed-import';

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

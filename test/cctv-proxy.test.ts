import { describe, it, expect } from 'vitest';
import {
  cctvProxyUrl,
  tryCctvProxyUrl,
  parseCctvProxyRequest,
  cctvRoutableKind,
  rewriteHlsManifest,
  bodyLooksLikeHlsManifest
} from '../src/shared/cctv/proxy';

describe('cctvProxyUrl', () => {
  it('round-trips with parseCctvProxyRequest for an https URL', () => {
    const origin = 'https://h/a?b=c';
    const proxy = cctvProxyUrl(origin);
    expect(parseCctvProxyRequest(proxy)).toBe(origin);
  });

  it('produces a ga98cctv://v1/ prefixed URL', () => {
    const proxy = cctvProxyUrl('https://example.com/stream.m3u8');
    expect(proxy.startsWith('ga98cctv://v1/')).toBe(true);
  });

  it('throws for a file:// URL', () => {
    expect(() => cctvProxyUrl('file:///x')).toThrow();
  });

  it('throws for an ftp:// URL', () => {
    expect(() => cctvProxyUrl('ftp://example.com/file')).toThrow();
  });

  it('throws for an rtsp:// URL', () => {
    expect(() => cctvProxyUrl('rtsp://cam.example.com/live')).toThrow();
  });

  it('throws for an empty string', () => {
    expect(() => cctvProxyUrl('')).toThrow();
  });

  it('accepts http:// URLs', () => {
    expect(() => cctvProxyUrl('http://cam.local/stream')).not.toThrow();
  });

  it('round-trips an http:// URL', () => {
    const origin = 'http://cam.local/stream?quality=high';
    expect(parseCctvProxyRequest(cctvProxyUrl(origin))).toBe(origin);
  });
});

describe('tryCctvProxyUrl', () => {
  it('returns null for a scheme-less path (e.g. cam/mjpg)', () => {
    expect(tryCctvProxyUrl('cam/mjpg')).toBeNull();
  });

  it('returns null for a scheme-less host (e.g. cam.local/stream)', () => {
    // new URL() treats this as a relative URL and throws — must not propagate
    expect(tryCctvProxyUrl('cam.local/stream')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(tryCctvProxyUrl('')).toBeNull();
  });

  it('returns null for an rtsp:// URL', () => {
    expect(tryCctvProxyUrl('rtsp://cam.example.com/live')).toBeNull();
  });

  it('returns null for a file:// URL', () => {
    expect(tryCctvProxyUrl('file:///etc/passwd')).toBeNull();
  });

  it('returns the ga98cctv:// proxy URL for a valid http:// URL', () => {
    const result = tryCctvProxyUrl('http://cam.local/stream');
    expect(result).not.toBeNull();
    expect(result!.startsWith('ga98cctv://v1/')).toBe(true);
  });

  it('returns the ga98cctv:// proxy URL for a valid https:// URL', () => {
    const result = tryCctvProxyUrl('https://cam.example.com/feed.mjpg');
    expect(result).not.toBeNull();
    expect(result!.startsWith('ga98cctv://v1/')).toBe(true);
  });

  it('round-trips a valid https URL through parseCctvProxyRequest', () => {
    const origin = 'https://cam.example.com/video.mp4';
    const proxy = tryCctvProxyUrl(origin);
    expect(proxy).not.toBeNull();
    expect(parseCctvProxyRequest(proxy!)).toBe(origin);
  });
});

describe('parseCctvProxyRequest', () => {
  it('returns null for an ftp scheme in the encoded origin', () => {
    const url = 'ga98cctv://v1/' + encodeURIComponent('ftp://x');
    expect(parseCctvProxyRequest(url)).toBeNull();
  });

  it('returns null for a malformed URL', () => {
    expect(parseCctvProxyRequest('ga98cctv://v1/not-percent-encoded!!')).toBeNull();
  });

  it('returns null for a non-ga98cctv scheme', () => {
    expect(parseCctvProxyRequest('https://example.com/stream')).toBeNull();
  });

  it('returns null for a ga98cctv URL missing the v1 prefix path', () => {
    expect(parseCctvProxyRequest('ga98cctv://other/' + encodeURIComponent('https://h/a'))).toBeNull();
  });

  it('returns the decoded origin for a valid https URL', () => {
    const origin = 'https://cdn.example.com/hls/stream.m3u8';
    expect(parseCctvProxyRequest('ga98cctv://v1/' + encodeURIComponent(origin))).toBe(origin);
  });
});

describe('cctvRoutableKind', () => {
  it('returns true for hls', () => {
    expect(cctvRoutableKind('hls')).toBe(true);
  });

  it('returns true for http', () => {
    expect(cctvRoutableKind('http')).toBe(true);
  });

  it('returns true for mjpeg', () => {
    expect(cctvRoutableKind('mjpeg')).toBe(true);
  });

  it('returns true for mp4', () => {
    expect(cctvRoutableKind('mp4')).toBe(true);
  });

  it('returns false for youtube', () => {
    expect(cctvRoutableKind('youtube')).toBe(false);
  });

  it('returns false for webpage', () => {
    expect(cctvRoutableKind('webpage')).toBe(false);
  });

  it('returns false for rtsp', () => {
    expect(cctvRoutableKind('rtsp')).toBe(false);
  });

  it('returns false for an unknown kind', () => {
    expect(cctvRoutableKind('unknown')).toBe(false);
  });
});

describe('rewriteHlsManifest', () => {
  const base = 'https://cdn.example.com/hls/stream.m3u8';

  it('rewrites a relative segment line to a ga98cctv:// URL', () => {
    const manifest = '#EXTM3U\n#EXTINF:10.0,\nseg0.ts\n';
    const result = rewriteHlsManifest(manifest, base);
    expect(result).toContain('ga98cctv://v1/');
    expect(result).toContain(encodeURIComponent('https://cdn.example.com/hls/seg0.ts'));
  });

  it('rewrites an absolute https segment line to a ga98cctv:// URL', () => {
    const manifest = '#EXTM3U\n#EXTINF:10.0,\nhttps://cdn.example.com/segments/x.ts\n';
    const result = rewriteHlsManifest(manifest, base);
    expect(result).toContain('ga98cctv://v1/');
    expect(result).toContain(encodeURIComponent('https://cdn.example.com/segments/x.ts'));
  });

  it('leaves #EXTINF comment lines unchanged', () => {
    const manifest = '#EXTM3U\n#EXTINF:10.0,\nseg0.ts\n';
    const result = rewriteHlsManifest(manifest, base);
    expect(result).toContain('#EXTINF:10.0,');
  });

  it('leaves #EXTM3U header unchanged', () => {
    const manifest = '#EXTM3U\n#EXTINF:10.0,\nseg0.ts\n';
    const result = rewriteHlsManifest(manifest, base);
    expect(result).toContain('#EXTM3U');
  });

  it('rewrites URI= attribute in EXT-X-KEY', () => {
    const manifest = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key.bin"\nseg0.ts\n';
    const result = rewriteHlsManifest(manifest, base);
    expect(result).toContain('ga98cctv://v1/');
    expect(result).toContain(encodeURIComponent('https://cdn.example.com/key.bin'));
  });

  it('preserves a comment line with no URI', () => {
    const manifest = '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:10.0,\nseg0.ts\n';
    const result = rewriteHlsManifest(manifest, base);
    expect(result).toContain('#EXT-X-VERSION:3');
  });

  it('does not produce any bare https:// URLs for routable segments', () => {
    const manifest = '#EXTM3U\n#EXTINF:10.0,\nhttps://cdn.example.com/seg1.ts\n#EXTINF:10.0,\nseg2.ts\n';
    const result = rewriteHlsManifest(manifest, base);
    // All segment lines should be rewritten; no absolute https:// segment line should remain bare
    const lines = result.split('\n').filter(l => !l.startsWith('#') && l.trim() !== '');
    for (const line of lines) {
      expect(line.startsWith('ga98cctv://')).toBe(true);
    }
  });
});

describe('bodyLooksLikeHlsManifest', () => {
  // Regression for the deanonymization finding: a hostile camera host serving a playlist on a
  // non-.m3u8 path with a non-mpegurl Content-Type must still be detected as a manifest so its
  // absolute segment/EXT-X-KEY URIs are rewritten onto ga98cctv:// instead of leaking to clearnet.
  it('detects a plain master playlist body', () => {
    expect(bodyLooksLikeHlsManifest('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://a/v.m3u8\n')).toBe(true);
  });

  it('detects a media playlist body', () => {
    expect(bodyLooksLikeHlsManifest('#EXTM3U\n#EXTINF:10,\nhttps://a/seg0.ts\n')).toBe(true);
  });

  it('detects a manifest preceded by a UTF-8 BOM', () => {
    expect(bodyLooksLikeHlsManifest('﻿#EXTM3U\n#EXTINF:10,\nseg0.ts\n')).toBe(true);
  });

  it('detects a manifest with leading whitespace (at least as lenient as hls.js)', () => {
    expect(bodyLooksLikeHlsManifest('  \n#EXTM3U\n')).toBe(true);
  });

  it('returns false for an MPEG-TS segment body', () => {
    // 0x47 sync byte — a real .ts segment must NOT be misread + corrupted as a manifest.
    expect(bodyLooksLikeHlsManifest('\x47\x40\x00\x10binary…')).toBe(false);
  });

  it('returns false for JSON / HTML / plain text', () => {
    expect(bodyLooksLikeHlsManifest('{"error":"nope"}')).toBe(false);
    expect(bodyLooksLikeHlsManifest('<html><body>cam</body></html>')).toBe(false);
    expect(bodyLooksLikeHlsManifest('')).toBe(false);
  });

  it('returns false for a body that merely contains #EXTM3U later (not first line)', () => {
    expect(bodyLooksLikeHlsManifest('garbage\n#EXTM3U')).toBe(false);
  });
});

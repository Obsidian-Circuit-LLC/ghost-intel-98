import { describe, it, expect } from 'vitest';
import { torProxyRules, resolveCctvSession, cctvPlayerUrl } from '../src/shared/cctv/tor';

describe('torProxyRules', () => {
  it('returns a socks5 rule for the given port', () => {
    expect(torProxyRules(9050)).toBe('socks5://127.0.0.1:9050');
  });

  it('uses the port verbatim', () => {
    expect(torProxyRules(9150)).toBe('socks5://127.0.0.1:9150');
  });
});

describe('resolveCctvSession', () => {
  it('returns DISABLED when enabled is false', () => {
    const r = resolveCctvSession({ enabled: false, torPort: 9050 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('DISABLED');
  });

  it('returns TOR_UNAVAILABLE when enabled but torPort is null', () => {
    const r = resolveCctvSession({ enabled: true, torPort: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('TOR_UNAVAILABLE');
  });

  it('returns ok:true with the correct partition and proxyRules when enabled and port present', () => {
    const r = resolveCctvSession({ enabled: true, torPort: 9050 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.partition).toBe('persist:cctv-tor');
      expect(r.proxyRules).toBe('socks5://127.0.0.1:9050');
    }
  });

  it('returns DISABLED when enabled is false even if torPort is null', () => {
    const r = resolveCctvSession({ enabled: false, torPort: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('DISABLED');
  });
});

describe('cctvPlayerUrl', () => {
  it('encodes the url with encodeURIComponent', () => {
    const result = cctvPlayerUrl({ kind: 'hls', url: 'https://h/a?b=c&d' });
    expect(result).toContain(encodeURIComponent('https://h/a?b=c&d'));
  });

  it('includes the kind in the result', () => {
    const result = cctvPlayerUrl({ kind: 'hls', url: 'https://h/stream.m3u8' });
    expect(result).toContain('hls');
  });

  it('accepts all whitelisted kinds', () => {
    for (const kind of ['hls', 'http', 'mjpeg', 'mp4']) {
      expect(() => cctvPlayerUrl({ kind, url: 'https://example.com/stream' })).not.toThrow();
    }
  });

  it('throws on an unknown kind', () => {
    expect(() => cctvPlayerUrl({ kind: 'rtsp', url: 'https://example.com/stream' })).toThrow();
  });

  it('throws on youtube kind (handled outside player)', () => {
    expect(() => cctvPlayerUrl({ kind: 'youtube', url: 'https://youtube.com/watch?v=x' })).toThrow();
  });
});

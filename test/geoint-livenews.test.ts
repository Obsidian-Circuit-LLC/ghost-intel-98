import { describe, it, expect } from 'vitest';
import { parseYouTubeId, validateStreamUrl } from '../src/renderer/modules/geoint/LiveNewsPanel';

// R12 Live News panel pure helpers. The security-load-bearing properties:
//  - parseYouTubeId only yields an id for a real YouTube host (no host-masquerade embeds);
//  - validateStreamUrl blocks javascript:/data:/non-http(s) and private hosts for HLS, and only
//    accepts parseable YouTube URLs for kind 'youtube'.

describe('parseYouTubeId', () => {
  it('extracts the id from watch?v= form', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=10s')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the id from youtu.be/ form', () => {
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the id from youtube.com/live/ form', () => {
    expect(parseYouTubeId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the id from embed/ form', () => {
    expect(parseYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for non-youtube / malformed URLs', () => {
    expect(parseYouTubeId('https://vimeo.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeId('not a url')).toBeNull();
    expect(parseYouTubeId('')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/feed/subscriptions')).toBeNull();
  });

  it('rejects ids of the wrong length', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/watch?v=waytoolongvideoid123')).toBeNull();
    expect(parseYouTubeId('https://youtu.be/short')).toBeNull();
  });

  it('does NOT accept an arbitrary host masquerading as YouTube', () => {
    expect(parseYouTubeId('https://evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeId('https://evil.com/embed/dQw4w9WgXcQ')).toBeNull();
    // Lookalike subdomains / suffixes on the wrong registrable domain must not match.
    expect(parseYouTubeId('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeId('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('rejects non-http(s) schemes even on a youtube path', () => {
    expect(parseYouTubeId('javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeId('data:text/html,youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
});

describe('validateStreamUrl', () => {
  describe('hls', () => {
    it('accepts a public https .m3u8 URL', () => {
      expect(validateStreamUrl('https://example.com/live/stream.m3u8', 'hls')).toBe(true);
      expect(validateStreamUrl('http://news.example.org/playlist.m3u8?token=x', 'hls')).toBe(true);
      // Public http(s) without an explicit .m3u8 is still acceptable (some manifests omit it).
      expect(validateStreamUrl('https://example.com/live/index', 'hls')).toBe(true);
    });

    it('rejects non-http(s) and dangerous schemes', () => {
      expect(validateStreamUrl('javascript:alert(1)', 'hls')).toBe(false);
      expect(validateStreamUrl('data:text/plain,hi', 'hls')).toBe(false);
      expect(validateStreamUrl('file:///etc/passwd', 'hls')).toBe(false);
      expect(validateStreamUrl('ftp://example.com/x.m3u8', 'hls')).toBe(false);
      expect(validateStreamUrl('not a url', 'hls')).toBe(false);
    });

    it('rejects private / loopback / link-local hosts', () => {
      expect(validateStreamUrl('http://localhost/x.m3u8', 'hls')).toBe(false);
      expect(validateStreamUrl('http://127.0.0.1/x.m3u8', 'hls')).toBe(false);
      expect(validateStreamUrl('http://10.0.0.5/x.m3u8', 'hls')).toBe(false);
      expect(validateStreamUrl('http://192.168.1.10/x.m3u8', 'hls')).toBe(false);
      expect(validateStreamUrl('http://172.16.5.5/x.m3u8', 'hls')).toBe(false);
      expect(validateStreamUrl('http://169.254.1.1/x.m3u8', 'hls')).toBe(false);
      expect(validateStreamUrl('http://router.local/x.m3u8', 'hls')).toBe(false);
    });
  });

  describe('youtube', () => {
    it('accepts parseable youtube URLs', () => {
      expect(validateStreamUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube')).toBe(true);
      expect(validateStreamUrl('https://youtu.be/dQw4w9WgXcQ', 'youtube')).toBe(true);
      expect(validateStreamUrl('https://www.youtube.com/live/dQw4w9WgXcQ', 'youtube')).toBe(true);
    });

    it('rejects non-youtube / host-masquerade / malformed', () => {
      expect(validateStreamUrl('https://vimeo.com/123', 'youtube')).toBe(false);
      expect(validateStreamUrl('https://evil.com/watch?v=dQw4w9WgXcQ', 'youtube')).toBe(false);
      expect(validateStreamUrl('javascript:alert(1)', 'youtube')).toBe(false);
      expect(validateStreamUrl('https://www.youtube.com/watch?v=short', 'youtube')).toBe(false);
    });
  });
});

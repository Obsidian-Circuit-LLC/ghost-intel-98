import { describe, it, expect } from 'vitest';
import { parseYouTubeId, youtubeEmbedSrc } from '../src/shared/youtube';

// parseYouTubeId is the load-bearing security check for BOTH the GeoINT Live News panel and the
// EyeSpy camera Viewer: only a real YouTube host may yield an embeddable id, so a YouTube-shaped path
// on an attacker host can never be framed under the single youtube-nocookie frame-src exception.

describe('parseYouTubeId', () => {
  it('parses watch?v= on the youtube hosts', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=10s')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('parses youtu.be short links (with/without query)', () => {
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe('dQw4w9WgXcQ');
  });
  it('parses /live /embed /shorts /v paths', () => {
    expect(parseYouTubeId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://www.youtube.com/v/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('rejects a YouTube-shaped path on a NON-YouTube host', () => {
    expect(parseYouTubeId('https://evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeId('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeId('https://notyoutu.be/dQw4w9WgXcQ')).toBeNull();
  });
  it('rejects non-http(s) schemes', () => {
    expect(parseYouTubeId('javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeId('file:///watch?v=dQw4w9WgXcQ')).toBeNull();
  });
  it('rejects ids of the wrong shape and unparseable URLs', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=tooShort')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/watch?v=waaaaytoolong123')).toBeNull();
    expect(parseYouTubeId('not a url')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/')).toBeNull();
  });
});

describe('youtubeEmbedSrc', () => {
  it('builds a youtube-nocookie embed URL with autoplay+mute', () => {
    expect(youtubeEmbedSrc('dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1');
  });
});

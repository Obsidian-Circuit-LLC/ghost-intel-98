/**
 * YouTube URL parsing, shared by the GeoINT Live News panel and the EyeSpy camera Viewer.
 * Pure + DOM-free (uses the WHATWG `URL`, available in both the renderer and Node tests) so it
 * is unit-testable without rendering.
 *
 * Security: a YouTube-shaped path on a NON-YouTube host (e.g. evil.com/watch?v=…) must never yield
 * an embeddable id — otherwise we'd frame attacker-controlled content under the single
 * youtube-nocookie embed exception to the renderer frame-src invariant. The host allowlist is the
 * load-bearing check.
 */

// Hosts we will treat as YouTube. Anything else yields null even with a `watch?v=` query.
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be'
]);

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extract the 11-char YouTube video id from a watch / youtu.be / live / embed / shorts URL.
 * Returns null for any non-YouTube host, any unparseable URL, any non-http(s) scheme, or any id of
 * the wrong shape.
 */
export function parseYouTubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  let candidate: string | null = null;
  if (host === 'youtu.be') {
    // https://youtu.be/<id>
    candidate = u.pathname.split('/').filter(Boolean)[0] ?? null;
  } else {
    const v = u.searchParams.get('v');
    if (v) {
      candidate = v;
    } else {
      // /live/<id>, /embed/<id>, /shorts/<id>, /v/<id>
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && (parts[0] === 'live' || parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'v')) {
        candidate = parts[1];
      }
    }
  }
  if (candidate && YT_ID.test(candidate)) return candidate;
  return null;
}

/** The sandboxed embed URL for a parsed id. autoplay+mute so it behaves like the other live tiles. */
export function youtubeEmbedSrc(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1`;
}

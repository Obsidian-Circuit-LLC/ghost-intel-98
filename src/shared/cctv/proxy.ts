/**
 * Pure helpers for the ga98cctv:// main-side CCTV proxy.
 * No Electron or Node imports — safe to import from renderer, main, and tests.
 */

const PROXY_SCHEME = 'ga98cctv';
const PROXY_VERSION = 'v1';
const PROXY_PREFIX = `${PROXY_SCHEME}://${PROXY_VERSION}/`;

/** Allowed origin schemes for proxying. Only http and https. */
function isAllowedScheme(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/**
 * Encodes an origin http(s) URL into the ga98cctv:// proxy scheme.
 *
 * @throws if `originUrl` is not a valid http or https URL.
 */
export function cctvProxyUrl(originUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(originUrl);
  } catch {
    throw new Error(`cctvProxyUrl: invalid URL "${originUrl}"`);
  }
  if (!isAllowedScheme(parsed)) {
    throw new Error(
      `cctvProxyUrl: only http/https URLs may be proxied, got scheme "${parsed.protocol}"`
    );
  }
  return PROXY_PREFIX + encodeURIComponent(originUrl);
}

/**
 * Decodes a ga98cctv:// proxy request URL back to the origin http(s) URL.
 *
 * Returns the decoded origin URL, or `null` if the request URL is malformed,
 * uses the wrong version prefix, or the encoded origin is not http(s).
 */
export function parseCctvProxyRequest(requestUrl: string): string | null {
  if (!requestUrl.startsWith(PROXY_PREFIX)) {
    return null;
  }
  const encoded = requestUrl.slice(PROXY_PREFIX.length);
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(decoded);
  } catch {
    return null;
  }
  if (!isAllowedScheme(parsed)) {
    return null;
  }
  return decoded;
}

/**
 * Like cctvProxyUrl but returns null instead of throwing for invalid or non-http(s) URLs.
 * Safe to call in a React render body where a synchronous throw would cause an uncaught
 * render error. Callers should render an error placeholder when null is returned.
 */
export function tryCctvProxyUrl(originUrl: string): string | null {
  try {
    return cctvProxyUrl(originUrl);
  } catch {
    return null;
  }
}

/** Kinds that can be routed through the ga98cctv:// proxy. */
const ROUTABLE_KINDS = new Set(['hls', 'http', 'mjpeg', 'mp4']);

/**
 * Returns true for stream kinds that can be routed through the ga98cctv:// proxy.
 * `youtube`, `webpage`, and `rtsp` are not Tor-routable via this mechanism.
 */
export function cctvRoutableKind(kind: string): boolean {
  return ROUTABLE_KINDS.has(kind);
}

/**
 * Number of leading body bytes the main-side proxy buffers to content-sniff the #EXTM3U tag.
 * 64 bytes covers an optional UTF-8 BOM (3) + the `#EXTM3U` tag (7) with ample slack for any
 * leading whitespace, while staying small enough never to delay a non-manifest media stream.
 */
export const HLS_SNIFF_BYTES = 64;

/**
 * Content-based HLS manifest detection — the security-critical complement to path/Content-Type
 * detection.
 *
 * RFC 8216 §4.3.3.1 requires every Media Playlist and Master Playlist to begin with the #EXTM3U
 * tag as its first line. hls.js enforces exactly this gate before it will parse a body as a
 * playlist and fetch its segment/key URIs (`M3U8Parser`: `if (!string.startsWith('#EXTM3U'))
 * { playlistParsingError = 'no EXTM3U delimiter' }`). Therefore ANY body hls.js will treat as a
 * playlist — and from which it will issue ABSOLUTE segment/EXT-X-KEY fetches — begins with
 * #EXTM3U after the browser strips a leading BOM.
 *
 * A hostile camera host fully controls the request path and the response Content-Type, so those
 * two signals alone are insufficient: serving a playlist on a non-`.m3u8` path with a
 * non-`mpegurl` Content-Type would let the body bypass URI rewriting and stream verbatim, after
 * which hls.js would fetch the manifest's absolute `https://attacker/seg.ts` URIs directly over
 * clearnet — deanonymizing the viewer to the exact host the Tor proxy exists to hide from.
 * Sniffing the body itself removes the host's control over the rewrite decision.
 *
 * This check is deliberately at least as lenient as hls.js (strips a BOM and leading whitespace
 * before testing), so it can only ever rewrite MORE bodies than hls.js would parse, never fewer.
 */
export function bodyLooksLikeHlsManifest(bodyStart: string): boolean {
  const withoutBom = bodyStart.charCodeAt(0) === 0xfeff ? bodyStart.slice(1) : bodyStart;
  return withoutBom.trimStart().startsWith('#EXTM3U');
}

/** Matches URI="..." attributes in HLS tag lines (EXT-X-KEY, EXT-X-MEDIA, etc.). */
const URI_ATTR_RE = /URI="([^"]*)"/g;

/**
 * Rewrites an HLS manifest so that every segment/key/media URI is routed
 * through the ga98cctv:// proxy.
 *
 * - Non-comment (non-#) lines that are not empty are treated as segment URIs;
 *   they are resolved against `baseOriginUrl` and replaced with `cctvProxyUrl(resolved)`.
 * - `URI="..."` attributes in `#EXT` tag lines are resolved and rewritten.
 * - All other `#` lines pass through unchanged.
 *
 * Uses `new URL(line, baseOriginUrl)` for resolution so relative paths work correctly.
 */
export function rewriteHlsManifest(manifest: string, baseOriginUrl: string): string {
  const lines = manifest.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '') {
      out.push(line);
      continue;
    }

    if (trimmed.startsWith('#')) {
      // Rewrite URI="..." attributes within EXT tags.
      if (URI_ATTR_RE.test(trimmed)) {
        // Reset lastIndex after test()
        URI_ATTR_RE.lastIndex = 0;
        const rewritten = trimmed.replace(URI_ATTR_RE, (_match, uri: string) => {
          try {
            const resolved = new URL(uri, baseOriginUrl).href;
            return `URI="${cctvProxyUrl(resolved)}"`;
          } catch {
            return _match;
          }
        });
        out.push(rewritten);
      } else {
        out.push(line);
      }
      continue;
    }

    // Non-comment, non-empty line → treat as a segment URI.
    try {
      const resolved = new URL(trimmed, baseOriginUrl).href;
      out.push(cctvProxyUrl(resolved));
    } catch {
      // Unparseable line — pass through unchanged.
      out.push(line);
    }
  }

  return out.join('\n');
}

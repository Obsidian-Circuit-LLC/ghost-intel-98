/**
 * EyeSpy "Detect format" probe.
 *
 * Given a camera URL a user pasted (often a bare `http://host:port/` that returns an HTML viewer
 * page rather than a media stream — e.g. an insecam listing), figure out the real StreamKind and,
 * when the entered URL is a viewer page, the actual media endpoint to play.
 *
 * EGRESS NOTE (deliberate, operator-approved): this is the ONE EyeSpy code path that makes an
 * outbound request from the main process to a user-supplied host. It is a user-triggered action
 * (the "Detect" button), to the same host the user is about to stream from. Unlike the app's feed
 * fetches it does NOT use the SSRF-guarded safeFetch — CCTV targets routinely live on LAN/RFC1918
 * addresses (the user's own cameras), which an SSRF guard would block. It is bounded instead:
 *   - http(s) only (rtsp/file/etc. rejected by the caller and re-checked here);
 *   - a short per-request timeout and a hard overall deadline;
 *   - redirects are NOT followed (`redirect: 'manual'`) — no redirect-driven pivot;
 *   - the response BODY is never read (cancelled immediately); only Content-Type headers are used;
 *   - a fixed, small candidate-path list (no brute force, no enumeration, no auth attempts).
 * It performs no scanning and stores nothing; it returns a {kind, url} suggestion the renderer
 * still routes through the existing `streams.upsert` URL gate.
 */

import type { StreamKind } from '@shared/post-mvp-types';

const PER_REQUEST_MS = 4000;
const OVERALL_DEADLINE_MS = 20000;

// Global in-flight cap. The renderer disables the Detect button while one is running, but that is UX
// only — a hostile renderer (and Ghost Intel 98 plugins SHARE the renderer) can ignore it and fire detect()
// thousands of times in parallel, each opening live sockets to an attacker-chosen host. Capping at
// the service boundary (not the IPC handler) bounds total concurrent outbound sockets regardless of
// caller, so Detect can't be turned into a socket-exhaustion / amplification driver.
const MAX_IN_FLIGHT = 3;
let inFlight = 0;

// Common MJPEG / single-JPEG endpoints exposed by older network cameras whose root URL is an HTML
// viewer page. Tried in order against the URL's origin only when the root looks like a webpage.
// Intentionally short and fixed — this is a convenience hint, not a discovery scanner.
const CANDIDATE_PATHS = [
  '/cgi-bin/viewer/video.jpg',
  '/video.cgi',
  '/mjpg/video.mjpg',
  '/video.mjpg',
  '/axis-cgi/mjpg/video.cgi',
  '/cgi-bin/mjpg/video.cgi',
  '/videostream.cgi',
  '/img/video.mjpeg',
  '/video/mjpg.cgi',
  '/snapshot.cgi',
  '/image/jpeg.cgi',
  '/GetData.cgi'
];

export interface DetectResult {
  kind: StreamKind;
  /** The media URL to play. Equals the input when the input itself was a stream; otherwise the
   *  discovered endpoint. */
  url: string;
}

/** Map a Content-Type (lower-cased, parameters stripped) to a StreamKind, or null if it is not a
 *  directly-playable media type (e.g. text/html — a viewer page). */
function kindFromContentType(ct: string): StreamKind | null {
  const t = ct.split(';')[0].trim().toLowerCase();
  if (t === 'multipart/x-mixed-replace') return 'mjpeg';
  if (t === 'image/jpeg' || t === 'image/jpg') return 'http'; // single/refreshing JPEG snapshot
  if (t === 'video/mp4') return 'mp4';
  if (t === 'application/vnd.apple.mpegurl' || t === 'application/x-mpegurl') return 'hls';
  return null;
}

/** Fetch ONLY the response headers for `url` (body cancelled). `timeoutMs` is clamped by the caller
 *  to the remaining overall budget so a late probe can't run a full PER_REQUEST_MS past the deadline.
 *  Returns the Content-Type or null on any failure/timeout/redirect. Never throws. */
async function probeContentType(url: string, timeoutMs: number): Promise<string | null> {
  if (timeoutMs <= 0) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      // Ask for nothing — we only want the headers. Many cameras ignore Range and stream anyway,
      // so we cancel the body the instant the headers land.
      headers: { Range: 'bytes=0-0' },
      redirect: 'manual',
      signal: ctrl.signal
    });
    // Do not consume the (possibly endless MJPEG) body.
    try { await res.body?.cancel(); } catch { /* already closed */ }
    // Redirects are NEVER followed. With redirect:'manual', Node/undici returns the real 3xx as a
    // normal `basic` response carrying the upstream status + Content-Type (it does NOT synthesize an
    // `opaqueredirect` — that's a browser-fetch construct). So the STATUS-RANGE check is the
    // load-bearing guard that stops a media-typed 3xx from flowing into kindFromContentType (an
    // SSRF-pivot vector); the `opaqueredirect` clause is a harmless belt-and-suspenders for any
    // browser-like runtime. Do not remove the status check.
    if (res.status >= 300 && res.status < 400) return null;
    if (res.type === 'opaqueredirect') return null;
    return res.headers.get('content-type');
  } catch {
    return null; // network error / timeout / abort — treat as "no answer"
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Detect the stream kind for `input`. Returns a {kind, url} suggestion, or null if nothing playable
 * was found (the user then picks a kind manually). Concurrency-capped (MAX_IN_FLIGHT) and bounded by
 * an overall deadline regardless of how many candidate paths remain.
 */
export async function detectStream(input: string): Promise<DetectResult | null> {
  if (inFlight >= MAX_IN_FLIGHT) throw new Error('Too many detect requests in flight — try again in a moment.');
  inFlight++;
  try {
    return await detectStreamImpl(input);
  } finally {
    inFlight--;
  }
}

async function detectStreamImpl(input: string): Promise<DetectResult | null> {
  let origin: string;
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    origin = parsed.origin;
  } catch {
    return null;
  }

  const deadline = Date.now() + OVERALL_DEADLINE_MS;
  // Each probe's timeout is the SMALLER of PER_REQUEST_MS and the budget left, so a probe started
  // near the deadline can't overrun it by a full per-request timeout.
  const reqTimeout = (): number => Math.min(PER_REQUEST_MS, deadline - Date.now());

  // 1) Probe the URL exactly as entered. If it is already a playable media endpoint, use it as-is.
  const rootCt = await probeContentType(input, reqTimeout());
  if (rootCt) {
    const k = kindFromContentType(rootCt);
    if (k) return { kind: k, url: input };
    // A non-media type (typically text/html) means this is a viewer page → fall through to paths.
  }

  // 2) The entered URL is a viewer page (or didn't answer). Try the common media endpoints on the
  //    same origin, returning the first that reports a playable media Content-Type.
  for (const path of CANDIDATE_PATHS) {
    if (reqTimeout() <= 0) break;
    const candidate = origin + path;
    if (candidate === input) continue; // already probed above
    const ct = await probeContentType(candidate, reqTimeout());
    if (!ct) continue;
    const k = kindFromContentType(ct);
    if (k) return { kind: k, url: candidate };
  }

  return null;
}

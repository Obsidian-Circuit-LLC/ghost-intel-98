/**
 * ga98cctv:// — privileged custom protocol that routes CCTV stream bytes through Tor.
 *
 * SECURITY: this is the only bridge between a renderer-supplied stream URL and the network.
 * Every byte egresses over the bgconn Tor SOCKS circuit — there is NEVER a clearnet fallback.
 *  - The origin URL is decoded + scheme-checked by `parseCctvProxyRequest` (http/https only).
 *  - The SOCKS port comes from the bootstrapped bgconn Tor instance; if Tor is not ready the
 *    handler returns 503 and the renderer shows TOR NOT READY (it does not load clearnet).
 *  - HLS manifests are URL-rewritten so every segment/key/media URI stays on this proxy.
 *  - Redirects (3xx) are followed by RE-DIALLING the target through Tor (bounded hops, http(s)
 *    only) — the Location header is NEVER forwarded to the renderer, which would egress clearnet.
 *  - Body is size-capped (manifests) and the request is time-capped; the handler returns error
 *    Responses rather than throwing into the protocol layer.
 *
 * Mirrors the ga98media:// handler (src/main/media/protocol.ts) and the Tor probe pattern
 * (src/main/searchlight/probe.ts): SOCKS5 CONNECT via socksDial(), then http.request/https.request
 * (selected on the origin scheme) over that socket with createConnection, streaming the response
 * back through Readable.toWeb.
 */

import { request as httpsRequest } from 'node:https';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import type { Socket } from 'node:net';
import { protocol } from 'electron';
import { socksDial } from '../searchlight/tor-socks';
import { getBgTor } from '../bgconn/tor-singleton';
import { readTextCapped } from '../net/limits';
import {
  parseCctvProxyRequest,
  rewriteHlsManifest,
  bodyLooksLikeHlsManifest,
  HLS_SNIFF_BYTES
} from '@shared/cctv/proxy';

// Socket-inactivity time cap. Deliberately longer than the searchlight probe (live video over
// Tor is slow); it fires only on a stall (no bytes flowing), so it does not truncate a healthy
// stream — it just stops a hung circuit from pinning the socket open forever.
const TIMEOUT_MS = 30_000;

// Maximum HTTP redirect hops the proxy will follow, each re-dialled through Tor. Bounds both
// redirect loops and the number of circuits a single stream request can open.
const MAX_REDIRECTS = 4;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Headers worth forwarding from the origin response back to the renderer. */
const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'];

/**
 * Statuses for which the WHATWG Response constructor forbids a body (throws a TypeError if one
 * is supplied). The origin is renderer-supplied, so these must be handled explicitly rather
 * than passed a streaming body. 101/103 are also below the Response init status floor (200);
 * they are included for completeness and the surrounding try/catch backstops any RangeError.
 */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/** True iff the origin is http(s). The only schemes this proxy will dial. */
function isHttpOrigin(u: URL): boolean {
  return u.protocol === 'http:' || u.protocol === 'https:';
}

/** True iff the bgconn Tor instance exists and is bootstrapped. */
export function cctvTorReady(): boolean {
  return getBgTor()?.isBootstrapped() ? true : false;
}

/**
 * Peeks the first `n` bytes of an origin response WITHOUT consuming them, so the body can be
 * content-sniffed (for the #EXTM3U HLS tag) before deciding whether to rewrite or stream it.
 *
 * The peeked bytes are `unshift()`'d back onto the stream, so the downstream consumer
 * (`readTextCapped` for a manifest, or `Readable.toWeb` for a pass-through stream) still sees
 * the complete body — no bytes are dropped. Resolves `{ prefix, full }`:
 *  - `full: false` — at least `n` bytes were available; `prefix` is the first `n` bytes and the
 *    stream has been rewound (unshift) to its original position for the consumer to read fully.
 *  - `full: true`  — the stream ended before `n` bytes; `prefix` is the ENTIRE body and the
 *    stream is already drained, so the caller must use `prefix` directly as the body.
 *
 * Reading the prefix in paused mode (`res.read()`) and unshifting once we have enough bytes means
 * a hostile origin cannot stall detection: the socket-inactivity timeout on the request still
 * fires on a stalled stream, surfacing here as an `error` that rejects the peek.
 */
function peekPrefix(res: IncomingMessage, n: number): Promise<{ prefix: Buffer; full: boolean }> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let total = 0;
    const cleanup = (): void => {
      res.removeListener('readable', onReadable);
      res.removeListener('end', onEnd);
      res.removeListener('error', onError);
    };
    const onReadable = (): void => {
      let chunk: Buffer | null;
      while ((chunk = res.read() as Buffer | null) !== null) {
        parts.push(chunk);
        total += chunk.length;
        if (total >= n) break;
      }
      if (total >= n) {
        cleanup();
        const buf = Buffer.concat(parts);
        res.unshift(buf); // rewind: replay every read byte to the downstream consumer
        resolve({ prefix: buf.subarray(0, n), full: false });
      }
    };
    const onEnd = (): void => {
      cleanup();
      resolve({ prefix: Buffer.concat(parts), full: true });
    };
    const onError = (e: Error): void => {
      cleanup();
      reject(e);
    };
    res.on('readable', onReadable);
    res.on('end', onEnd);
    res.on('error', onError);
  });
}

/**
 * Perform ONE Tor-dialled request to `originUrl`. On a 3xx with a Location header and remaining
 * hops, re-dial the resolved target through Tor (never forwarding Location to the renderer).
 * Otherwise content-sniff and either rewrite (HLS manifest) or stream the body back.
 */
async function attempt(
  originUrl: string,
  socksPort: number,
  method: 'GET' | 'HEAD',
  range: string | null,
  hopsLeft: number
): Promise<Response> {
  let origin: URL;
  try {
    origin = new URL(originUrl);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (!isHttpOrigin(origin)) return new Response('bad request', { status: 400 });
  const originPort = origin.port ? parseInt(origin.port, 10) : origin.protocol === 'https:' ? 443 : 80;

  // SOCKS5 CONNECT through Tor, then HTTP(S) over that socket.
  let socket: Socket;
  try {
    socket = await socksDial(origin.hostname, originPort, socksPort);
  } catch {
    return new Response('bad gateway', { status: 502 });
  }

  const headers: Record<string, string> = { 'User-Agent': UA, Connection: 'close' };
  if (range) headers.Range = range;

  // HLS detection by path; refined by content-type and a body content-sniff once the response arrives.
  const pathIsHls = origin.pathname.toLowerCase().endsWith('.m3u8');

  return await new Promise<Response>((resolve) => {
    let settled = false;
    const done = (r: Response): void => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };

    // Select the transport by origin scheme. Public CCTV/MJPEG cameras are overwhelmingly
    // plaintext http:// — sending a TLS ClientHello to their port-80 server would fail the
    // handshake and 502 every such stream. `servername` is a TLS-only option and is ignored
    // by http.request, so it is harmless to leave in the shared options object.
    const requestFn = origin.protocol === 'https:' ? httpsRequest : httpRequest;

    const req = requestFn(
      {
        method,
        hostname: origin.hostname,
        servername: origin.hostname,
        path: origin.pathname + origin.search,
        createConnection: () => socket as never,
        timeout: TIMEOUT_MS,
        headers
      },
      (res) => {
        const status = res.statusCode ?? 502;
        const ctype = String(res.headers['content-type'] ?? '').toLowerCase();

        // REDIRECT: follow it by re-dialling the target THROUGH TOR. We never forward the
        // Location header to the renderer — doing so would let the renderer (or hls.js)
        // fetch the redirect target directly over clearnet, defeating the whole proxy. The
        // target must itself be http(s); anything else is refused. Hops are bounded.
        const loc = res.headers['location'];
        if (status >= 300 && status < 400 && typeof loc === 'string' && loc && hopsLeft > 0) {
          // Make the settle/abort invariant explicit (red-team hardening): we are about to
          // destroy this socket and hand control to a fresh re-dial, so swallow any late error
          // raised on the now-dead response rather than letting it surface unhandled (which a
          // future Electron/Node could turn into a main-process crash). socket.destroy() stays
          // NO-ARG on purpose — passing an error would make req's 'error' handler fire and settle
          // a 502 while the recursive attempt() also runs, leaking that Tor circuit. Keep it no-arg.
          res.on('error', () => { /* dead response post-redirect; intentionally ignored */ });
          res.resume(); // drain so the socket can close cleanly
          socket.destroy();
          let next: URL;
          try {
            next = new URL(loc, originUrl);
          } catch {
            done(new Response('bad gateway', { status: 502 }));
            return;
          }
          if (!isHttpOrigin(next)) {
            done(new Response('bad gateway', { status: 502 }));
            return;
          }
          attempt(next.href, socksPort, method, range, hopsLeft - 1)
            .then(done)
            .catch(() => done(new Response('bad gateway', { status: 502 })));
          return;
        }

        // Pass-through headers, used for any non-manifest body.
        const outHeaders: Record<string, string> = {};
        for (const k of PASS_HEADERS) {
          const v = res.headers[k];
          if (typeof v === 'string') outHeaders[k] = v;
        }

        // The WHATWG Response constructor throws if a null-body status (101/103/204/205/304)
        // is paired with a body. The origin is renderer-supplied, so a hostile server can return
        // one of these to weaponise that throw — and because we are inside an event-emitter
        // callback, the throw would escape proxy()'s outer .catch and hang the protocol request.
        // These responses also carry no body to sniff, so handle them first: drain the socket and
        // send a bodyless Response. Wrap in try/catch as a final backstop so this branch upholds
        // the 'handler returns error Responses, never throws' invariant unconditionally.
        if (NULL_BODY_STATUSES.has(status)) {
          try {
            res.resume();
            done(new Response(null, { status, headers: outHeaders }));
          } catch {
            res.destroy();
            done(new Response('bad gateway', { status: 502 }));
          }
          return;
        }

        const manifestHeaders = { 'content-type': 'application/vnd.apple.mpegurl' };

        // SECURITY: the rewrite decision must NOT rest on the request path or the origin-supplied
        // Content-Type alone — a hostile camera host controls both and would otherwise serve a
        // playlist on a non-.m3u8 path with a non-mpegurl Content-Type to bypass rewriting, after
        // which hls.js would fetch the manifest's ABSOLUTE segment/EXT-X-KEY URIs directly over
        // clearnet and deanonymize the viewer. We therefore also content-sniff the body for the
        // #EXTM3U tag (which hls.js itself requires before it will parse+fetch a playlist) and
        // rewrite on ANY of the three signals.
        peekPrefix(res, HLS_SNIFF_BYTES)
          .then(({ prefix, full }) => {
            const sniffText = new TextDecoder('utf-8', { fatal: false }).decode(prefix);
            const isManifest =
              pathIsHls || ctype.includes('mpegurl') || bodyLooksLikeHlsManifest(sniffText);

            if (full) {
              // Whole body already drained into `prefix` (stream ended during the peek).
              if (isManifest) {
                done(
                  new Response(rewriteHlsManifest(sniffText, originUrl), {
                    status,
                    headers: manifestHeaders
                  })
                );
                return;
              }
              try {
                // Copy out exactly prefix.length bytes (a pooled Buffer may view a larger
                // ArrayBuffer) so no unrelated heap bytes are exposed in the Response body.
                done(new Response(new Uint8Array(prefix), { status, headers: outHeaders }));
              } catch {
                res.destroy();
                done(new Response('bad gateway', { status: 502 }));
              }
              return;
            }

            if (isManifest) {
              // Buffer the manifest (size-capped via limits.ts), rewrite every URI onto the proxy.
              readTextCapped(new Response(Readable.toWeb(res) as ReadableStream))
                .then((text) =>
                  done(new Response(rewriteHlsManifest(text, originUrl), { status, headers: manifestHeaders }))
                )
                .catch(() => {
                  res.destroy();
                  done(new Response('bad gateway', { status: 502 }));
                });
              return;
            }

            // Stream the body straight back. Range (206/content-range) passes through for seeking.
            try {
              done(new Response(Readable.toWeb(res) as ReadableStream, { status, headers: outHeaders }));
            } catch {
              res.destroy();
              done(new Response('bad gateway', { status: 502 }));
            }
          })
          .catch(() => {
            res.destroy();
            done(new Response('bad gateway', { status: 502 }));
          });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      socket.destroy();
      done(new Response('gateway timeout', { status: 504 }));
    });
    req.on('error', () => {
      socket.destroy();
      done(new Response('bad gateway', { status: 502 }));
    });
    req.end();
  });
}

async function proxy(request: Request): Promise<Response> {
  // 1) Decode + scheme-check the origin (http/https only). Anything else → 400.
  const originUrl = parseCctvProxyRequest(request.url);
  if (!originUrl) return new Response('bad request', { status: 400 });

  // 2) Tor SOCKS port, or refuse. NEVER clearnet fallback.
  const tor = getBgTor();
  const socksPort = tor?.isBootstrapped() ? tor.socksPort() : null;
  if (socksPort == null) return new Response('tor unavailable', { status: 503 });

  const method = request.method === 'HEAD' ? 'HEAD' : 'GET';
  const range = request.headers.get('range');

  // 3) Dial through Tor, following bounded redirects (each re-dialled through Tor).
  return attempt(originUrl, socksPort, method, range, MAX_REDIRECTS);
}

/** Register the ga98cctv:// handler. Call once, after app is ready. */
export function registerCctvProxy(): void {
  protocol.handle('ga98cctv', (request) =>
    proxy(request).catch(() => new Response('bad gateway', { status: 502 }))
  );
}

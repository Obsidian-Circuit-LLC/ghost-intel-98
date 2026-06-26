/**
 * ga98cctv:// — privileged custom protocol that routes CCTV stream bytes through Tor.
 *
 * SECURITY: this is the only bridge between a renderer-supplied stream URL and the network.
 * Every byte egresses over the bgconn Tor SOCKS circuit — there is NEVER a clearnet fallback.
 *  - The origin URL is decoded + scheme-checked by `parseCctvProxyRequest` (http/https only).
 *  - The SOCKS port comes from the bootstrapped bgconn Tor instance; if Tor is not ready the
 *    handler returns 503 and the renderer shows TOR NOT READY (it does not load clearnet).
 *  - HLS manifests are URL-rewritten so every segment/key/media URI stays on this proxy.
 *  - Body is size-capped (manifests) and the request is time-capped; the handler returns error
 *    Responses rather than throwing into the protocol layer.
 *
 * Mirrors the ga98media:// handler (src/main/media/protocol.ts) and the Tor probe pattern
 * (src/main/searchlight/probe.ts): SOCKS5 CONNECT via socksDial(), then http.request/https.request
 * (selected on the origin scheme) over that socket with createConnection, streaming the response
 * back through Readable.toWeb.
 */

import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import type { Socket } from 'node:net';
import { protocol } from 'electron';
import { socksDial } from '../searchlight/tor-socks';
import { getBgTor } from '../bgconn/tor-singleton';
import { readTextCapped } from '../net/limits';
import { parseCctvProxyRequest, rewriteHlsManifest } from '@shared/cctv/proxy';

// Socket-inactivity time cap. Deliberately longer than the searchlight probe (live video over
// Tor is slow); it fires only on a stall (no bytes flowing), so it does not truncate a healthy
// stream — it just stops a hung circuit from pinning the socket open forever.
const TIMEOUT_MS = 30_000;
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

/** True iff the bgconn Tor instance exists and is bootstrapped. */
export function cctvTorReady(): boolean {
  return getBgTor()?.isBootstrapped() ? true : false;
}

async function proxy(request: Request): Promise<Response> {
  // 1) Decode + scheme-check the origin (http/https only). Anything else → 400.
  const originUrl = parseCctvProxyRequest(request.url);
  if (!originUrl) return new Response('bad request', { status: 400 });

  // 2) Tor SOCKS port, or refuse. NEVER clearnet fallback.
  const tor = getBgTor();
  const socksPort = tor?.isBootstrapped() ? tor.socksPort() : null;
  if (socksPort == null) return new Response('tor unavailable', { status: 503 });

  let origin: URL;
  try {
    origin = new URL(originUrl);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  const originPort = origin.port ? parseInt(origin.port, 10) : origin.protocol === 'https:' ? 443 : 80;

  // 3) SOCKS5 CONNECT through Tor, then HTTPS over that socket.
  let socket: Socket;
  try {
    socket = await socksDial(origin.hostname, originPort, socksPort);
  } catch {
    return new Response('bad gateway', { status: 502 });
  }

  const method = request.method === 'HEAD' ? 'HEAD' : 'GET';
  const range = request.headers.get('range');
  const headers: Record<string, string> = { 'User-Agent': UA, Connection: 'close' };
  if (range) headers.Range = range;

  // HLS detection by path; refined by content-type once the response arrives.
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
        const isManifest = pathIsHls || ctype.includes('mpegurl');

        if (isManifest) {
          // Buffer the manifest (size-capped via limits.ts), rewrite every URI onto the proxy.
          readTextCapped(new Response(Readable.toWeb(res) as ReadableStream))
            .then((text) =>
              done(
                new Response(rewriteHlsManifest(text, originUrl), {
                  status,
                  headers: { 'content-type': 'application/vnd.apple.mpegurl' }
                })
              )
            )
            .catch(() => {
              res.destroy();
              done(new Response('bad gateway', { status: 502 }));
            });
          return;
        }

        // Stream the body straight back. Range (206/content-range) passes through for seeking.
        const outHeaders: Record<string, string> = {};
        for (const k of PASS_HEADERS) {
          const v = res.headers[k];
          if (typeof v === 'string') outHeaders[k] = v;
        }
        // The WHATWG Response constructor throws if a null-body status (101/103/204/205/304)
        // is paired with a body. The origin is renderer-supplied, so a hostile server can return
        // one of these to weaponise that throw — and because we are inside an event-emitter
        // callback, the throw would escape proxy()'s outer .catch and hang the protocol request.
        // Drain the socket and send a bodyless Response instead. Wrap in try/catch as a final
        // backstop so this branch upholds the 'handler returns error Responses, never throws'
        // invariant unconditionally.
        try {
          if (NULL_BODY_STATUSES.has(status)) {
            res.resume();
            done(new Response(null, { status, headers: outHeaders }));
          } else {
            done(new Response(Readable.toWeb(res) as ReadableStream, { status, headers: outHeaders }));
          }
        } catch {
          res.destroy();
          done(new Response('bad gateway', { status: 502 }));
        }
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

/** Register the ga98cctv:// handler. Call once, after app is ready. */
export function registerCctvProxy(): void {
  protocol.handle('ga98cctv', (request) =>
    proxy(request).catch(() => new Response('bad gateway', { status: 502 }))
  );
}

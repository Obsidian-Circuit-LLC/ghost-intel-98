// src/main/plugins/tor-egress.ts — route plugin egress through a dedicated bundled Tor SOCKS proxy.
import type { Duplex } from 'node:stream';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { randomBytes } from 'node:crypto';
import { app } from 'electron';
import { join } from 'node:path';
import { buildGreeting, parseMethodSelection, buildUserPassAuth, parseUserPassReply, buildConnectDomain, parseConnectReply, socksReplyMessage } from '../chat/socks5';
import type { PluginFetchInit, PluginFetchResponse } from './context';
import { BgconnTor } from '../bgconn/tor';
import { registerTeardown } from './loader';

/** Tor refused to reach the target (SOCKS REP != 0). Distinct from a transport error so callers
 *  can surface three-valued found/not-found/BLOCKED instead of a false negative. */
export class SocksBlockedError extends Error { constructor(m: string) { super(m); this.name = 'SocksBlockedError'; } }

/**
 * ACCEPTED RESIDUALS — operator decisions 2026-06-12, intentional and not gated further:
 *
 * (1) .onion and name-based targets are permitted on egress. Traffic exits through a remote
 *     Tor exit node (or, for .onion, never leaves the Tor overlay), so the exit cannot reach
 *     the user's LAN. Hidden-service sources are within the tool's threat model. The existing
 *     isPublicHttpUrl textual validator is intentionally not extended with .onion rejection.
 *
 * (2) init.direct === true elects the clearnet path per-call. The trust boundary is the plugin
 *     signature: only a signed, loaded plugin can construct a PluginFetchInit with direct:true.
 *     This is a disclosed capability, not a gated one — a signed plugin that needs direct egress
 *     can opt in explicitly; unsigned or capability-missing plugins never reach rawFetch.
 */

interface SocksTarget { host: string; port: number; user: string; pass: string }

/** Maximum bytes we will buffer during the SOCKS5 handshake. A valid greeting reply (2 B) +
 *  auth reply (2 B) + CONNECT reply (max ~262 B with a domain BND.ADDR) is well under 512 B.
 *  If a peer pushes more than this the socket is misbehaving — abort with a hard error (NOT
 *  SocksBlockedError; this is a protocol/abuse condition, not a normal Tor-exit refusal). */
const SOCKS_HANDSHAKE_MAX_BYTES = 512;
/** Maximum milliseconds to wait for the full SOCKS5 handshake to complete. The 30 s TIMEOUT_MS
 *  in torFetch only starts after the tunnel opens; this covers the handshake phase itself. */
const SOCKS_HANDSHAKE_TIMEOUT_MS = 15_000;

/** Drive the SOCKS5 + RFC 1929 + CONNECT handshake on an already-connected socket. Resolves when
 *  the tunnel is open. Per-request {user,pass} → a distinct Tor circuit (IsolateSOCKSAuth).
 *
 *  DoS hardening: accumulation is bounded at SOCKS_HANDSHAKE_MAX_BYTES; a 15 s deadline covers
 *  the whole handshake phase. Both caps reject with a plain Error (not SocksBlockedError). */
export function socksConnect(sock: Duplex, t: SocksTarget): Promise<void> {
  return new Promise((resolve, reject) => {
    type Phase = 'method' | 'auth' | 'connect';
    let phase: Phase = 'method';
    let buf = Buffer.alloc(0);
    let done = false;
    const onErr = (e: unknown): void => { if (done) return; done = true; cleanup(); reject(e instanceof Error ? e : new Error(String(e))); };
    const cleanup = (): void => {
      clearTimeout(timer);
      sock.removeListener('data', onData);
      sock.removeListener('error', onErr);
    };
    // Handshake-phase deadline: if CONNECT reply hasn't arrived within 15 s, destroy + reject.
    const timer = setTimeout(() => {
      sock.destroy();
      onErr(new Error('SOCKS: handshake timed out'));
    }, SOCKS_HANDSHAKE_TIMEOUT_MS);
    function onData(chunk: Buffer): void {
      // Bounded accumulation: reject if the remote sends junk beyond the max handshake size.
      if (buf.length + chunk.length > SOCKS_HANDSHAKE_MAX_BYTES) {
        onErr(new Error(`SOCKS: handshake overflow (> ${SOCKS_HANDSHAKE_MAX_BYTES} bytes)`));
        return;
      }
      buf = Buffer.concat([buf, chunk]);
      try {
        if (phase === 'method') {
          const m = parseMethodSelection(buf); if (!m) return;
          if (!m.ok) { onErr(new Error('SOCKS: no acceptable auth method')); return; }
          buf = Buffer.from(buf.subarray(2));
          if (m.method === 0x02) { phase = 'auth'; sock.write(buildUserPassAuth(t.user, t.pass)); }
          else { phase = 'connect'; sock.write(buildConnectDomain(t.host, t.port)); }
        }
        if (phase === 'auth') {
          const a = parseUserPassReply(buf); if (!a) return;
          if (!a.ok) { onErr(new Error('SOCKS: username/password auth failed')); return; }
          buf = Buffer.from(buf.subarray(2)); phase = 'connect'; sock.write(buildConnectDomain(t.host, t.port));
          return;
        }
        if (phase === 'connect') {
          const r = parseConnectReply(buf); if (!r) return;
          if (done) return; done = true; cleanup();
          if (!r.ok) reject(new SocksBlockedError(`Tor exit: ${socksReplyMessage(r.rep)}`)); else resolve();
        }
      } catch (e) { onErr(e); }
    }
    sock.on('data', onData); sock.on('error', onErr);
    sock.write(buildGreeting({ auth: true }));
  });
}

const MAX_BODY = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

// --- dedicated plugin-egress Tor (compartmented from chat/bgconn circuits) ---
let pluginTor: BgconnTor | null = null;
/** Inject the started, bootstrapped dedicated Tor (set from ensurePluginTor). null ⇒ egress unavailable. */
export function setPluginTor(t: BgconnTor | null): void { pluginTor = t; }
/** Returns the live plugin-egress Tor instance, or null if not started. Used by the will-quit
 *  SIGKILL backstop in index.ts to ensure tor.exe is killed even when async teardown times out. */
export function getPluginTor(): BgconnTor | null { return pluginTor; }
export function getPluginTorSocksPort(): number | null { return pluginTor ? pluginTor.socksPort() : null; }

/** A custom Agent whose createConnection tunnels through the plugin Tor SOCKS proxy with a
 *  per-request credential (→ a distinct Tor circuit), then (for https) TLS-wraps the tunnel. */
function makeSocksAgent(socksPort: number, secure: boolean): HttpAgent | HttpsAgent {
  const Base = secure ? HttpsAgent : HttpAgent;
  const agent = new Base({ keepAlive: false, maxSockets: 8 });
  // @ts-expect-error createConnection is the documented Agent override hook
  agent.createConnection = (opts: { host: string; port: number; servername?: string }, cb: (err: Error | null, sock?: unknown) => void): void => {
    const raw = netConnect({ host: '127.0.0.1', port: socksPort });
    raw.once('error', (e) => cb(e));
    socksConnect(raw, { host: opts.host, port: Number(opts.port), user: randomBytes(8).toString('hex'), pass: randomBytes(16).toString('hex') })
      .then(() => {
        if (!secure) { cb(null, raw); return; }
        const tls = tlsConnect({ socket: raw, servername: opts.servername ?? opts.host });
        tls.once('secureConnect', () => cb(null, tls));
        tls.once('error', (e) => cb(e));
      })
      .catch((e) => { raw.destroy(); cb(e); });
  };
  return agent;
}

/** Fetch `url` over Tor. Returns a PluginFetchResponse (extended with an optional `location`
 *  field on 3xx responses so wire-deps can follow redirects); a Tor-exit refusal / SOCKS / TLS /
 *  timeout failure → { blocked:true } (three-valued). Throws only if the dedicated Tor isn't
 *  available. Does NOT follow redirects — wire-deps' followRedirects owns redirect policy. */
export function torFetch(url: string, init: PluginFetchInit = {}): Promise<PluginFetchResponse & { location?: string }> {
  const socksPort = getPluginTorSocksPort();
  if (socksPort === null) return Promise.reject(new Error('plugin Tor egress not started'));
  const u = new URL(url);
  const secure = u.protocol === 'https:';
  const agent = makeSocksAgent(socksPort, secure);
  const reqFn = secure ? httpsRequest : httpRequest;
  return new Promise((resolve) => {
    const blocked = (): void => resolve({ status: 0, body: '', finalUrl: url, blocked: true });
    const req = reqFn(url, { method: init.method ?? 'GET', headers: init.headers, agent: agent as never, timeout: TIMEOUT_MS }, (res) => {
      const chunks: Buffer[] = []; let len = 0;
      res.on('data', (c: Buffer) => { len += c.length; if (len > MAX_BODY) { req.destroy(); resolve({ status: res.statusCode ?? 0, body: '', finalUrl: url }); return; } chunks.push(c); });
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        const body = Buffer.concat(chunks).toString('utf8');
        // Surface the Location header on 3xx responses so wire-deps followRedirects can follow them.
        const location = (status >= 300 && status < 400) ? (res.headers['location'] as string | undefined) : undefined;
        resolve({ status, body, finalUrl: url, ...(location !== undefined ? { location } : {}) });
      });
      res.on('error', blocked);
    });
    req.on('error', (e) => (e instanceof SocksBlockedError ? blocked() : blocked())); // SOCKS/connection error → blocked
    req.on('timeout', () => { req.destroy(); blocked(); });
    if (init.body) req.write(init.body);
    req.end();
  });
}

// --- dedicated plugin-egress Tor lazy startup ---
let pluginTorStarting: Promise<void> | null = null;
/** Lazily start a dedicated, compartmented Tor for plugin egress. Retryable after a failed start. */
export function ensurePluginTor(): Promise<void> {
  if (pluginTorStarting) return pluginTorStarting;
  pluginTorStarting = (async () => {
    const { torPaths } = await import('../chat/transport-tor');
    const net = await import('node:net');
    const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
    const bundleDir = join(base, 'tor', 'win-x64');
    const dataDir = join(app.getPath('userData'), 'plugin-egress', 'tor-data');
    const freePort = (): Promise<number> => new Promise((res, rej) => {
      const s = net.createServer();
      s.once('error', rej);
      s.listen(0, '127.0.0.1', () => { const p = (s.address() as import('node:net').AddressInfo).port; s.close(() => res(p)); });
    });
    const [socksPort, controlPort] = await Promise.all([freePort(), freePort()]);
    const tor = new BgconnTor({ torExe: torPaths(bundleDir).torExe, dataDir, socksPort, controlPort });
    await tor.start(); // resolves on "Bootstrapped 100%" (BgconnTor.start)
    setPluginTor(tor);
    registerTeardown('__plugin-egress-tor__', async () => { setPluginTor(null); await tor.stop(); });
  })().catch((e) => { pluginTorStarting = null; throw e; }); // null-out so a later egress can retry
  return pluginTorStarting;
}

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

interface SocksTarget { host: string; port: number; user: string; pass: string }

/** Drive the SOCKS5 + RFC 1929 + CONNECT handshake on an already-connected socket. Resolves when
 *  the tunnel is open. Per-request {user,pass} → a distinct Tor circuit (IsolateSOCKSAuth). */
export function socksConnect(sock: Duplex, t: SocksTarget): Promise<void> {
  return new Promise((resolve, reject) => {
    type Phase = 'method' | 'auth' | 'connect';
    let phase: Phase = 'method';
    let buf = new Uint8Array(0);
    const onErr = (e: unknown): void => { cleanup(); reject(e instanceof Error ? e : new Error(String(e))); };
    const cleanup = (): void => { sock.removeListener('data', onData); sock.removeListener('error', onErr); };
    function onData(chunk: Buffer): void {
      buf = Uint8Array.from([...buf, ...chunk]);
      try {
        if (phase === 'method') {
          const m = parseMethodSelection(buf); if (!m) return;
          if (!m.ok) { onErr(new Error('SOCKS: no acceptable auth method')); return; }
          buf = buf.subarray(2);
          if (m.method === 0x02) { phase = 'auth'; sock.write(buildUserPassAuth(t.user, t.pass)); }
          else { phase = 'connect'; sock.write(buildConnectDomain(t.host, t.port)); }
        }
        if (phase === 'auth') {
          const a = parseUserPassReply(buf); if (!a) return;
          if (!a.ok) { onErr(new Error('SOCKS: username/password auth failed')); return; }
          buf = buf.subarray(2); phase = 'connect'; sock.write(buildConnectDomain(t.host, t.port));
          return;
        }
        if (phase === 'connect') {
          const r = parseConnectReply(buf); if (!r) return;
          cleanup();
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

/** Fetch `url` over Tor. Returns a PluginFetchResponse; a Tor-exit refusal / SOCKS / TLS / timeout
 *  failure → { blocked:true } (three-valued), a real HTTP response → status+body. Throws only if
 *  the dedicated Tor isn't available. Does NOT follow redirects — wire-deps owns redirect policy. */
export function torFetch(url: string, init: PluginFetchInit = {}): Promise<PluginFetchResponse> {
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
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), finalUrl: url }));
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

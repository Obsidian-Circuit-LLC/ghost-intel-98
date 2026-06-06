/**
 * Tor transport (Phase 1) — runs the bundled C-tor as a controlled sidecar and implements the
 * `Transport` seam: publish a STABLE v3 onion service (loopback target) + dial peer onions via Tor's
 * local SOCKS port. EXPERIMENTAL (the handshake riding on top is unverified).
 *
 * Structure: the protocol DRIVERS (`performSocksConnect`, `controlExchange`) and the pure helpers
 * (`torPaths`, `buildTorrc`) are electron-free and unit-testable over the in-memory pipe. The
 * `TorTransport` class wires them to a spawned `tor.exe` + node sockets; its start()/dial() run only
 * against the real bundled binary on the target machine (not exercised in CI). Paths + ports are
 * INJECTED so this module never imports electron.
 */
import { join } from 'node:path';
import { createServer, connect, type Socket, type Server } from 'node:net';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {
  buildGreeting, parseMethodSelection, buildConnectDomain, parseConnectReply, socksReplyMessage, Socks5Error
} from './socks5';
import {
  buildAuthenticate, buildAddOnionNew, buildAddOnionFromKey, parseAddOnionResult, parseReply, type ControlReply
} from './tor-control';
import type { ChatStream, Transport } from './transport';

export class TorTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TorTransportError';
  }
}

// ---- pure path + config helpers (testable) ----
export interface TorPaths {
  torExe: string;
  geoip: string;
  geoip6: string;
}
/** Resolve tor file paths under a platform bundle dir (…/resources/tor/win-x64). */
export function torPaths(bundleDir: string): TorPaths {
  return {
    torExe: join(bundleDir, 'tor', 'tor.exe'),
    geoip: join(bundleDir, 'data', 'geoip'),
    geoip6: join(bundleDir, 'data', 'geoip6')
  };
}

export interface TorrcConfig {
  socksPort: number;
  controlPort: number;
  dataDir: string;
  cookieAuthFile: string;
  geoip: string;
  geoip6: string;
}
/** Generate a minimal torrc: loopback SOCKS + control with cookie auth, no relaying. */
export function buildTorrc(c: TorrcConfig): string {
  return [
    `SocksPort 127.0.0.1:${c.socksPort}`,
    `ControlPort 127.0.0.1:${c.controlPort}`,
    'CookieAuthentication 1',
    `CookieAuthFile ${c.cookieAuthFile}`,
    `DataDirectory ${c.dataDir}`,
    `GeoIPFile ${c.geoip}`,
    `GeoIPv6File ${c.geoip6}`,
    'AvoidDiskWrites 1',
    'SafeLogging 1'
  ].join('\n') + '\n';
}

// ---- stream drivers (testable over the in-memory pipe) ----
function append(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Drive a no-auth SOCKS5 CONNECT to `onion:port` over `stream`; resolves once connected. */
export function performSocksConnect(stream: ChatStream, onion: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf: Uint8Array = new Uint8Array(0);
    let phase: 'method' | 'connect' = 'method';
    let settled = false;
    const done = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
    stream.onClose(() => done(() => reject(new TorTransportError('SOCKS stream closed'))));
    stream.onData((chunk) => {
      if (settled) return;
      buf = append(buf, chunk);
      try {
        if (phase === 'method') {
          const m = parseMethodSelection(buf);
          if (!m) return;
          if (!m.ok) return done(() => reject(new Socks5Error('SOCKS no acceptable auth method')));
          buf = buf.slice(2);
          phase = 'connect';
          stream.send(buildConnectDomain(onion, port));
        }
        if (phase === 'connect') {
          const r = parseConnectReply(buf);
          if (!r) return;
          if (!r.ok) return done(() => reject(new Socks5Error(`SOCKS CONNECT: ${socksReplyMessage(r.rep)}`)));
          done(resolve);
        }
      } catch (e) {
        done(() => reject(e as Error));
      }
    });
    stream.send(buildGreeting());
  });
}

/** Send one control command line and resolve its (complete) reply. */
export function controlExchange(stream: ChatStream, command: string): Promise<ControlReply> {
  return new Promise((resolve, reject) => {
    let text = '';
    let settled = false;
    const done = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
    stream.onClose(() => done(() => reject(new TorTransportError('control stream closed'))));
    stream.onData((chunk) => {
      if (settled) return;
      text += new TextDecoder().decode(chunk);
      try {
        const reply = parseReply(text);
        if (reply) done(() => resolve(reply));
      } catch (e) {
        done(() => reject(e as Error));
      }
    });
    stream.send(new TextEncoder().encode(command));
  });
}

// ---- net.Socket ⇄ ChatStream adapter (integration) ----
export function socketToChatStream(socket: Socket): ChatStream {
  let closed = false;
  return {
    get closed() { return closed; },
    send(data) { if (!closed) socket.write(Buffer.from(data)); },
    onData(cb) { socket.on('data', (d: Buffer) => cb(new Uint8Array(d))); },
    onClose(cb) { socket.on('close', () => { closed = true; cb(); }); },
    close() { if (!closed) { closed = true; socket.destroy(); } }
  };
}

// ---- TorTransport (integration; runs against the real bundled binary) ----
export interface TorTransportOpts {
  paths: TorPaths;
  dataDir: string;          // writable tor DataDirectory (per-user)
  socksPort: number;
  controlPort: number;
  listenPort: number;       // local onion-service target (127.0.0.1)
  virtPort: number;         // onion virtual port (peers CONNECT here)
  /** Persisted onion key blob ("ED25519-V3:…"); null for first launch. */
  onionKeyBlob: string | null;
  /** Persist a freshly-minted onion key (first launch). */
  saveOnionKey(blob: string): Promise<void>;
  spawn?: typeof nodeSpawn;
}

/**
 * NOTE: start()/dial() perform real process + socket I/O against the bundled tor.exe and are not run
 * in CI (no tor in the sandbox). The protocol drivers they call ARE unit-tested above.
 */
export class TorTransport implements Transport {
  private proc: ChildProcess | null = null;
  private server: Server | null = null;
  private handler: ((s: ChatStream) => void) | null = null;
  private onion: string | null = null;

  constructor(private readonly opts: TorTransportOpts) {}

  onConnection(handler: (s: ChatStream) => void): void {
    this.handler = handler;
  }
  onionAddress(): string | null {
    return this.onion;
  }

  async dial(onion: string): Promise<ChatStream> {
    const socket = connect({ host: '127.0.0.1', port: this.opts.socksPort });
    await new Promise<void>((res, rej) => {
      socket.once('connect', res);
      socket.once('error', rej);
    });
    const stream = socketToChatStream(socket);
    await performSocksConnect(stream, onion, this.opts.virtPort);
    return stream;
  }

  async start(): Promise<void> {
    if (!this.handler) throw new TorTransportError('onConnection must be set before start');
    const o = this.opts;
    const spawn = o.spawn ?? nodeSpawn;
    const cookieAuthFile = join(o.dataDir, 'control.authcookie');
    const torrcPath = join(o.dataDir, 'torrc');

    // 1. write torrc
    await mkdir(o.dataDir, { recursive: true });
    await writeFile(
      torrcPath,
      buildTorrc({
        socksPort: o.socksPort,
        controlPort: o.controlPort,
        dataDir: o.dataDir,
        cookieAuthFile,
        geoip: o.paths.geoip,
        geoip6: o.paths.geoip6
      })
    );

    // 2. spawn tor; resolve on "Bootstrapped 100%"
    this.proc = spawn(o.paths.torExe, ['-f', torrcPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((res, rej) => {
      const proc = this.proc;
      if (!proc) return rej(new TorTransportError('tor failed to spawn'));
      const timer = setTimeout(() => rej(new TorTransportError('tor bootstrap timed out')), 120_000);
      proc.stdout?.on('data', (d: Buffer) => {
        if (d.toString().includes('Bootstrapped 100%')) {
          clearTimeout(timer);
          res();
        }
      });
      proc.once('exit', (code) => { clearTimeout(timer); rej(new TorTransportError(`tor exited (${code}) before bootstrap`)); });
      proc.once('error', (e) => { clearTimeout(timer); rej(e); });
    });

    // 3. local onion-service target listener (loopback only — no firewall prompt)
    this.server = createServer((socket) => this.handler?.(socketToChatStream(socket)));
    await new Promise<void>((res, rej) => {
      this.server?.once('listening', res);
      this.server?.once('error', rej);
      this.server?.listen(o.listenPort, '127.0.0.1');
    });

    // 4. control port: AUTHENTICATE (cookie) then ADD_ONION
    const cookie = (await readFile(cookieAuthFile)).toString('hex');
    const ctlSocket = connect({ host: '127.0.0.1', port: o.controlPort });
    await new Promise<void>((res, rej) => { ctlSocket.once('connect', res); ctlSocket.once('error', rej); });
    const ctl = socketToChatStream(ctlSocket);
    const authReply = await controlExchange(ctl, buildAuthenticate(cookie));
    if (!authReply.ok) throw new TorTransportError(`control AUTHENTICATE failed: ${authReply.code}`);

    const addCmd = o.onionKeyBlob
      ? buildAddOnionFromKey(o.onionKeyBlob, o.virtPort, '127.0.0.1', o.listenPort)
      : buildAddOnionNew(o.virtPort, '127.0.0.1', o.listenPort);
    const { serviceId, privateKey } = parseAddOnionResult(await controlExchange(ctl, addCmd));
    this.onion = `${serviceId}.onion`;
    if (privateKey && !o.onionKeyBlob) await o.saveOnionKey(privateKey); // persist the stable key once

    // keep the control connection open for the service's lifetime (closing it removes the onion)
    ctlSocket.on('close', () => { this.onion = null; });
  }

  async stop(): Promise<void> {
    this.server?.close();
    this.server = null;
    this.proc?.kill();
    this.proc = null;
    this.onion = null;
  }
}

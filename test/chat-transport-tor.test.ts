import { describe, it, expect } from 'vitest';
import {
  torPaths,
  buildTorrc,
  performSocksConnect,
  controlExchange,
  TorTransportError
} from '../src/main/chat/transport-tor';
import { Socks5Error } from '../src/main/chat/socks5';
import { createPipe, type ChatStream } from '../src/main/chat/transport';

const ONION = `${'a'.repeat(56)}.onion`;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
function cat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o;
}

/** Minimal SOCKS5 server simulation over the peer end of a pipe. */
function socksServer(s: ChatStream, method: number[], connectReply: number[]): void {
  let buf = new Uint8Array(0);
  let phase: 'greet' | 'connect' | 'done' = 'greet';
  s.onData((ch) => {
    buf = cat(buf, ch);
    if (phase === 'greet' && buf.length >= 3) {
      s.send(Uint8Array.from(method));
      buf = buf.slice(3);
      phase = 'connect';
    }
    if (phase === 'connect' && buf.length >= 5) {
      const total = 5 + buf[4] + 2;
      if (buf.length >= total) { s.send(Uint8Array.from(connectReply)); phase = 'done'; }
    }
  });
}

describe('tor transport — pure helpers', () => {
  it('resolves tor file paths under a bundle dir', () => {
    const p = torPaths('/res/tor/win-x64');
    expect(p.torExe.replace(/\\/g, '/')).toBe('/res/tor/win-x64/tor/tor.exe');
    expect(p.geoip.replace(/\\/g, '/')).toBe('/res/tor/win-x64/data/geoip');
    expect(p.geoip6.replace(/\\/g, '/')).toBe('/res/tor/win-x64/data/geoip6');
  });

  it('builds a loopback-only torrc with cookie auth', () => {
    const rc = buildTorrc({
      socksPort: 9050, controlPort: 9051, dataDir: '/d', cookieAuthFile: '/d/c', geoip: '/g', geoip6: '/g6'
    });
    expect(rc).toContain('SocksPort 127.0.0.1:9050');
    expect(rc).toContain('ControlPort 127.0.0.1:9051');
    expect(rc).toContain('CookieAuthentication 1');
    expect(rc).toContain('GeoIPFile /g');
    expect(rc).not.toMatch(/ORPort|ExitRelay/); // never a relay
  });
});

describe('tor transport — SOCKS5 connect driver', () => {
  it('completes a successful CONNECT to an onion', async () => {
    const [client, server] = createPipe();
    socksServer(server, [0x05, 0x00], [0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0x23, 0x28]);
    await expect(performSocksConnect(client, ONION, 9001)).resolves.toBeUndefined();
  });

  it('rejects when the server refuses the no-auth method', async () => {
    const [client, server] = createPipe();
    socksServer(server, [0x05, 0xff], [0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
    await expect(performSocksConnect(client, ONION, 9001)).rejects.toThrow(Socks5Error);
  });

  it('rejects on a non-zero CONNECT reply (host unreachable)', async () => {
    const [client, server] = createPipe();
    socksServer(server, [0x05, 0x00], [0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
    await expect(performSocksConnect(client, ONION, 9001)).rejects.toThrow(Socks5Error);
  });

  it('rejects if the stream closes mid-handshake', async () => {
    const [client, server] = createPipe();
    server.onData(() => server.close()); // close instead of replying
    await expect(performSocksConnect(client, ONION, 9001)).rejects.toThrow(TorTransportError);
  });
});

describe('tor transport — control exchange driver', () => {
  it('sends a command and resolves the complete reply', async () => {
    const [client, server] = createPipe();
    server.onData(() => server.send(new TextEncoder().encode('250 OK\r\n')));
    const reply = await controlExchange(client, 'AUTHENTICATE abcd\r\n');
    expect(reply.ok).toBe(true);
    expect(reply.code).toBe(250);
  });

  it('reassembles a multi-line reply split across chunks', async () => {
    const [client, server] = createPipe();
    let sent = false;
    server.onData(() => {
      if (sent) return;
      sent = true;
      server.send(new TextEncoder().encode('250-ServiceID=abc\r\n'));
      void flush().then(() => server.send(new TextEncoder().encode('250 OK\r\n')));
    });
    const reply = await controlExchange(client, 'ADD_ONION NEW:ED25519-V3 Port=9001,127.0.0.1:49001\r\n');
    expect(reply.ok).toBe(true);
    expect(reply.lines).toContain('ServiceID=abc');
  });
});

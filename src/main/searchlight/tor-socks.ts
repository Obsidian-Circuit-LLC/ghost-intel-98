import { connect, type Socket } from 'node:net';
import { buildGreeting, parseMethodSelection, buildConnectDomain, parseConnectReply, socksReplyMessage } from '../chat/socks5';

/** Open a SOCKS5 CONNECT tunnel to host:port through a local Tor SOCKS port.
 *  Resolves with the connected (pre-TLS) socket; the caller layers TLS/HTTP on top. */
export function socksDial(host: string, port: number, socksPort: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: socksPort });
    let buf = new Uint8Array(0);
    let phase: 'method' | 'connect' = 'method';
    let settled = false;
    const fail = (e: Error) => { if (!settled) { settled = true; socket.destroy(); reject(e); } };
    socket.once('error', (e) => fail(e));
    socket.once('connect', () => socket.write(Buffer.from(buildGreeting())));
    socket.on('data', (d: Buffer) => {
      if (settled) return;
      const merged = new Uint8Array(buf.length + d.length); merged.set(buf, 0); merged.set(new Uint8Array(d), buf.length); buf = merged;
      try {
        if (phase === 'method') {
          const m = parseMethodSelection(buf);
          if (!m) return;
          if (!m.ok) return fail(new Error('SOCKS: no acceptable auth method'));
          buf = buf.slice(2); phase = 'connect';
          socket.write(Buffer.from(buildConnectDomain(host, port)));
          return;
        }
        const r = parseConnectReply(buf);
        if (!r) return;
        if (!r.ok) return fail(new Error(`SOCKS CONNECT failed: ${socksReplyMessage(r.rep)}`));
        settled = true;
        socket.removeAllListeners('data');
        resolve(socket);
      } catch (e) { fail(e as Error); }
    });
  });
}

// src/main/plugins/tor-egress.ts — route plugin egress through a dedicated bundled Tor SOCKS proxy.
import type { Duplex } from 'node:stream';
import { buildGreeting, parseMethodSelection, buildUserPassAuth, parseUserPassReply, buildConnectDomain, parseConnectReply, socksReplyMessage } from '../chat/socks5';

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
